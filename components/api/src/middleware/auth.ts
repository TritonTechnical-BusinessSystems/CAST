/**
 * Session handling — a JWT in an httpOnly cookie, mirroring the SOC backend's
 * proven pattern (jsonwebtoken + cookie, requireAuth middleware).
 */
import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config";
import type { AuthedUser } from "../auth/ad";

export interface SessionUser {
  id: string;
  displayName: string;
  source: "ad" | "local";
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

const COOKIE = "cast_token";
const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: "strict" as const,
  secure: config.isProd,
  maxAge: 8 * 3600 * 1000,
};

export function issueSession(res: Response, user: AuthedUser): void {
  const token = jwt.sign(
    { id: user.id, displayName: user.displayName, source: user.source },
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
    return { id: payload.id, displayName: payload.displayName, source: payload.source };
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
