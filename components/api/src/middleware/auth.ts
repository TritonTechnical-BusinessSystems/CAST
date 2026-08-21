/**
 * Session handling — a JWT in an httpOnly cookie, mirroring the SOC backend's
 * proven pattern (jsonwebtoken + cookie, requireAuth middleware).
 */
import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config";
import type { AuthedUser } from "../auth/ad";
import { hasPermission, type Permission, type Role } from "../auth/permissions";

export interface SessionUser {
  id: string;
  displayName: string;
  source: "ad" | "local";
  role: Role;
  mustChangePassword?: boolean;
  viaResetBypass?: boolean;
}

// Attach the authenticated user to the request for downstream handlers.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: SessionUser;
    }
  }
}

export const SESSION_COOKIE_NAME = "cast_token";
const COOKIE = SESSION_COOKIE_NAME;

/**
 * Scoped to `/api` deliberately (security gate, 2026-08-21) — NOT the `/`
 * Express would default to.
 *
 * Cookies are scoped by host and path but NOT by port, so with `path: "/"` the
 * browser attached this admin session JWT to every request to
 * `https://cast.tritontechnical.com:20443/*` — the `deploy-monitor` container
 * (`INIT-0038`), which is the one browser-facing process in the stack that is
 * deliberately denied every other credential. It could not verify the token,
 * but it received it in plain request headers, giving anything able to read
 * those headers a live, replayable admin session for up to `maxAge`.
 *
 * Every route that reads this cookie is mounted under `/api/*` (`server.ts`),
 * and none of the monitor's paths (`/`, `/events`, `/app.js`, `/styles.css`,
 * `/healthz`) are — so scoping it here stops the browser sending it there at
 * all, with no new hostname or certificate. An earlier version of this change
 * asserted a separate hostname was the only fix; that was wrong.
 *
 * `PATH` must be used on BOTH set and clear: `res.clearCookie` only matches a
 * cookie with the same path, so clearing with a mismatched path would silently
 * leave a live session in the browser on logout.
 */
const COOKIE_PATH = "/api";
const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: "strict" as const,
  secure: config.isProd,
  maxAge: 8 * 3600 * 1000,
  path: COOKIE_PATH,
};

/**
 * A short-lived JWT for the internal Playwright browser that renders CI/PL
 * PDFs (INIT-0026 Phase 3) — it has no login session of its own, so
 * `renderShipmentDocument` (`pdf/render.ts`) sets this as a cookie on the
 * page it navigates to before hitting `/print/ci|pl/:id`, which in turn
 * fetches the same `requireAuth`-gated data endpoints an interactive user
 * would. Reuses the exact session JWT shape/secret (no new auth mechanism).
 *
 * Deliberately `viewer`, not `admin` — every route the print pages touch
 * (`invoice-data`, `packing-list-data`, `cw/ticket/:id`) is gated by bare
 * `requireAuth`, not a specific permission, so `viewer` (which still holds
 * `logistics.read`) is exactly enough. Scoping this down means that even if
 * the render browser's navigation were ever redirected to an unintended
 * endpoint (see the shipment-id validation in `pdf/render.ts`), this token
 * could never satisfy a `requirePermission("...write")` check — it isn't a
 * substitute for that validation, but a second, independent layer under it.
 * `svc: "pdf-renderer"` is a marker for anything inspecting the token/logs
 * later, not itself enforced. A 2-minute expiry keeps the token useless well
 * before a render could ever be replayed (renders complete in low
 * single-digit seconds).
 */
export function mintInternalRenderToken(): string {
  return jwt.sign(
    { id: "system:pdf-renderer", displayName: "PDF Renderer (internal)", source: "local", role: "viewer", svc: "pdf-renderer" },
    config.jwtSecret,
    { expiresIn: "2m" },
  );
}

export function issueSession(res: Response, user: AuthedUser): void {
  const token = jwt.sign(
    {
      id: user.id,
      displayName: user.displayName,
      source: user.source,
      role: user.role,
      mustChangePassword: user.mustChangePassword ?? false,
      viaResetBypass: user.viaResetBypass ?? false,
    },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn } as jwt.SignOptions,
  );
  // Evict any pre-existing `path=/` cookie from before the scoping change
  // above. Path is part of a cookie's identity, so without this a returning
  // user would carry BOTH — the browser would send two `cast_token` values on
  // every `/api` request (ambiguous for cookie-parser), and the stale
  // broad-path one would still reach the deploy monitor, defeating the fix.
  // Harmless no-op once no such cookie exists.
  res.clearCookie(COOKIE, { path: "/" });
  res.cookie(COOKIE, token, COOKIE_OPTS);
}

export function clearSession(res: Response): void {
  // Both paths, for the same reason: the current scoped cookie, plus any
  // legacy `path=/` one still held by a browser that logs out before it ever
  // logs back in.
  res.clearCookie(COOKIE, { path: COOKIE_PATH });
  res.clearCookie(COOKIE, { path: "/" });
}

/** Raw session read, no must-change-password gate — for `/me` and the change-password route itself, both of which have to work WHILE a change is pending. */
export function readSession(req: Request): SessionUser | null {
  const token = req.cookies?.[COOKIE];
  if (!token) return null;
  try {
    const payload = jwt.verify(token, config.jwtSecret) as jwt.JwtPayload;
    return {
      id: payload.id,
      displayName: payload.displayName,
      source: payload.source,
      role: payload.role,
      mustChangePassword: Boolean(payload.mustChangePassword),
      viaResetBypass: Boolean(payload.viaResetBypass),
    };
  } catch {
    return null;
  }
}

/**
 * Gate a route on a valid session — and, per INIT-0036, on NOT having a
 * pending forced password change. A break-glass account mid-reset (or any
 * local account seeded with `must_change_password`) can reach `/me` and
 * `/auth/local/change-password` (both use `readSession` directly, bypassing
 * this gate) but nothing else, until it actually sets a new password.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const user = readSession(req);
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (user.mustChangePassword) {
    res.status(403).json({ error: "You must set a new password before continuing.", reason: "must-change-password" });
    return;
  }
  req.user = user;
  next();
}

/** Gate a route on a specific permission (admin holds all permissions). Same must-change-password gate as requireAuth. */
export function requirePermission(perm: Permission) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = readSession(req);
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    if (user.mustChangePassword) {
      res.status(403).json({ error: "You must set a new password before continuing.", reason: "must-change-password" });
      return;
    }
    if (!hasPermission(user.role, perm)) {
      res.status(403).json({ error: "Forbidden — your role lacks this permission." });
      return;
    }
    req.user = user;
    next();
  };
}
