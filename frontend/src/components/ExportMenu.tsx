import React, { useState, useRef, useEffect } from "react";
import { Download, ChevronDown, Image as ImageIcon, FileSpreadsheet, Loader2 } from "lucide-react";

export interface ExportMenuProps {
  /** DOM node to screenshot for the PNG export — the currently visible view. */
  captureTarget: HTMLElement | null;
  /** Base filename (no extension) for both exports, e.g. the dashboard title. */
  filenameBase: string;
  onExportPng: (node: HTMLElement, filename: string) => Promise<void>;
  onExportCsv: () => Promise<void>;
}

type ExportKind = "png" | "csv" | null;

/**
 * The MVP's two export formats — a PNG screenshot of the current view and a
 * CSV re-download of the raw dataset. Deliberately not a generic "export"
 * abstraction with more formats behind it: PDF/sharing/public links are
 * explicitly out of scope until this slice is confirmed working end to end.
 */
export const ExportMenu: React.FC<ExportMenuProps> = ({
  captureTarget,
  filenameBase,
  onExportPng,
  onExportCsv,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [pending, setPending] = useState<ExportKind>(null);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen]);

  const handlePng = async (): Promise<void> => {
    if (!captureTarget || pending) return;
    setError(null);
    setPending("png");
    try {
      await onExportPng(captureTarget, filenameBase);
      setIsOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to export image.");
    } finally {
      setPending(null);
    }
  };

  const handleCsv = async (): Promise<void> => {
    if (pending) return;
    setError(null);
    setPending("csv");
    try {
      await onExportCsv();
      setIsOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to export CSV.");
    } finally {
      setPending(null);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label="Export"
        title="Export"
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-app-bg hover:brightness-125 text-app-muted text-xs font-medium border border-app-border transition-all min-h-[44px]"
      >
        <Download className="w-3.5 h-3.5" aria-hidden="true" />
        <span className="hidden sm:inline">Export</span>
        <ChevronDown className="w-3 h-3" aria-hidden="true" />
      </button>

      {isOpen && (
        <div
          role="menu"
          aria-label="Export options"
          className="absolute right-0 mt-2 w-52 rounded-xl border border-app-border bg-app-surface shadow-[var(--shadow)] overflow-hidden z-50"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => void handlePng()}
            disabled={!captureTarget || pending !== null}
            className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs text-app-text hover:brightness-110 transition-all min-h-[44px] disabled:opacity-40"
          >
            {pending === "png" ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin flex-shrink-0" aria-hidden="true" />
            ) : (
              <ImageIcon className="w-3.5 h-3.5 flex-shrink-0" aria-hidden="true" />
            )}
            <span className="text-left">
              <span className="block font-medium">Export as PNG</span>
              <span className="block text-[10px] text-app-muted">Screenshot of the current view</span>
            </span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => void handleCsv()}
            disabled={pending !== null}
            className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs text-app-text hover:brightness-110 transition-all min-h-[44px] disabled:opacity-40 border-t border-app-border"
          >
            {pending === "csv" ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin flex-shrink-0" aria-hidden="true" />
            ) : (
              <FileSpreadsheet className="w-3.5 h-3.5 flex-shrink-0" aria-hidden="true" />
            )}
            <span className="text-left">
              <span className="block font-medium">Export dataset as CSV</span>
              <span className="block text-[10px] text-app-muted">Full raw data re-download</span>
            </span>
          </button>
          {error && (
            <p role="alert" className="px-3 py-2 text-[11px] text-rose-400 border-t border-app-border">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
};
