/**
 * Human-readable labels for a command batch, e.g. "Created Sales chart",
 * "Moved Sales chart", "Changed color to blue" — used both as the stored
 * `CommandBatch.summary` and by the Command History panel.
 *
 * A visual's title is looked up from whichever snapshot still has it:
 * `resultingDashboard` for anything that survives the batch, `previousDashboard`
 * for a delete (the title is gone from the resulting snapshot by definition).
 */
import type { Command, CommandActionType, Dashboard } from "@ai-vis/types";

function findVisualTitle(dashboard: Dashboard | undefined, visualId: unknown): string | undefined {
  if (typeof visualId !== "string" || !dashboard) return undefined;
  for (const page of dashboard.pages) {
    const visual = page.visuals.find((v) => v.id === visualId);
    if (visual) return visual.title;
  }
  return undefined;
}

function visualLabel(
  previousDashboard: Dashboard | undefined,
  resultingDashboard: Dashboard | undefined,
  visualId: unknown
): string {
  const title =
    findVisualTitle(resultingDashboard, visualId) ?? findVisualTitle(previousDashboard, visualId);
  return title ? `"${title}" chart` : "chart";
}

function findPageTitle(dashboard: Dashboard | undefined, pageId: unknown): string | undefined {
  if (typeof pageId !== "string" || !dashboard) return undefined;
  return dashboard.pages.find((p) => p.id === pageId)?.title;
}

/** Describes a single command. `previous`/`resulting` are the whole-batch before/after snapshots. */
function describeCommand(
  command: Command,
  previousDashboard: Dashboard | undefined,
  resultingDashboard: Dashboard | undefined
): string {
  const type = command.type.toUpperCase() as CommandActionType | string;
  const payload = (command.payload ?? {}) as Record<string, unknown>;
  const chart = (visId: unknown) => visualLabel(previousDashboard, resultingDashboard, visId);

  switch (type) {
    case "CREATE_VISUAL":
      return `Created ${payload.title ? `"${payload.title}"` : String(payload.kind ?? "a")} chart`;
    case "DELETE_VISUAL":
      return `Deleted ${chart(payload.visualId)}`;
    case "MOVE_VISUAL":
      return `Moved ${chart(payload.visualId)}`;
    case "RESIZE_VISUAL":
      return `Resized ${chart(payload.visualId)}`;
    case "CHANGE_CHART_TYPE":
      return `Changed ${chart(payload.visualId)} type to ${String(payload.kind ?? "")}`;
    case "CHANGE_DIMENSION":
      return `Changed ${chart(payload.visualId)}'s ${String(payload.slot ?? "x")} field to ${String(payload.field ?? "")}`;
    case "CHANGE_MEASURE":
      return `Changed ${chart(payload.visualId)}'s measure to ${String(payload.field ?? "")}`;
    case "CHANGE_AGGREGATION":
      return `Changed ${chart(payload.visualId)}'s aggregation to ${String(payload.aggregation ?? "")}`;
    case "UPDATE_STYLE": {
      const scope = String(payload.scope ?? "visual");
      const style = (payload.style ?? {}) as Record<string, unknown>;
      if (scope === "dashboard") {
        const keys = Object.keys(style).filter((k) => k !== "name");
        return keys.length > 0
          ? `Changed the dashboard's theme (${keys.join(", ")})`
          : "Changed the dashboard's theme";
      }
      if (scope === "page") return `Changed page "${findPageTitle(resultingDashboard, payload.pageId) ?? ""}"'s style`;
      if (Array.isArray(style.colors) && style.colors.length > 0) {
        return `Changed ${chart(payload.visualId)} color to ${String(style.colors[0])}`;
      }
      return `Updated ${chart(payload.visualId)}'s style`;
    }
    case "UPDATE_VISUAL":
      return `Updated ${chart(payload.visualId)}`;
    case "REORDER_VISUALS":
      return "Reordered charts";
    case "CREATE_PAGE":
      return `Created page "${String(payload.title ?? "")}"`;
    case "DELETE_PAGE":
      return `Deleted page "${findPageTitle(previousDashboard, payload.pageId) ?? ""}"`;
    case "RENAME_PAGE":
      return `Renamed page to "${String(payload.title ?? "")}"`;
    case "SWITCH_PAGE":
      return "Switched page";
    case "REORDER_PAGES":
      return "Reordered pages";
    case "UPDATE_DASHBOARD_META":
      return payload.title ? `Renamed dashboard to "${String(payload.title)}"` : "Updated dashboard details";
    case "SET_DATASET":
      return "Changed the bound dataset";
    case "SET_THEME":
      return "Changed the theme";
    case "CREATE_MEASURE":
      return `Created measure "${String(payload.name ?? "")}"`;
    case "DELETE_MEASURE":
      return `Deleted measure "${String(payload.name ?? "")}"`;
    case "ADD_FILTER":
      return `Added a filter on ${String((payload.filter as { field?: string } | undefined)?.field ?? "")}`;
    case "REMOVE_FILTER":
      return `Removed the filter on ${String(payload.field ?? "")}`;
    case "UNDO":
      return "Undid the previous change";
    case "REDO":
      return "Redid a change";
    default:
      return String(type).toLowerCase().replace(/_/g, " ");
  }
}

const MAX_LISTED = 3;

/** Summarizes a whole batch — one command gets its own phrase; several get a short combined label. */
export function summarizeCommands(
  commands: Command[],
  previousDashboard: Dashboard | undefined,
  resultingDashboard: Dashboard | undefined
): string {
  if (commands.length === 0) return "No changes";
  if (commands.length === 1) return describeCommand(commands[0]!, previousDashboard, resultingDashboard);

  const phrases = commands.map((c) => describeCommand(c, previousDashboard, resultingDashboard));
  const shown = phrases.slice(0, MAX_LISTED);
  const extra = phrases.length - shown.length;
  return `${phrases.length} changes: ${shown.join(", ")}${extra > 0 ? `, +${extra} more` : ""}`;
}
