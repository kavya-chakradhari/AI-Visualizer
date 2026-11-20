import type { AIMessageResult, CommandInput } from "@ai-vis/types";
import { BASE_URL } from "./config.js";

/** Falls back to a structured failure if the response body isn't the shape we expect. */
function asAIMessageResult(body: unknown, res: Response): AIMessageResult {
  if (body && typeof body === "object" && typeof (body as { success?: unknown }).success === "boolean") {
    return body as AIMessageResult;
  }
  return {
    success: false,
    stage: "provider_error",
    message: `Request failed (HTTP ${res.status}).`,
  };
}

/**
 * Sends one natural-language turn. The AI layer never mutates state itself —
 * it returns commands that have already been run through the exact same
 * Validation Engine every manual edit uses, or a clarification, or a pending
 * confirmation for anything destructive/broad in scope.
 */
export async function sendAIMessage(
  dashboardId: string,
  message: string,
  options: { selectedVisualId?: string } = {}
): Promise<AIMessageResult> {
  const res = await fetch(`${BASE_URL}/dashboards/${encodeURIComponent(dashboardId)}/ai/message`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      ...(options.selectedVisualId ? { selectedVisualId: options.selectedVisualId } : {}),
    }),
  });
  const body = await res.json().catch(() => null);
  return asAIMessageResult(body, res);
}

/** Executes a batch of commands the user has approved from a confirmation card. */
export async function confirmAICommands(
  dashboardId: string,
  commands: CommandInput[],
  prompt?: string
): Promise<AIMessageResult> {
  const res = await fetch(`${BASE_URL}/dashboards/${encodeURIComponent(dashboardId)}/ai/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ commands, ...(prompt ? { prompt } : {}) }),
  });
  const body = await res.json().catch(() => null);
  return asAIMessageResult(body, res);
}
