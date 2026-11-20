import type { Request, Response, NextFunction } from "express";
import { AppError } from "./error-handler.js";

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

const DEV_USER: AuthenticatedUser = {
  id: "dev-user-1",
  email: "developer@example.com",
  name: "Dev User",
};

/**
 * Authentication gate.
 *
 * Disabled by default (`AUTH_ENABLED` unset or not "true") — every request is
 * attributed to a fixed dev user, exactly as before. This is a genuine
 * one-line switch for later, not a placeholder that still needs wiring:
 *
 *   AUTH_ENABLED=true
 *   API_AUTH_TOKEN=<a long random secret>
 *
 * turns on a real check — every request must carry `Authorization: Bearer
 * <token>` matching `API_AUTH_TOKEN`, or it's rejected with 401 before any
 * route handler runs. This is intentionally simple (a single shared bearer
 * token, not per-user sessions/OAuth) — enough to stop the API being wide
 * open the moment it's reachable from outside localhost, without pretending
 * to be a full identity system. Swap it for real per-user auth (sessions,
 * OAuth, JWT) before there are multiple real users to distinguish; nothing
 * else in this codebase assumes *how* `req.user` gets populated, only that it
 * does.
 */
export const authMiddleware = (req: Request, _res: Response, next: NextFunction): void => {
  const enabled = process.env.AUTH_ENABLED === "true";

  if (!enabled) {
    req.user = DEV_USER;
    next();
    return;
  }

  const configuredToken = process.env.API_AUTH_TOKEN;
  if (!configuredToken) {
    // Fail closed: AUTH_ENABLED=true with no token configured is a
    // deployment mistake, not "auth off" — never silently fall back to the
    // dev user in that case.
    throw new AppError(
      500,
      "AUTH_MISCONFIGURED",
      "AUTH_ENABLED is true but API_AUTH_TOKEN is not set."
    );
  }

  const header = req.header("authorization") ?? "";
  const [scheme, token] = header.split(" ");

  if (scheme !== "Bearer" || !token || token !== configuredToken) {
    throw new AppError(401, "UNAUTHORIZED", "A valid Authorization: Bearer token is required.");
  }

  // A single shared token authenticates the caller as the one operator
  // account — good enough for a single-tenant deployment; see the docstring
  // above for the upgrade path once there's more than one real user.
  req.user = DEV_USER;
  next();
};
