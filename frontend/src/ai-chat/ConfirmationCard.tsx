import React from "react";
import { Check, X, AlertTriangle, Loader2 } from "lucide-react";
import type { CommandInput } from "@ai-vis/types";
import type { PendingConfirmation } from "./store.js";

/** Turns a proposed command into one short checklist line, e.g. "✓ delete chart". */
function describeCommand(command: CommandInput): string {
  const type = command.type.toLowerCase();
  const payload = (command.payload ?? {}) as Record<string, unknown>;

  switch (type) {
    case "create_chart":
    case "create_visual":
      return `create ${String(payload.kind ?? "chart")}${payload.title ? ` "${payload.title}"` : ""}`;
    case "delete_visual":
      return "delete this chart";
    case "delete_page":
      return "delete this page";
    case "delete_measure":
      return `delete measure "${String(payload.name ?? "")}"`;
    case "update_style": {
      const scope = String(payload.scope ?? "visual");
      return scope === "dashboard" ? "restyle the entire dashboard" : `update ${scope} style`;
    }
    case "move_visual":
      return "move this chart";
    case "resize_visual":
      return "resize this chart";
    case "change_chart_type":
      return `change chart type to ${String(payload.kind ?? "")}`;
    case "add_filter":
      return "add a filter";
    case "remove_filter":
      return "remove a filter";
    case "create_measure":
      return `create measure "${String(payload.name ?? "")}"`;
    default:
      return type.replace(/_/g, " ");
  }
}

export interface ConfirmationCardProps {
  pending: PendingConfirmation;
  isBusy: boolean;
  onApply: () => void;
  onCancel: () => void;
}

export const ConfirmationCard: React.FC<ConfirmationCardProps> = ({
  pending,
  isBusy,
  onApply,
  onCancel,
}) => {
  if (pending.status === "cancelled") {
    return (
      <div className="mt-2 rounded-xl border border-app-border/80 bg-app-surface/40 px-3 py-2 text-[11px] text-app-muted italic">
        Cancelled — nothing was changed.
      </div>
    );
  }

  if (pending.status === "applied") {
    return (
      <div className="mt-2 flex items-center gap-1.5 rounded-xl border border-emerald-800/60 bg-emerald-950/30 px-3 py-2 text-[11px] text-emerald-300">
        <Check className="w-3.5 h-3.5 flex-shrink-0" />
        <span>Applied.</span>
      </div>
    );
  }

  return (
    <div className="mt-2 rounded-xl border border-amber-700/50 bg-amber-950/20 p-3 space-y-2.5">
      <div className="flex items-start gap-1.5 text-[11px] font-semibold text-amber-300">
        <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
        <span>I will:</span>
      </div>

      <ul className="space-y-1 pl-1">
        {pending.commands.map((command, i) => (
          <li key={i} className="flex items-start gap-1.5 text-xs text-app-text">
            <Check className="w-3.5 h-3.5 text-amber-400 flex-shrink-0 mt-0.5" />
            <span>{describeCommand(command)}</span>
          </li>
        ))}
      </ul>

      {pending.reason && (
        <p className="text-[11px] text-amber-400/80 italic">{pending.reason}</p>
      )}

      {pending.status === "failed" && pending.errorMessage && (
        <p className="text-[11px] text-rose-400">{pending.errorMessage}</p>
      )}

      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          onClick={onApply}
          disabled={isBusy}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-semibold transition-colors disabled:opacity-50 min-h-[36px]"
        >
          {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
          <span>Apply</span>
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={isBusy}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-app-surface hover:bg-app-border text-app-text text-xs font-medium border border-app-border transition-colors disabled:opacity-50 min-h-[36px]"
        >
          <X className="w-3.5 h-3.5" />
          <span>Cancel</span>
        </button>
      </div>
    </div>
  );
};

export default ConfirmationCard;
