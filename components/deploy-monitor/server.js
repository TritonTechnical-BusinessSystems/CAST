#!/usr/bin/env node
/**
 * Deploy monitor (INIT-0038) — the one container that stays up and reachable
 * from a browser WHILE `api` and `web` are being torn down and rebuilt, so a
 * redeploy stops being a blind 3-minute wait on a dead site.
 *
 * Why it's a separate container at all: `deploy.sh` rebuilds `api` and `web`.
 * The old Deploy card lived in the SPA (served by `web`) and polled through
 * `cast-api` — so the status feed and the page showing it both went dark for
 * exactly the window they were meant to cover. Nothing served by `web` can
 * ever report on `web` restarting.
 *
 * PRIVILEGE — deliberately the least-privileged container in the stack, which
 * matters because it is the only NEW browser-facing surface:
 *   - No Docker socket. No git deploy key. No write access to the app tree.
 *   - No `CAST_JWT_SECRET`. CAST signs sessions with HS256 (symmetric), so a
 *     container able to VERIFY a session could also FORGE one, including
 *     `role: "admin"`. Handing that to a browser-facing process would invert
 *     the whole point of splitting it out, so it never sees it. Browser access
 *     is gated by a short-lived HMAC watch token instead (see verifyWatch).
 *   - Read-only credential to `deploy-agent`: `DEPLOY_AGENT_READONLY_TOKEN` is
 *     accepted on the agent's GET /status only. This process CANNOT trigger a
 *     deploy, only watch one.
 *
 * It does run as root, for one reason: certbot hardens
 * /etc/letsencrypt/archive to 0700 root:root, so reading the TLS private key
 * requires it. It holds nothing else worth having.
 *
 * Zero npm dependencies, same rule as `deploy-agent` — a browser-facing
 * process on a box like this should have no supply chain to attack.
 */
const https = require("https");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.MONITOR_PORT || 20443);
const AGENT_URL = process.env.DEPLOY_AGENT_URL || "http://deploy-agent:4001";
const READONLY_TOKEN = process.env.DEPLOY_AGENT_READONLY_TOKEN || "";
const CERT_DIR = process.env.MONITOR_CERT_DIR || "/etc/letsencrypt/live/cast.tritontechnical.com";
const APP_ORIGIN = process.env.MONITOR_APP_ORIGIN || "https://cast.tritontechnical.com";
const PUBLIC_DIR = path.join(__dirname, "public");

/** How often we ask the agent for status. The agent answers from memory, and
 *  this is a container-to-container call on an internal network, so a tight
 *  interval costs nothing and is the difference between "live" and "laggy". */
const POLL_MS = 500;
/** Watch tokens are deliberately short-lived — long enough to cover a slow
 *  deploy plus reading the result, not long enough to be worth stealing. */
const WATCH_TTL_MS = 30 * 60 * 1000;
const COOKIE_NAME = "cast_deploy_watch";
/**
 * Hard cap on concurrent SSE streams (security gate, 2026-08-21). A watch
 * token is a shareable bearer link, not single-use or IP-bound, so its holder
 * could otherwise open unbounded held-open connections. This box is a 2
 * vCPU/4GB host constrained enough that image builds run sequentially — a
 * connection flood would compete for exactly the resources a redeploy needs,
 * during exactly the window this container exists to cover. A real operator
 * needs one or two tabs; this is generous for that and cheap insurance
 * against the pathological case.
 */
const MAX_CLIENTS = 16;

if (READONLY_TOKEN.length < 32) {
  // Fail closed, and say exactly what to do about it. This container's env
  // file is intentionally separate and `required: false` in compose, so an
  // un-provisioned host reaches here rather than failing every compose
  // command — which means this message is the ONLY signal an operator gets.
  console.error(
    "[deploy-monitor] DEPLOY_AGENT_READONLY_TOKEN missing or shorter than 32 chars — refusing to start.\n" +
      "  Create components/deploy-monitor/.env on this host containing ONLY:\n" +
      "    DEPLOY_AGENT_READONLY_TOKEN=<same value as in components/api/.env>\n" +
      "  See components/deploy-monitor/.env.example. Generate with: openssl rand -hex 32\n" +
      "  (Deliberately NOT the shared api .env — that would put the JWT secret, the\n" +
      "   credential master key, and the full deploy token in this browser-facing process.)"
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// TLS, with automatic renewal pickup
// ---------------------------------------------------------------------------
// certbot's renewal deploy-hook reloads the `web` service by name only
// (scripts/setup-tls.sh) — it knows nothing about this container. Rather than
// add a second host-side hook that could silently rot, this process watches
// its own cert files and swaps the secure context in place. Without this, the
// monitor would keep serving the pre-renewal certificate and start failing
// browser validation ~60 days after any renewal, silently.
function readCerts() {
  return {
    key: fs.readFileSync(path.join(CERT_DIR, "privkey.pem")),
    cert: fs.readFileSync(path.join(CERT_DIR, "fullchain.pem")),
  };
}

function fingerprint(certs) {
  return crypto.createHash("sha256").update(certs.cert).digest("hex");
}

let currentCerts;
try {
  currentCerts = readCerts();
} catch (e) {
  console.error(`[deploy-monitor] cannot read TLS material from ${CERT_DIR}: ${e.message}`);
  process.exit(1);
}
let currentFingerprint = fingerprint(currentCerts);

const server = https.createServer(currentCerts, handleRequest);

// Poll rather than fs.watch: the files in live/ are symlinks into archive/,
// and watch semantics across a symlink swap are inconsistent enough that a
// missed event would mean serving a dead certificate.
setInterval(() => {
  try {
    const next = readCerts();
    const nextFingerprint = fingerprint(next);
    if (nextFingerprint !== currentFingerprint) {
      server.setSecureContext(next);
      currentCerts = next;
      currentFingerprint = nextFingerprint;
      console.log("[deploy-monitor] TLS certificate changed on disk — secure context reloaded");
    }
  } catch (e) {
    // Keep serving the cert already loaded; a transient read failure mid-renewal
    // is not a reason to go down.
    console.warn(`[deploy-monitor] TLS reload check failed: ${e.message}`);
  }
}, 60 * 60 * 1000).unref();

// ---------------------------------------------------------------------------
// Watch-token auth
// ---------------------------------------------------------------------------
// Stateless on purpose. `cast-api` — which has already verified the caller
// holds `system.deploy` at the moment the button is clicked — mints
// `<expiry>.<hmac>` using the read-only agent token as the HMAC key, and
// redirects the browser here with it. This process recomputes the HMAC and
// checks the expiry. No shared session secret, no registration handshake, no
// server-side state to keep in sync across a restart.
function mintExpectedSignature(expiry) {
  return crypto.createHmac("sha256", READONLY_TOKEN).update(`watch:${expiry}`).digest("base64url");
}

function verifyWatch(token) {
  if (typeof token !== "string" || token.length > 256) return false;
  const dot = token.indexOf(".");
  if (dot <= 0) return false;
  const expiryRaw = token.slice(0, dot);
  const provided = token.slice(dot + 1);
  if (!/^\d+$/.test(expiryRaw)) return false;
  const expiry = Number(expiryRaw);
  // Fails closed in BOTH directions: an expired token is refused, and so is one
  // dated implausibly far in the future (clock skew or a forged expiry should
  // never buy a longer window than the mint side intended).
  const now = Date.now();
  if (!Number.isFinite(expiry) || expiry <= now || expiry > now + WATCH_TTL_MS + 60_000) return false;
  const expected = mintExpectedSignature(expiry);
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function readCookie(req, name) {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

// ---------------------------------------------------------------------------
// Agent polling + SSE fan-out
// ---------------------------------------------------------------------------
/** @type {Set<import("http").ServerResponse>} */
const clients = new Set();
let lastPayload = null;
let pollTimer = null;

function fetchStatus() {
  return fetch(`${AGENT_URL}/status`, {
    headers: { Authorization: `Bearer ${READONLY_TOKEN}` },
    signal: AbortSignal.timeout(5000),
  }).then(async (res) => {
    if (!res.ok) throw new Error(`agent returned ${res.status}`);
    return res.json();
  });
}

async function poll() {
  let payload;
  try {
    payload = { ok: true, ...(await fetchStatus()) };
  } catch (e) {
    // Surfaced to the browser rather than swallowed — during a deploy the
    // agent should always answer, so a failure here is real information, not
    // noise to hide behind a spinner.
    payload = { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  const serialized = JSON.stringify(payload);
  if (serialized !== lastPayload) {
    lastPayload = serialized;
    for (const res of clients) {
      res.write(`data: ${serialized}\n\n`);
    }
  }
}

function ensurePolling() {
  if (pollTimer || clients.size === 0) return;
  pollTimer = setInterval(() => {
    poll().catch(() => {});
  }, POLL_MS);
}

function stopPollingIfIdle() {
  if (clients.size === 0 && pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
    lastPayload = null;
  }
}

// ---------------------------------------------------------------------------
// Request handling
// ---------------------------------------------------------------------------
const STATIC = {
  "/app.js": { file: "app.js", type: "text/javascript; charset=utf-8" },
  "/styles.css": { file: "styles.css", type: "text/css; charset=utf-8" },
};

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  // Matches nginx.conf's policy on the main origin. There's no plain-HTTP
  // listener here to downgrade from, but the header is on this repo's own
  // transport checklist and costs nothing (security gate, 2026-08-21).
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  // No referrer, so a watch token in the address bar can never leak to another
  // origin via a link or subresource.
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy":
    "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};

function handleRequest(req, res) {
  const url = new URL(req.url, `https://${req.headers.host || "localhost"}`);
  const send = (code, type, body, extraHeaders) => {
    res.writeHead(code, { "Content-Type": type, ...SECURITY_HEADERS, ...(extraHeaders || {}) });
    res.end(body);
  };

  if (req.method !== "GET") return send(405, "text/plain; charset=utf-8", "Method not allowed");

  // Unauthenticated liveness probe — deliberately reveals nothing but that
  // this process is up, which is the one thing worth knowing when the rest of
  // the stack is mid-restart.
  if (url.pathname === "/healthz") return send(200, "application/json", JSON.stringify({ ok: true }));

  const queryToken = url.searchParams.get("w");
  const cookieToken = readCookie(req, COOKIE_NAME);
  const token = queryToken || cookieToken;
  const authorized = token ? verifyWatch(token) : false;

  if (url.pathname === "/") {
    if (!authorized) return send(403, "text/html; charset=utf-8", renderDenied());
    const headers = {};
    // Promote a URL token to a cookie so the page can drop it from the address
    // bar (and so an SSE reconnect doesn't depend on the query string
    // surviving). Scoped tightly and short-lived.
    if (queryToken) {
      const maxAge = Math.floor(WATCH_TTL_MS / 1000);
      headers["Set-Cookie"] = `${COOKIE_NAME}=${encodeURIComponent(queryToken)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAge}`;
    }
    let html;
    try {
      html = fs.readFileSync(path.join(PUBLIC_DIR, "index.html"), "utf8");
    } catch {
      return send(500, "text/plain; charset=utf-8", "Monitor UI missing");
    }
    return send(200, "text/html; charset=utf-8", html.replace("__APP_ORIGIN__", APP_ORIGIN), headers);
  }

  if (STATIC[url.pathname]) {
    // Deliberately NOT gated. These are inert — markup styling and view logic,
    // no deploy data of any kind, which only ever comes from /events. Gating
    // them would also leave the "link expired" page unstyled, since that page
    // is by definition served to an unauthorized caller.
    const entry = STATIC[url.pathname];
    try {
      return send(200, entry.type, fs.readFileSync(path.join(PUBLIC_DIR, entry.file)));
    } catch {
      return send(404, "text/plain; charset=utf-8", "Not found");
    }
  }

  if (url.pathname === "/events") {
    if (!authorized) return send(403, "text/plain; charset=utf-8", "Forbidden");
    if (clients.size >= MAX_CLIENTS) {
      return send(503, "text/plain; charset=utf-8", "Too many open monitor streams — close another tab and reload.");
    }
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-store",
      Connection: "keep-alive",
      ...SECURITY_HEADERS,
    });
    res.write(": connected\n\n");
    clients.add(res);
    ensurePolling();
    // Push current state immediately rather than making the first paint wait a
    // poll interval.
    poll().catch(() => {});
    const heartbeat = setInterval(() => res.write(": ping\n\n"), 20_000);
    req.on("close", () => {
      clearInterval(heartbeat);
      clients.delete(res);
      stopPollingIfIdle();
    });
    return;
  }

  send(404, "text/plain; charset=utf-8", "Not found");
}

function renderDenied() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Deploy monitor</title><link rel="stylesheet" href="/styles.css"></head>
<body class="denied"><main>
<p class="denied-title">This link has expired.</p>
<p class="denied-body">Deploy monitor links are valid for 30 minutes. Start a redeploy from System Health to get a new one.</p>
<p><a href="${APP_ORIGIN}/health">Return to System Health</a></p>
</main></body></html>`;
}

server.listen(PORT, () => console.log(`[deploy-monitor] listening on :${PORT} (TLS from ${CERT_DIR})`));
