import { Router } from "express";
import { authenticateAD } from "../auth/ad";
import { authenticateLocal, setLocalPassword, setLocalPasswordIfResetPending, verifyLocalPassword } from "../auth/local";
import { issueSession, clearSession, readSession } from "../middleware/auth";
import { permissionsFor } from "../auth/permissions";
import { adConfigured } from "../config";

const router = Router();

// Lets the login UI know whether to offer the AD path or steer to local.
router.get("/config", (_req, res) => {
  res.json({ adConfigured: adConfigured() });
});

// AD is the primary path; `mode: "local"` selects the break-glass fallback.
// try/catch is deliberate: this is the one unauthenticated route that does
// real work (JWT signing, AD/LDAPS calls) — a thrown error here is an
// unhandled rejection Express 4 doesn't catch on its own, which takes down
// the whole process, not just the request (hit live, see config.ts jwtSecret).
router.post("/login", async (req, res) => {
  try {
    const username = String(req.body?.username ?? "").trim();
    const password = String(req.body?.password ?? "");
    const mode = req.body?.mode === "local" ? "local" : "ad";

    const result =
      mode === "local"
        ? await authenticateLocal(username, password)
        : await authenticateAD(username, password);

    if (!result.ok) {
      res.status(401).json({ error: friendly(result.reason), reason: result.reason });
      return;
    }
    issueSession(res, result.user);
    res.json({ user: result.user, permissions: permissionsFor(result.user.role) });
  } catch (e) {
    console.error("[auth] login failed unexpectedly:", e);
    res.status(500).json({ error: "Sign-in failed. Please try again." });
  }
});

router.post("/logout", (_req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

// Deliberately `readSession`, not `requireAuth` — this must still answer
// while a password change is pending (INIT-0036), so the frontend can learn
// *that* it's pending and route to the reset screen instead of just getting
// a blanket 403 with nothing to render.
router.get("/me", (req, res) => {
  const user = readSession(req);
  if (!user) return void res.status(401).json({ error: "Unauthorized" });
  res.json({ user, permissions: permissionsFor(user.role) });
});

// Same reasoning — reachable specifically WHILE mustChangePassword is true
// (that's the whole point), so it can't sit behind requireAuth either. Only
// local accounts have a password to change; AD identity is Triton's, not
// this app's, to reset.
//
// THREE distinct paths, deliberately not conflated (security review,
// 2026-08-21 BLOCKED two rounds running: round 1 accepted any live local
// session with no current-password check at all, meaning a hijacked session
// could silently take over the account permanently, and separately never
// re-verified a recovery was still genuinely pending, so a second party who
// logged in during the same reset window could reuse their session to
// overwrite the password again even after the real owner already finished.
// Round 2 fixed both of those but, in doing so, permanently locked out any
// account with the legacy `must_change_password=1` flag and a REAL
// password — such an account authenticates normally, gets
// `mustChangePassword: true`, and then had nowhere to go, since the only
// write path required a reset-pending sentinel that account never had):
//  - `user.viaResetBypass === true` → the reset-pending BYPASS path. No
//    current password is asked for (that's the whole point — you don't
//    know it), and the write is atomic, re-checking the DB is STILL
//    reset-pending at that exact moment (`setLocalPasswordIfResetPending`),
//    not just trusting this request's JWT claim — so a second party from
//    the same window can't reuse their session after the real owner finishes.
//  - `user.mustChangePassword === true` but `viaResetBypass` is NOT true →
//    the legacy forced-change path. This account was authenticated with a
//    REAL, verified password moments ago (that's how the session exists at
//    all) — no bypass occurred, so no current-password re-entry or atomic
//    race guard is needed; a plain `setLocalPassword` is correct and safe.
//  - Neither flag set → a voluntary change. Requires proving
//    `currentPassword` first, same as any normal "change my password" flow
//    — a live session alone is never enough to silently rewrite it.
router.post("/local/change-password", (req, res) => {
  const user = readSession(req);
  if (!user) return void res.status(401).json({ error: "Unauthorized" });
  if (user.source !== "local") return void res.status(400).json({ error: "Only local accounts have a password here." });

  const newPassword = req.body?.newPassword;
  if (typeof newPassword !== "string" || newPassword.length < 8) {
    return void res.status(400).json({ error: "New password must be at least 8 characters." });
  }

  if (user.viaResetBypass) {
    const applied = setLocalPasswordIfResetPending(user.id, newPassword);
    if (!applied) {
      return void res.status(409).json({ error: "This account is no longer pending a reset — sign in with your current password instead." });
    }
    console.warn(`[auth] SECURITY: "${user.id}" completed a break-glass/forced password reset.`);
  } else if (user.mustChangePassword) {
    setLocalPassword(user.id, newPassword);
  } else {
    const currentPassword = req.body?.currentPassword;
    if (typeof currentPassword !== "string" || !verifyLocalPassword(user.id, currentPassword)) {
      return void res.status(401).json({ error: "Current password is incorrect." });
    }
    setLocalPassword(user.id, newPassword);
  }

  // Re-issue immediately so the SAME session continues without a fresh
  // login — otherwise the cookie still carries the old mustChangePassword:true
  // claim for up to 8h (config.jwtExpiresIn) even though the DB is fixed.
  issueSession(res, { ...user, mustChangePassword: false });
  res.json({ ok: true, user: { ...user, mustChangePassword: false }, permissions: permissionsFor(user.role) });
});

/** Map internal auth reasons to user-facing messages (naming per lexicon). */
function friendly(reason: string): string {
  switch (reason) {
    case "not-in-cast-users-group":
      return "Your account isn't a member of the CAST Users group.";
    case "invalid-credentials":
      return "Username or password is incorrect.";
    case "ad-unreachable":
      return "Active Directory is unreachable. If this persists, use a local account.";
    case "ad-not-configured":
      return "Active Directory sign-in isn't configured yet.";
    default:
      return "Sign-in failed. Please try again.";
  }
}

export default router;
