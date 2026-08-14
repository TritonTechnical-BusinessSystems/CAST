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
const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: "strict" as const,
  secure: config.isProd,
  maxAge: 8 * 3600 * 1000,
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
    { id: user.id, displayName: user.displayName, source: user.source, role: user.role },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn } as jwt.SignOptions,
  );
  res.cookie(COOKIE, token, COOKIE_OPTS);
}

export function clearSession(res: Response): void {
  res.clearCookie(COOKIE);
}

function readSession(req: Request): SessionUser | null {
  const token = req.cookies?.[COOKIE];
  if (!token) return null;
  try {
    const payload = jwt.verify(token, config.jwtSecret) as jwt.JwtPayload;
    return { id: payload.id, displayName: payload.displayName, source: payload.source, role: payload.role };
  } catch {
    return null;
  }
}

/** Gate a route on a valid session. */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const user = readSession(req);
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  req.user = user;
  next();
}

/** Gate a route on a specific permission (admin holds all permissions). */
export function requirePermission(perm: Permission) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = readSession(req);
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
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
