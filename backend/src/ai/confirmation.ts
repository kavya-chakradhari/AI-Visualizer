/**
 * Confirmation classification.
 *
 * A proposed command batch requires explicit user confirmation before it
 * executes when it is destructive, dashboard-wide, or bulk. Everything else —
 * a single visual's color, position, or size — is reversible with one undo
 * and executes immediately. This is deterministic and independent of what the
 * model claims via `requires_confirmation`: the service ORs this result with
 * the model's flag, so it can only ever push a decision towards requiring
 * confirmation, never away from it.
 */
import type { CommandInput } from "@ai-vis/types";

const DESTRUCTIVE_TYPES = new Set(["DELETE_VISUAL", "DELETE_PAGE", "DELETE_MEASURE"]);
const BULK_VISUAL_THRESHOLD = 3;

function normalize(type: string): string {
  return type.toUpperCase();
}

function isDestructive(type: string): boolean {
  return DESTRUCTIVE_TYPES.has(normalize(type));
}

function isDashboardWideStyleChange(command: CommandInput): boolean {
  if (normalize(command.type) !== "UPDATE_STYLE") return false;
  const payload = command.payload as { scope?: string } | undefined;
  return payload?.scope === "dashboard";
}

/** Collects every distinct visualId a batch touches, including REORDER_VISUALS' layout list. */
function collectTouchedVisualIds(commands: CommandInput[]): Set<string> {
  const ids = new Set<string>();
  for (const command of commands) {
    const payload = command.payload as Record<string, unknown> | undefined;
    if (typeof payload?.visualId === "string") ids.add(payload.visualId);

    if (Array.isArray(payload?.layouts)) {
      for (const entry of payload.layouts as { visualId?: unknown }[]) {
        if (typeof entry?.visualId === "string") ids.add(entry.visualId);
      }
    }
  }
  return ids;
}

export type ConfirmationReason = "destructive" | "dashboard_wide_style" | "bulk_edit";

export interface ConfirmationClassification {
  required: boolean;
  reason?: ConfirmationReason;
  touchedVisualCount?: number;
}

export function classifyRequiresConfirmation(commands: CommandInput[]): ConfirmationClassification {
  if (commands.some((c) => isDestructive(c.type))) {
    return { required: true, reason: "destructive" };
  }
  if (commands.some(isDashboardWideStyleChange)) {
    return { required: true, reason: "dashboard_wide_style" };
  }

  const touched = collectTouchedVisualIds(commands);
  if (touched.size >= BULK_VISUAL_THRESHOLD) {
    return { required: true, reason: "bulk_edit", touchedVisualCount: touched.size };
  }

  return { required: false };
}

/** Short, human-readable explanation of why confirmation is needed, for the UI. */
export function describeConfirmationReason(classification: ConfirmationClassification): string | undefined {
  switch (classification.reason) {
    case "destructive":
      return "This action can't be easily undone.";
    case "dashboard_wide_style":
      return "This changes the style for the entire dashboard.";
    case "bulk_edit":
      return `This affects ${classification.touchedVisualCount} charts at once.`;
    default:
      return undefined;
  }
}
