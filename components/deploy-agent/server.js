#!/usr/bin/env node
/**
 * Deploy agent — the ONLY component in this stack that holds the real Docker
 * socket and a git deploy key. `cast-api` (the container that also decrypts
 * every stored ConnectWise/aisstream/TrackingMore credential) never gets
 * either directly — it only ever calls this agent's narrow, fixed, two-action
 * HTTP surface, authenticated by a shared bearer token, over the dedicated
 * `deploy` Docker network (no published port, and NOT shared with `web` —
 * the only internet-facing container — or `docker-proxy`; see docker-compose.yml).
 *
 * Deliberately ZERO npm dependencies (Node's built-in http/crypto/child_process
 * only) — this is the single most privileged container in the stack (Docker
 * socket access is host-root-equivalent), so ITS OWN attack surface, including
 * supply-chain risk from dependencies, needs to be as small as physically
 * possible. It does exactly two things — trigger `deploy.sh` (optionally with
 * a git pull first) and report the last run's status — nothing else, no
 * arbitrary command execution, no user-supplied paths/branches/args (INIT-0035).
 */
const http = require("http");
const crypto = require("crypto");
const { spawn } = require("child_process");

const PORT = Number(process.env.DEPLOY_AGENT_PORT || 4001);
const TOKEN = process.env.DEPLOY_AGENT_TOKEN || "";
// Read-only companion credential (INIT-0038). `deploy-monitor` — the container
// that renders live deploy progress to a browser while `api`/`web` are being
// rebuilt — needs to READ this agent's status, but must never be able to
// TRIGGER a deploy: it's browser-facing, so it's the likeliest thing here to
// be reached by something untrusted. This token is accepted on GET /status
// ONLY; both POST routes still require the full DEPLOY_AGENT_TOKEN. Optional —
// unset simply means no monitor is deployed.
const READONLY_TOKEN = process.env.DEPLOY_AGENT_READONLY_TOKEN || "";
const APP_DIR = process.env.APP_DIR || "/opt/cast/app";
const MAX_RUNTIME_MS = 15 * 60 * 1000; // a normal run is 1-3 min; this is a stuck-process backstop, not a target

if (TOKEN.length < 32) {
  console.error("[deploy-agent] DEPLOY_AGENT_TOKEN missing or shorter than 32 chars — refusing to start");
  process.exit(1);
}
if (READONLY_TOKEN && READONLY_TOKEN.length < 32) {
  console.error("[deploy-agent] DEPLOY_AGENT_READONLY_TOKEN is set but shorter than 32 chars — refusing to start");
  process.exit(1);
}
// If these were ever equal the read-only split would be decorative — the
// "read-only" holder would in fact hold the full trigger credential.
if (READONLY_TOKEN && READONLY_TOKEN === TOKEN) {
  console.error("[deploy-agent] DEPLOY_AGENT_READONLY_TOKEN must differ from DEPLOY_AGENT_TOKEN — refusing to start");
  process.exit(1);
}

/** @type {{status: "idle"|"running"|"done", action: string|null, triggeredBy: string|null, startedAt: string|null, finishedAt: string|null, exitCode: number|null, log: string[]}} */
let state = { status: "idle", action: null, triggeredBy: null, startedAt: null, finishedAt: null, exitCode: null, log: [] };
let currentChild = null;
let watchdog = null;

function constantTimeEqual(a, b) {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function appendLog(chunk) {
  state.log.push(chunk.toString());
  if (state.log.length > 500) state.log.shift(); // bounded — this is a live-status view, not a persisted audit log
}

function finish(exitCode, extraLog) {
  // Re-entry guard — the watchdog SIGKILLing a hung child still triggers that
  // child's own `close` event afterward, which would otherwise call finish()
  // a second time and silently overwrite the watchdog's -2 (timeout) with
  // whatever exit code a SIGKILL produces, hiding the real reason from the
  // UI (caught on a second security-gate pass, 2026-08-21).
  if (state.status !== "running") return;
  if (watchdog) clearTimeout(watchdog);
  watchdog = null;
  currentChild = null;
  state.status = "done";
  state.finishedAt = new Date().toISOString();
  state.exitCode = exitCode;
  if (extraLog) appendLog(extraLog);
  console.log(`[deploy-agent] ${state.action} finished, exit code ${exitCode}`);
}

/**
 * Returns false (and starts nothing) if a deploy is already in flight — never
 * queues or races two builds on a 2 vCPU box. `triggeredBy` is DISPLAY-ONLY —
 * a free-text label from a trusted, already-authenticated caller for the
 * status/log view, never passed to spawn/exec or used to build a path
 * (security review, 2026-08-21: no audit trail existed for who could trigger
 * the single most powerful action in the app).
 */
function startDeploy(action, triggeredBy) {
  if (state.status === "running") return false;
  // Fixed, closed set — the script path and its arguments are chosen HERE from
  // a literal table, never assembled from anything the caller sent. A new
  // action means a new entry in this object, not a new parameter.
  const RUNS = {
    redeploy: { script: "deploy.sh", args: [] },
    "update-and-redeploy": { script: "deploy.sh", args: ["--pull"] },
    "update-monitor": { script: "update-monitor.sh", args: [] },
  };
  const run = RUNS[action];
  if (!run) return false;
  state = {
    status: "running",
    action,
    triggeredBy: triggeredBy || "unknown",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    exitCode: null,
    log: [],
  };
  const child = spawn("bash", [`${__dirname}/${run.script}`, ...run.args], { cwd: APP_DIR, env: process.env });
  currentChild = child;
  child.stdout.on("data", appendLog);
  child.stderr.on("data", appendLog);
  child.on("close", (code) => finish(code));
  child.on("error", (err) => finish(-1, `[deploy-agent] failed to spawn deploy.sh: ${err.message}`));
  // Backstop only — a hung deploy.sh would otherwise pin both UI buttons
  // disabled forever with no recovery short of host SSH (security review,
  // 2026-08-21). SIGKILL, not SIGTERM: this container has no reason to trust
  // whatever's hanging inside docker compose build/up to shut down cleanly.
  watchdog = setTimeout(() => {
    if (currentChild) currentChild.kill("SIGKILL");
    finish(-2, "[deploy-agent] killed after exceeding max runtime");
  }, MAX_RUNTIME_MS);
  console.log(`[deploy-agent] started ${state.action}, triggered by ${state.triggeredBy}`);
  return true;
}

const server = http.createServer((req, res) => {
  const json = (code, body) => {
    res.writeHead(code, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };

  const authHeader = req.headers.authorization || "";
  const provided = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  // Both comparisons always run (no short-circuit) so auth timing doesn't
  // reveal WHICH credential was presented, and neither is skipped.
  const isFullToken = constantTimeEqual(provided, TOKEN);
  const isReadOnlyToken = READONLY_TOKEN ? constantTimeEqual(provided, READONLY_TOKEN) : false;
  if (!isFullToken && !isReadOnlyToken) return json(401, { error: "Unauthorized" });

  if (req.method === "GET" && req.url === "/status") {
    return json(200, { ...state, log: state.log.slice(-200).join("") });
  }
  // Everything past here is a state-changing action: full token only. A
  // read-only holder reaching this point is a 403 (authenticated, not
  // permitted), never a silent success.
  if (!isFullToken) return json(403, { error: "Forbidden — read-only credential" });
  if (req.method === "POST" && (req.url === "/redeploy" || req.url === "/update-and-redeploy" || req.url === "/update-monitor")) {
    // Truncated hard — this only ever labels a log line, never touches argv/env/paths.
    const triggeredBy = String(req.headers["x-triggered-by"] || "unknown").slice(0, 200);
    const action = req.url.slice(1);
    return startDeploy(action, triggeredBy) ? json(202, { ok: true, status: "started" }) : json(409, { error: "A deploy is already running" });
  }
  json(404, { error: "Not found" });
});

server.listen(PORT, () => console.log(`[deploy-agent] listening on :${PORT}`));
