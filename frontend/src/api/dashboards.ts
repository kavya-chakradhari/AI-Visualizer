import type {
  ApiResponse,
  Command,
  CommandActionType,
  CommandAuditLog,
  CommandHistoryEntry,
  CommandBatchDiff,
  DashboardState,
} from "@ai-vis/types";
import { readApiError } from "./errors.js";
import { BASE_URL } from "./config.js";

export interface DashboardSummary {
  id: string;
  title: string;
  description?: string;
  version: number;
  datasetId?: string;
  createdById?: string;
  pageCount: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Fetch all dashboard summaries (metadata)
 */
export async function listDashboards(): Promise<DashboardSummary[]> {
  const res = await fetch(`${BASE_URL}/dashboards`);
  if (!res.ok) {
    throw await readApiError(res, `Failed to list dashboards (${res.status})`);
  }
  const body: ApiResponse<DashboardSummary[]> = await res.json();
  return body.data;
}

/**
 * Create a new dashboard
 */
export async function createDashboard(
  title: string,
  datasetId?: string
): Promise<DashboardState> {
  const res = await fetch(`${BASE_URL}/dashboards`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, datasetId }),
  });
  if (!res.ok) {
    throw await readApiError(res, `Failed to create dashboard (${res.status})`);
  }
  const body: ApiResponse<DashboardState> = await res.json();
  return body.data;
}

/**
 * Fetch full dashboard state by id
 */
export async function fetchDashboard(id: string): Promise<DashboardState> {
  const res = await fetch(`${BASE_URL}/dashboards/${encodeURIComponent(id)}`);
  if (!res.ok) {
    throw await readApiError(res, `Failed to fetch dashboard (${res.status})`);
  }
  const body: ApiResponse<DashboardState> = await res.json();
  return body.data;
}

/**
 * Apply a Command to a dashboard (both manual edits and AI commands use this!)
 */
export async function sendCommandToBackend(
  dashboardId: string,
  command: {
    type: CommandActionType;
    payload: Record<string, unknown>;
    origin: Command["origin"];
    prompt?: string;
  }
): Promise<{ state: DashboardState; commandId: string }> {
  const res = await fetch(
    `${BASE_URL}/dashboards/${encodeURIComponent(dashboardId)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(command),
    }
  );
  if (!res.ok) {
    throw await readApiError(res, `Failed to apply command (${res.status})`);
  }
  const body: ApiResponse<{ state: DashboardState; commandId: string }> =
    await res.json();
  return body.data;
}

/**
 * Undo last command on dashboard
 */
export async function undoCommand(dashboardId: string): Promise<DashboardState> {
  const res = await fetch(
    `${BASE_URL}/dashboards/${encodeURIComponent(dashboardId)}/undo`,
    { method: "POST" }
  );
  if (!res.ok) {
    throw await readApiError(res, `Undo failed (${res.status})`);
  }
  const body: ApiResponse<DashboardState> = await res.json();
  return body.data;
}

/**
 * Redo last undone command on dashboard
 */
export async function redoCommand(dashboardId: string): Promise<DashboardState> {
  const res = await fetch(
    `${BASE_URL}/dashboards/${encodeURIComponent(dashboardId)}/redo`,
    { method: "POST" }
  );
  if (!res.ok) {
    throw await readApiError(res, `Redo failed (${res.status})`);
  }
  const body: ApiResponse<DashboardState> = await res.json();
  return body.data;
}

/**
 * Fetch command audit log for a dashboard
 */
export async function fetchCommandLog(
  dashboardId: string,
  limit = 50
): Promise<CommandAuditLog[]> {
  const res = await fetch(
    `${BASE_URL}/dashboards/${encodeURIComponent(dashboardId)}/commands?limit=${limit}`
  );
  if (!res.ok) {
    throw await readApiError(res, `Failed to fetch command log (${res.status})`);
  }
  const body: ApiResponse<CommandAuditLog[]> = await res.json();
  return body.data;
}

/**
 * Command History — the batch-level undo/redo timeline, newest first, with a
 * human-readable summary per entry ("Created Sales chart", "Moved Sales
 * chart", ...).
 */
export async function fetchCommandHistory(
  dashboardId: string,
  limit = 50
): Promise<CommandHistoryEntry[]> {
  const res = await fetch(
    `${BASE_URL}/dashboards/${encodeURIComponent(dashboardId)}/history?limit=${limit}`
  );
  if (!res.ok) {
    throw await readApiError(res, `Failed to fetch command history (${res.status})`);
  }
  const body: ApiResponse<CommandHistoryEntry[]> = await res.json();
  return body.data;
}

/** "What changed" detail for one history entry — fetched on demand when the user clicks it. */
export async function fetchBatchDiff(
  dashboardId: string,
  batchId: string
): Promise<CommandBatchDiff> {
  const res = await fetch(
    `${BASE_URL}/dashboards/${encodeURIComponent(dashboardId)}/history/${encodeURIComponent(batchId)}`
  );
  if (!res.ok) {
    throw await readApiError(res, `Failed to fetch history detail (${res.status})`);
  }
  const body: ApiResponse<CommandBatchDiff> = await res.json();
  return body.data;
}
