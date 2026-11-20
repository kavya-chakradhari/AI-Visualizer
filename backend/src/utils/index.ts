/**
 * Shared backend utility functions: logger, helpers, formatting.
 */

export const logger = {
  info: (msg: string, ...args: unknown[]) => console.log(`[INFO] ${msg}`, ...args),
  warn: (msg: string, ...args: unknown[]) => console.warn(`[WARN] ${msg}`, ...args),
  error: (msg: string, ...args: unknown[]) => console.error(`[ERROR] ${msg}`, ...args),
};

// ─────────────────────────────────────────────
// Structured (JSON-line) logging
// ─────────────────────────────────────────────

/**
 * One structured log event. `event` is a dot-namespaced identifier
 * (`"command.execute"`, `"ai.provider_call"`, ...) so log lines can be
 * filtered/aggregated by kind. Every command execution — manual UI, AI, or
 * the debug endpoint — is expected to emit one of these (see
 * dashboardEngine.executeBatch), which is what makes AI failures debuggable
 * after the fact: requestId ties it back to the HTTP request, commandType +
 * stage say exactly what was attempted and where it failed.
 */
export interface LogEvent {
  event: string;
  success: boolean;
  requestId?: string;
  userId?: string;
  dashboardId?: string;
  commandType?: string;
  origin?: string;
  stage?: string;
  durationMs?: number;
  message?: string;
  [key: string]: unknown;
}

/**
 * Emits one JSON line per event — never a raw stack trace, never secrets
 * (callers must not pass an API key or full request body through `message`).
 * Structured so a log aggregator can filter on `event`/`success`/`stage`
 * without parsing free-text.
 */
export function logStructured(fields: LogEvent): void {
  const line = JSON.stringify({ timestamp: new Date().toISOString(), ...fields });
  if (fields.success === false) {
    console.error(line);
  } else {
    console.log(line);
  }
}
