import type { Request, Response, NextFunction, ErrorRequestHandler } from "express";
import type { ApiErrorResponse } from "@ai-vis/types";
import { logStructured } from "../utils/index.js";

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
    Error.captureStackTrace(this, this.constructor);
  }
}

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

/**
 * The single place an error becomes an HTTP response. In production this
 * NEVER sends a stack trace or `AppError.details` (which can carry internal
 * field-validation internals not meant for an end user) — only `code` and a
 * human-readable `message`. Every response — success or failure — carries
 * the request id, and every failure is logged as one structured event.
 */
export const errorHandler: ErrorRequestHandler = (
  err: unknown,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction
): void => {
  const requestId = req.id;

  if (err instanceof AppError) {
    logStructured({
      event: "http.error",
      success: false,
      requestId,
      userId: req.user?.id,
      statusCode: err.statusCode,
      code: err.code,
      message: err.message,
      path: req.originalUrl,
      method: req.method,
    });

    const errorResponse: ApiErrorResponse = {
      error: {
        code: err.code,
        message: err.message,
        ...(err.details !== undefined && !isProduction() && { details: err.details }),
        ...(requestId && { requestId }),
      },
    };
    res.status(err.statusCode).json(errorResponse);
    return;
  }

  // Unexpected (non-AppError) failure: log the real message + stack
  // server-side for debugging, but the client only ever sees a generic
  // message — never a stack trace, never internal error internals,
  // regardless of environment.
  const internalMessage = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;
  logStructured({
    event: "http.error",
    success: false,
    requestId,
    userId: req.user?.id,
    statusCode: 500,
    code: "INTERNAL_SERVER_ERROR",
    message: internalMessage,
    ...(stack && !isProduction() && { stack }),
    path: req.originalUrl,
    method: req.method,
  });

  const errorResponse: ApiErrorResponse = {
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message: "An internal server error occurred.",
      ...(requestId && { requestId }),
    },
  };

  res.status(500).json(errorResponse);
};

export const notFoundHandler = (req: Request, res: Response): void => {
  const errorResponse: ApiErrorResponse = {
    error: {
      code: "NOT_FOUND",
      message: `Route not found: ${req.method} ${req.originalUrl}`,
      ...(req.id && { requestId: req.id }),
    },
  };
  res.status(404).json(errorResponse);
};
