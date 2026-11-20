import React, { useEffect } from "react";
import { History, X, Loader2, Bot, User, Undo2, ChevronDown, ChevronRight } from "lucide-react";
import clsx from "clsx";
import type { CommandHistoryEntry } from "@ai-vis/types";
import { useHistoryStore } from "./store.js";
import { diffVisualFields } from "./visualFieldDiff.js";

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

const HistoryRow: React.FC<{
  entry: CommandHistoryEntry;
  isSelected: boolean;
  onSelect: () => void;
}> = ({ entry, isSelected, onSelect }) => {
  const diff = useHistoryStore((s) => s.diffs[entry.id]);
  const isDiffLoading = useHistoryStore((s) => s.isDiffLoading);

  return (
    <div className="border-b border-app-border/80 last:border-b-0">
      <button
        type="button"
        onClick={onSelect}
        className={clsx(
          "w-full flex items-start gap-2.5 px-4 py-3 text-left transition-colors hover:bg-app-surface/50 min-h-[44px]",
          entry.status === "reverted" && "opacity-50"
        )}
      >
        <div className="mt-0.5 flex-shrink-0">
          {isSelected ? (
            <ChevronDown className="w-3.5 h-3.5 text-app-muted" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-app-muted" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p
            className={clsx(
              "text-sm text-app-text leading-snug",
              entry.status === "reverted" && "line-through decoration-app-border"
            )}
          >
            {entry.summary}
          </p>
          <div className="flex items-center gap-2 mt-1 text-[10px] text-app-muted">
            <span className="inline-flex items-center gap-1">
              {entry.source === "ai" ? <Bot className="w-3 h-3" /> : <User className="w-3 h-3" />}
              {entry.source === "ai" ? "AI" : "Manual"}
            </span>
            <span>•</span>
            <span>{formatTime(entry.createdAt)}</span>
            {entry.status === "reverted" && (
              <>
                <span>•</span>
                <span className="inline-flex items-center gap-1 text-amber-500">
                  <Undo2 className="w-3 h-3" /> Undone
                </span>
              </>
            )}
          </div>
        </div>
      </button>

      {isSelected && (
        <div className="px-4 pb-3 pl-10 space-y-2">
          {isDiffLoading && !diff && (
            <div className="flex items-center gap-2 text-xs text-app-muted">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…
            </div>
          )}

          {diff?.visualChanges.map((change, i) => {
            const fields = diffVisualFields(change.before, change.after);
            const kind = !change.before ? "created" : !change.after ? "deleted" : "changed";
            return (
              <div key={i} className="rounded-lg bg-app-surface/80 border border-app-border p-2.5 text-xs">
                <p className="font-medium text-app-text mb-1.5">
                  {kind === "created" && `Created "${change.after?.title}"`}
                  {kind === "deleted" && `Deleted "${change.before?.title}"`}
                  {kind === "changed" && (change.after?.title ?? change.before?.title)}
                </p>
                {fields.length > 0 ? (
                  <ul className="space-y-1">
                    {fields.map((f, j) => (
                      <li key={j} className="text-app-muted flex flex-wrap gap-x-1.5">
                        <span className="text-app-muted">{f.label}:</span>
                        <span className="text-rose-400/80 line-through decoration-rose-800">{f.before}</span>
                        <span className="text-app-muted">→</span>
                        <span className="text-emerald-400">{f.after}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-app-muted italic">No visible field changes.</p>
                )}
              </div>
            );
          })}

          {diff?.otherChanges.map((change, i) => (
            <div key={`other-${i}`} className="rounded-lg bg-app-surface/80 border border-app-border p-2.5 text-xs">
              <p className="font-medium text-app-text mb-1">{change.type.toLowerCase().replace(/_/g, " ")}</p>
              <pre className="text-app-muted whitespace-pre-wrap break-words text-[10px]">
                {JSON.stringify(change.payload, null, 2)}
              </pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export interface HistoryPanelProps {
  dashboardId: string | undefined;
}

export const HistoryPanel: React.FC<HistoryPanelProps> = ({ dashboardId }) => {
  const { isOpen, isLoading, entries, close, selectEntry, selectedEntryId, refresh } = useHistoryStore();

  // Keep the list fresh while it's open (a new command/undo/redo elsewhere shouldn't show stale entries).
  useEffect(() => {
    if (isOpen && dashboardId) void refresh(dashboardId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, dashboardId]);

  return (
    <>
      {isOpen && <div className="fixed inset-0 z-30 bg-black/40 sm:hidden" onClick={close} aria-hidden="true" />}

      <aside
        className={clsx(
          "fixed z-40 flex flex-col bg-app-bg shadow-2xl transition-transform duration-200 ease-out",
          "inset-0 sm:inset-auto sm:top-16 sm:bottom-0 sm:left-0 sm:w-[380px] sm:border-r sm:border-app-border",
          isOpen ? "translate-x-0" : "-translate-x-full pointer-events-none"
        )}
        role="dialog"
        aria-modal="true"
        aria-label="Command history"
        aria-hidden={!isOpen}
      >
        <div className="flex items-center justify-between gap-2 px-4 h-16 border-b border-app-border flex-shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-app-surface flex items-center justify-center flex-shrink-0">
              <History className="w-4 h-4 text-app-text" />
            </div>
            <p className="text-sm font-semibold text-app-text">Command History</p>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Close command history"
            className="w-9 h-9 flex items-center justify-center rounded-lg text-app-muted hover:text-app-text hover:bg-app-surface transition-colors flex-shrink-0"
          >
            <X className="w-4.5 h-4.5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {isLoading && entries.length === 0 && (
            <div className="flex items-center justify-center gap-2 text-app-muted text-sm py-10">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading…
            </div>
          )}

          {!isLoading && entries.length === 0 && (
            <p className="text-center text-app-muted text-sm py-10 px-6">
              No changes yet. Every edit — manual or AI — will show up here.
            </p>
          )}

          {entries.map((entry) => (
            <HistoryRow
              key={entry.id}
              entry={entry}
              isSelected={selectedEntryId === entry.id}
              onSelect={() => dashboardId && void selectEntry(dashboardId, entry.id)}
            />
          ))}
        </div>
      </aside>
    </>
  );
};

export default HistoryPanel;
