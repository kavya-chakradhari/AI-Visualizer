/**
 * Rate limiting for the two endpoint families that are expensive or
 * externally billed: dataset upload (CPU/memory-heavy parsing) and the AI
 * command endpoints (calls a paid, rate-limited LLM API). Everything else is
 * left unlimited — a generic global limiter would just as happily throttle a
 * user rapidly undo/redoing, which is cheap and local.
 *
 * In-memory (per `express-rate-limit`'s default store) — fine for a single
 * dev/local-scale process; a multi-instance deployment needs a shared store
 * (e.g. Redis) instead, same caveat as the rest of this app's in-memory state
 * (see the README's scaling section).
 */
import rateLimit from "express-rate-limit";
import { AppError } from "./error-handler.js";

function rateLimitHandler(retryAfterLabel: string) {
  return () => {
    throw new AppError(
      429,
      "RATE_LIMITED",
      `Too many ${retryAfterLabel} requests. Please wait a moment and try again.`
    );
  };
}

/** 10 uploads per 5 minutes per IP — parsing is CPU/memory-bound, not something to let run unbounded. */
export const uploadRateLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler("upload"),
});

/** 30 AI turns per minute per IP — bounds both cost and load on the upstream LLM provider. */
export const aiRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler("AI assistant"),
});
