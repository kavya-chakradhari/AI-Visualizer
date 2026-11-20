import React, { useState, useEffect, useRef } from "react";
import type { Theme, Visual } from "@ai-vis/types";
import { CanvasItem } from "./CanvasItem.js";
import { Plus, Smartphone, LayoutGrid } from "lucide-react";

export interface DashboardCanvasProps {
  visuals: Visual[];
  /** Preview rows for every dataset attached to the dashboard, keyed by dataset id. */
  sampleRowsByDatasetId: Record<string, Record<string, unknown>[]>;
  /** The dashboard's primary dataset id — the fallback for a visual with no `datasetId` of its own. */
  primaryDatasetId?: string;
  /** The dashboard's current theme — passed straight through to every chart. */
  theme?: Theme;
  selectedVisualId: string | null;
  onSelectVisual: (visualId: string | null) => void;
  onMoveVisual: (visualId: string, x: number, y: number) => void;
  onResizeVisual: (visualId: string, width: number, height: number) => void;
  onDeleteVisual: (visualId: string) => void;
  onZIndexChange: (visualId: string, zIndex: number) => void;
  onOpenAddChart: () => void;
}

export const DashboardCanvas: React.FC<DashboardCanvasProps> = ({
  visuals,
  sampleRowsByDatasetId,
  primaryDatasetId,
  theme,
  selectedVisualId,
  onSelectVisual,
  onMoveVisual,
  onResizeVisual,
  onDeleteVisual,
  onZIndexChange,
  onOpenAddChart,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState<number>(1200);
  const [windowWidth, setWindowWidth] = useState<number>(
    typeof window !== "undefined" ? window.innerWidth : 1200
  );

  // Measure container dimensions & responsive breakpoint
  useEffect(() => {
    const handleResize = () => {
      if (typeof window !== "undefined") {
        setWindowWidth(window.innerWidth);
      }
      if (containerRef.current) {
        setContainerWidth(containerRef.current.clientWidth);
      }
    };

    handleResize();
    window.addEventListener("resize", handleResize);

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.width > 0) {
          setContainerWidth(entry.contentRect.width);
        }
      }
    });

    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    return () => {
      window.removeEventListener("resize", handleResize);
      observer.disconnect();
    };
  }, []);

  // Breakpoint evaluation
  // Mobile: < 640px (1 column, vertical stack, view-only)
  // Tablet: 640px - 1024px (2 columns, drag/resize enabled)
  // Desktop: > 1024px (12 columns, full interactive grid)
  const isMobile = windowWidth < 640;
  const isTablet = windowWidth >= 640 && windowWidth <= 1024;
  const columns = isMobile ? 1 : isTablet ? 2 : 12;
  const rowHeight = 60; // 60px row height
  const colWidth = Math.max(10, containerWidth / columns);

  // Compute total canvas height based on items
  const maxOccupiedRow = visuals.reduce((max, v) => {
    return Math.max(max, (v.layout.y || 0) + (v.layout.height || 4));
  }, 10);

  const canvasHeight = isMobile
    ? undefined // stacked automatically in normal flow
    : Math.max(600, (maxOccupiedRow + 2) * rowHeight);

  return (
    <div className="w-full flex flex-col flex-1 pb-16">
      {/* Mobile Notice Banner */}
      {isMobile && (
        <div className="mb-4 mx-4 p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center gap-3 text-amber-300 text-xs shadow-sm">
          <Smartphone className="w-5 h-5 flex-shrink-0 text-amber-400" />
          <div className="flex-1">
            <span className="font-semibold block">Mobile View-Only Mode</span>
            Charts are arranged in a single column. Switch to a tablet or desktop screen to move, resize, and edit the layout.
          </div>
        </div>
      )}

      {/* Grid Canvas Workspace */}
      <div
        ref={containerRef}
        role="listbox"
        aria-label="Dashboard charts"
        aria-multiselectable={false}
        onClick={(e) => {
          // Deselect when clicking canvas background
          if (e.target === containerRef.current) {
            onSelectVisual(null);
          }
        }}
        style={{ height: canvasHeight ? `${canvasHeight}px` : undefined }}
        className={`w-full relative px-4 sm:px-6 transition-all duration-200 ${
          isMobile ? "flex flex-col gap-4" : ""
        }`}
      >
        {/* Background Grid Guide Lines (Desktop/Tablet only) */}
        {!isMobile && (
          <div
            className="absolute inset-0 pointer-events-none opacity-20"
            style={{
              backgroundImage: `linear-gradient(to right, var(--color-border) 1px, transparent 1px), linear-gradient(to bottom, var(--color-border) 1px, transparent 1px)`,
              backgroundSize: `${colWidth}px ${rowHeight}px`,
            }}
          />
        )}

        {/* Empty Canvas Placeholder */}
        {visuals.length === 0 ? (
          <div className="w-full py-20 flex flex-col items-center justify-center text-center">
            <div className="w-16 h-16 rounded-2xl bg-app-surface border border-app-border flex items-center justify-center shadow-lg mb-4 text-app-muted">
              <LayoutGrid className="w-8 h-8 stroke-[1.5]" aria-hidden="true" />
            </div>
            <h3 className="text-base font-semibold text-app-text mb-1">
              Your Dashboard Canvas is Empty
            </h3>
            <p className="text-xs text-app-muted max-w-sm mb-6">
              Create your first chart using the manual chart builder. Pick a chart type, select dimension and metric columns, and add it to your canvas.
            </p>
            <button
              type="button"
              onClick={onOpenAddChart}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-app-primary hover:brightness-110 text-white text-xs font-semibold shadow-md transition-all active:scale-[0.98] min-w-[44px] min-h-[44px]"
            >
              <Plus className="w-4 h-4" aria-hidden="true" />
              Add Your First Chart
            </button>
          </div>
        ) : (
          // Visuals
          visuals.map((visual) => (
            <CanvasItem
              key={visual.id}
              visual={visual}
              dataRows={sampleRowsByDatasetId[visual.datasetId ?? primaryDatasetId ?? ""] ?? []}
              theme={theme}
              isSelected={selectedVisualId === visual.id}
              isReadOnly={isMobile}
              columns={columns}
              colWidth={colWidth}
              rowHeight={rowHeight}
              onSelect={onSelectVisual}
              onMove={onMoveVisual}
              onResize={onResizeVisual}
              onDelete={onDeleteVisual}
              onZIndexChange={onZIndexChange}
            />
          ))
        )}
      </div>
    </div>
  );
};
