/**
 * Computes "what changed" for one command history entry, on demand from its
 * two stored snapshots (previous/resulting DashboardState) — no separate diff
 * storage, so there's nothing extra to keep correct over time.
 *
 * Commands that target one visual (create/update/move/resize/delete/style/...)
 * get a concrete before/after Visual pair. Everything else (page/dashboard
 * level) is returned as its raw payload — a generic deep-diff isn't worth the
 * complexity for the handful of commands that don't center on one visual.
 */
import type { Command, CommandHistoryCommand, Dashboard, Visual, VisualDiffEntry } from "@ai-vis/types";

function findVisual(dashboard: Dashboard, visualId: string): Visual | null {
  for (const page of dashboard.pages) {
    const visual = page.visuals.find((v) => v.id === visualId);
    if (visual) return visual;
  }
  return null;
}

const VISUAL_SCOPED_TYPES = new Set([
  "CREATE_VISUAL",
  "UPDATE_VISUAL",
  "DELETE_VISUAL",
  "MOVE_VISUAL",
  "RESIZE_VISUAL",
  "CHANGE_CHART_TYPE",
  "CHANGE_DIMENSION",
  "CHANGE_MEASURE",
  "CHANGE_AGGREGATION",
]);

export interface BatchDiffResult {
  visualChanges: VisualDiffEntry[];
  otherChanges: CommandHistoryCommand[];
}

export function computeBatchDiff(
  commands: Command[],
  previousDashboard: Dashboard,
  resultingDashboard: Dashboard
): BatchDiffResult {
  const visualChanges: VisualDiffEntry[] = [];
  const otherChanges: CommandHistoryCommand[] = [];

  for (const command of commands) {
    const type = command.type.toUpperCase();
    const payload = (command.payload ?? {}) as Record<string, unknown>;

    // update_style / add_filter / remove_filter carry an explicit scope and
    // may or may not target a single visual.
    const explicitScope = payload.scope as string | undefined;
    const targetsVisual =
      VISUAL_SCOPED_TYPES.has(type) ||
      (explicitScope === "visual" && typeof payload.visualId === "string");

    if (targetsVisual && typeof payload.visualId === "string") {
      visualChanges.push({
        commandId: command.id,
        type: command.type,
        before: findVisual(previousDashboard, payload.visualId),
        after: findVisual(resultingDashboard, payload.visualId),
      });
      continue;
    }

    otherChanges.push({ id: command.id, type: command.type, payload: command.payload });
  }

  return { visualChanges, otherChanges };
}
