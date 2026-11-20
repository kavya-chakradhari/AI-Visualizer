/**
 * Assigns a unique id to every incoming request — the thread that ties an
 * HTTP request to whatever structured log lines it produces downstream
 * (command execution, AI provider calls, errors). Echoed back as
 * `X-Request-Id` so a client (or a support conversation) can quote it.
 */
import { randomUUID } from "node:crypto";
import type { Request, Response, NextFunction } from "express";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Unique per-request id, for correlating structured logs. */
      id: string;
    }
  }
}

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header("x-request-id");
  req.id = incoming && incoming.length <= 200 ? incoming : randomUUID();
  res.setHeader("X-Request-Id", req.id);
  next();
}
