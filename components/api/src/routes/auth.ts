import { Router } from "express";
import { authenticateAD } from "../auth/ad";
import { authenticateLocal } from "../auth/local";
import { issueSession, clearSession, requireAuth } from "../middleware/auth";
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

router.get("/me", requireAuth, (req, res) => {
  res.json({ user: req.user, permissions: permissionsFor(req.user!.role) });
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
