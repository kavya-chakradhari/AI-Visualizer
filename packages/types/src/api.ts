export interface ApiErrorShape {
  code: string;
  message: string;
  details?: unknown;
  /** Correlates this failure with the server's structured logs. */
  requestId?: string;
}

export interface ApiErrorResponse {
  error: ApiErrorShape;
}

export interface ApiResponse<T = unknown> {
  data: T;
  meta?: Record<string, unknown>;
}

export interface HealthResponse {
  status: "ok" | "degraded" | "error";
  uptime: number;
  timestamp: string;
  version: string;
}
