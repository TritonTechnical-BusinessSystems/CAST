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
const fs = require("fs");
const path = require("path");
const { spawn, execFile } = require("child_process");

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

/**
 * "Is there anything on origin/main we haven't pulled yet?" (follow-up to
 * INIT-0035, 2026-08-21) — user asked directly whether the Deploy card could
 * show Current/Available versions before you click a button to find out.
 *
 * `git fetch` only updates remote-tracking refs (`origin/main`) — it never
 * touches the working tree or HEAD, so it's safe to run at any time, including
 * while a deploy is NOT running. It's still a real network call to GitHub, so
 * it's read-only-token-eligible in spirit but deliberately gated to the full
 * token below (see the comment at the auth check) and cached for
 * UPDATE_CHECK_CACHE_MS so a chatty frontend (or several open tabs) can't
 * trigger a fetch on every poll.
 *
 * execFile, not exec/spawn-with-shell — args are a fixed array, no shell ever
 * parses them, so there is no injection surface even though this reads
 * dynamic values (commit hashes) out of git's own output.
 */
const UPDATE_CHECK_CACHE_MS = 60_000;
// 1MB is git's own historical default for a single object's worth of `show`
// output; set explicitly rather than relying on execFile's implicit default
// (also 1MB, but implicit) so this bound stays visible if this file is ever
// edited to add another execFile call with different needs (security review,
// 2026-08-21).
const GIT_MAX_BUFFER = 1024 * 1024;
let updateCheckCache = null; // { at: number, result: object }
// De-dupes concurrent callers (e.g. two open admin tabs both clicking "Check
// for updates" before the cache above has anything to serve) onto the SAME
// in-flight promise, rather than each firing its own `git fetch` and risking
// lock-file contention against each other (security review, 2026-08-21).
let updateCheckInFlight = null;

function git(args) {
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd: APP_DIR, timeout: 20_000, maxBuffer: GIT_MAX_BUFFER }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr?.toString().trim() || err.message));
      resolve(stdout.toString().trim());
    });
  });
}

async function checkForUpdate() {
  if (updateCheckCache && Date.now() - updateCheckCache.at < UPDATE_CHECK_CACHE_MS) {
    return updateCheckCache.result;
  }
  if (state.status === "running") {
    // Don't race deploy.sh's own fetch/pull with a concurrent one. If nothing
    // is cached yet, say so plainly rather than risk a torn read mid-pull.
    if (updateCheckCache) return updateCheckCache.result;
    throw new Error("A deploy is currently running — check again once it finishes");
  }
  if (updateCheckInFlight) return updateCheckInFlight;

  updateCheckInFlight = performUpdateCheck().finally(() => {
    updateCheckInFlight = null;
  });
  return updateCheckInFlight;
}

async function performUpdateCheck() {
  await git(["fetch", "--prune", "origin"]);
  const currentCommit = await git(["rev-parse", "--short", "HEAD"]);
  const commitsBehind = Number(await git(["rev-list", "--count", "HEAD..origin/main"])) || 0;

  const current = JSON.parse(fs.readFileSync(path.join(APP_DIR, "version.json"), "utf8"));

  let availableVersion = null;
  let availableBuild = null;
  let availableCommit = currentCommit;
  if (commitsBehind > 0) {
    availableCommit = await git(["rev-parse", "--short", "origin/main"]);
    try {
      // Reads the file out of the remote-tracking ref directly -- does NOT
      // check anything out, so the running deploy is untouched either way.
      const available = JSON.parse(await git(["show", "origin/main:version.json"]));
      // Coerced to string-or-null explicitly (security review, 2026-08-21) --
      // this JSON comes from a file on origin/main, which this process
      // doesn't control the shape of. A non-string here would otherwise flow
      // untyped through to the frontend, where JSX throws trying to render a
      // non-primitive as a text child, crashing the whole Deploy card for
      // whoever's looking at it over a cosmetic field.
      availableVersion = typeof available.version === "string" ? available.version : null;
      availableBuild = typeof available.build === "string" ? available.build : null;
    } catch (e) {
      // origin/main having no readable version.json shouldn't hide the fact
      // that there ARE new commits -- report the count, just without version
      // labels for them.
      console.warn(`[deploy-agent] could not read origin/main's version.json: ${e.message}`);
    }
  }

  const result = {
    // Same string-or-null coercion as the available-side fields above -- this
    // one's read from a file this repo does control, but the check is free
    // and keeps both sides of the comparison held to the identical contract.
    currentVersion: typeof current.version === "string" ? current.version : null,
    currentBuild: typeof current.build === "string" ? current.build : null,
    currentCommit,
    availableVersion,
    availableBuild,
    availableCommit,
    commitsBehind,
    checkedAt: new Date().toISOString(),
  };
  updateCheckCache = { at: Date.now(), result };
  return result;
}

const server = http.createServer(async (req, res) => {
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
  // Everything past here requires the FULL token. Not all of it mutates state
  // (GET /update-check doesn't) -- the read-only credential exists
  // specifically for deploy-monitor, which watches a deploy already in
  // progress and has no reason to know what's waiting on origin/main. A
  // read-only holder reaching any route past this point gets 403
  // (authenticated, not permitted), never a silent success.
  if (!isFullToken) return json(403, { error: "Forbidden — read-only credential" });

  if (req.method === "GET" && req.url === "/update-check") {
    try {
      return json(200, await checkForUpdate());
    } catch (e) {
      return json(502, { error: e instanceof Error ? e.message : String(e) });
    }
  }
  if (req.method === "POST" && (req.url === "/redeploy" || req.url === "/update-and-redeploy" || req.url === "/update-monitor")) {
    // Truncated hard — this only ever labels a log line, never touches argv/env/paths.
    const triggeredBy = String(req.headers["x-triggered-by"] || "unknown").slice(0, 200);
    const action = req.url.slice(1);
    return startDeploy(action, triggeredBy) ? json(202, { ok: true, status: "started" }) : json(409, { error: "A deploy is already running" });
  }
  json(404, { error: "Not found" });
});

server.listen(PORT, () => console.log(`[deploy-agent] listening on :${PORT}`));
