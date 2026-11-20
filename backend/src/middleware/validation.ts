/**
 * Zod-backed request validation. Every route in this API validates its
 * params/query/body through one of these three helpers before touching a
 * database or the filesystem — there is no route left trusting `req.params`,
 * `req.query`, or `req.body` unchecked.
 *
 * On success, `req.params`/`req.query`/`req.body` is replaced with the
 * PARSED result (so route handlers see coerced/typed values — e.g. a query
 * `limit` arrives as a bounded `number`, not a raw string). On failure, a
 * structured 400 is raised via `AppError` — the same shape every other
 * validation failure in this app already uses.
 */
import type { Request, Response, NextFunction, RequestHandler } from "express";
import { z, type ZodType } from "zod";
import { AppError } from "./error-handler.js";

function issuesToFieldErrors(error: z.ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const path = issue.path.map(String).join(".") || "_root";
    (out[path] ??= []).push(issue.message);
  }
  return out;
}

function validate<T>(schema: ZodType<T>, value: unknown, label: string): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new AppError(
      400,
      "VALIDATION_FAILED",
      `Invalid ${label}: ${result.error.issues.map((i) => i.message).join("; ")}`,
      issuesToFieldErrors(result.error)
    );
  }
  return result.data;
}

export function zParams<T>(schema: ZodType<T>): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    req.params = validate(schema, req.params, "route parameters") as never;
    next();
  };
}

export function zQuery<T>(schema: ZodType<T>): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    req.query = validate(schema, req.query, "query parameters") as never;
    next();
  };
}

export function zBody<T>(schema: ZodType<T>): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    req.body = validate(schema, req.body, "request body");
    next();
  };
}

// ─────────────────────────────────────────────
// Shared primitive schemas
// ─────────────────────────────────────────────

/** A path-segment-safe id — every entity in this app is looked up by one of these. */
export const IdSchema = z
  .string()
  .min(1, "id is required")
  .max(100, "id is too long");

export const IdParamSchema = z.object({ id: IdSchema }).passthrough();

/** A bounded, coerced pagination limit — never trust a raw `?limit=` string straight into a DB query. */
export function limitQuerySchema(max: number, fallback: number) {
  return z.object({
    limit: z.coerce.number().int().min(1).max(max).optional().default(fallback),
  });
}

/** @deprecated kept for any existing import; prefer the zod helpers above. */
export const validateBody = (
  validator: (body: unknown) => { valid: boolean; errors?: string[] }
) => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = validator(req.body);
    if (!result.valid) {
      throw new AppError(400, "VALIDATION_FAILED", "Request body validation failed", result.errors);
    }
    next();
  };
};
