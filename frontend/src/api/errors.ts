/** An API error that preserves the backend's error `code` so callers can distinguish cases (e.g. a no-op vs a real failure) without string-matching the message. */
export class ApiError extends Error {
  code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = "ApiError";
    this.code = code;
  }
}

/** Parses `{ error: { code, message } }` (the backend's ApiErrorResponse shape). */
export async function readApiError(res: Response, fallback: string): Promise<ApiError> {
  const body = await res.json().catch(() => null);
  const shaped = body as { error?: { code?: string; message?: string } } | null;
  return new ApiError(shaped?.error?.message || fallback, shaped?.error?.code);
}
