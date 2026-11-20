import React, { useState, useRef, useEffect } from "react";
import type { Theme, Visual } from "@ai-vis/types";
import { ChartRenderer } from "../charts/ChartRenderer.js";
import {
  GripVertical,
  Maximize2,
  Trash2,
  Settings,
  ArrowUp,
  ArrowDown,
} from "lucide-react";

export interface CanvasItemProps {
  visual: Visual;
  dataRows: Record<string, unknown>[];
  theme?: Theme;
  isSelected: boolean;
  isReadOnly?: boolean;
  columns: number; // 12 for desktop, 2 for tablet, 1 for mobile
  colWidth: number; // in pixels
  rowHeight: number; // default 60px
  onSelect: (visualId: string) => void;
  onMove: (visualId: string, x: number, y: number) => void;
  onResize: (visualId: string, width: number, height: number) => void;
  onDelete: (visualId: string) => void;
  onZIndexChange: (visualId: string, newZIndex: number) => void;
}

/**
 * Every stored layout.x/width is authored in units of a 12-column grid (see
 * PageLayoutConfig's default and CREATE_VISUAL's default layout) — regardless
 * of how many columns are actually active at the current breakpoint.
 * DashboardCanvas switches `columns` to 2 (tablet) or 1 (mobile, unused here
 * since mobile is read-only and ignores layout entirely) for its own grid
 * math, so a raw 12-column value must never be used directly against a
 * narrower active column count: a stored width of 6 is "half the desktop
 * grid", not "6 columns" — reused literally against a 2-column tablet grid it
 * would be 3x the entire container. These two helpers are the only place that
 * conversion happens, in both directions.
 */
const GRID_COLUMNS = 12;

function toActiveColumns(value: number, activeColumns: number): number {
  return activeColumns === GRID_COLUMNS ? value : (value / GRID_COLUMNS) * activeColumns;
}

function toCanonicalColumns(value: number, activeColumns: number): number {
  return activeColumns === GRID_COLUMNS ? value : Math.round((value / activeColumns) * GRID_COLUMNS);
}

export const CanvasItem: React.FC<CanvasItemProps> = ({
  visual,
  dataRows,
  theme,
  isSelected,
  isReadOnly = false,
  columns,
  colWidth,
  rowHeight,
  onSelect,
  onMove,
  onResize,
  onDelete,
  onZIndexChange,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  // currentPos/currentDim are always in ACTIVE-column units (i.e. already
  // scaled for whatever `columns` is right now) — converted from the stored
  // canonical (12-column) layout on read, and converted back on write.
  const [currentPos, setCurrentPos] = useState({
    x: toActiveColumns(visual.layout.x, columns),
    y: visual.layout.y,
  });
  const [currentDim, setCurrentDim] = useState({
    width: toActiveColumns(visual.layout.width, columns),
    height: visual.layout.height,
  });

  const cardRef = useRef<HTMLDivElement>(null);

  // Sync state when visual props update externally
  useEffect(() => {
    if (!isDragging && !isResizing) {
      setCurrentPos({ x: toActiveColumns(visual.layout.x, columns), y: visual.layout.y });
      setCurrentDim({ width: toActiveColumns(visual.layout.width, columns), height: visual.layout.height });
    }
  }, [visual.layout, isDragging, isResizing, columns]);

  // Handle Dragging
  const handleDragStart = (e: React.MouseEvent | React.TouchEvent) => {
    if (isReadOnly) return;
    e.stopPropagation();
    setIsDragging(true);
    onSelect(visual.id);

    const clientX = "touches" in e ? e.touches[0]!.clientX : e.clientX;
    const clientY = "touches" in e ? e.touches[0]!.clientY : e.clientY;

    setDragOffset({
      x: clientX - currentPos.x * colWidth,
      y: clientY - currentPos.y * rowHeight,
    });
  };

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent | TouchEvent) => {
      const clientX = "touches" in e ? e.touches[0]!.clientX : e.clientX;
      const clientY = "touches" in e ? e.touches[0]!.clientY : e.clientY;

      const rawX = clientX - dragOffset.x;
      const rawY = clientY - dragOffset.y;

      const newGridX = Math.max(
        0,
        Math.min(columns - currentDim.width, Math.round(rawX / colWidth))
      );
      const newGridY = Math.max(0, Math.round(rawY / rowHeight));

      setCurrentPos({ x: newGridX, y: newGridY });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      const canonicalX = toCanonicalColumns(currentPos.x, columns);
      if (canonicalX !== visual.layout.x || currentPos.y !== visual.layout.y) {
        onMove(visual.id, canonicalX, currentPos.y);
      }
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    window.addEventListener("touchmove", handleMouseMove);
    window.addEventListener("touchend", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      window.removeEventListener("touchmove", handleMouseMove);
      window.removeEventListener("touchend", handleMouseUp);
    };
  }, [isDragging, dragOffset, colWidth, rowHeight, columns, currentDim.width, currentPos, visual.layout, onMove, visual.id]);

  // Handle Resizing
  const handleResizeStart = (e: React.MouseEvent | React.TouchEvent) => {
    if (isReadOnly) return;
    e.stopPropagation();
    setIsResizing(true);
    onSelect(visual.id);

    const clientX = "touches" in e ? e.touches[0]!.clientX : e.clientX;
    const clientY = "touches" in e ? e.touches[0]!.clientY : e.clientY;

    const startX = clientX;
    const startY = clientY;
    const startW = currentDim.width;
    const startH = currentDim.height;
    // React state updates from setCurrentDim below are async and only visible
    // on the NEXT render — but handleMouseUp is the same closure created here
    // at mousedown time, so reading `currentDim` from component state inside
    // it would always see the pre-drag value (every resize silently snapped
    // back to its original size on release). These locals are mutated
    // directly by handleMouseMove and read by handleMouseUp within the same
    // closure, so the committed size always matches what was last dragged to.
    let liveW = startW;
    let liveH = startH;

    const handleMouseMove = (ev: MouseEvent | TouchEvent) => {
      const curX = "touches" in ev ? ev.touches[0]!.clientX : ev.clientX;
      const curY = "touches" in ev ? ev.touches[0]!.clientY : ev.clientY;

      const deltaX = curX - startX;
      const deltaY = curY - startY;

      const addedCols = Math.round(deltaX / colWidth);
      const addedRows = Math.round(deltaY / rowHeight);

      const newW = Math.max(
        2,
        Math.min(columns - currentPos.x, startW + addedCols)
      );
      const newH = Math.max(2, startH + addedRows);

      liveW = newW;
      liveH = newH;
      setCurrentDim({ width: newW, height: newH });
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      window.removeEventListener("touchmove", handleMouseMove);
      window.removeEventListener("touchend", handleMouseUp);

      onResize(visual.id, toCanonicalColumns(liveW, columns), liveH);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    window.addEventListener("touchmove", handleMouseMove);
    window.addEventListener("touchend", handleMouseUp);
  };

  // Responsive layout positioning
  const stylePos: React.CSSProperties = isReadOnly
    ? { width: "100%", height: `${Math.max(280, visual.layout.height * rowHeight)}px` }
    : {
        transform: `translate3d(${currentPos.x * colWidth}px, ${currentPos.y * rowHeight}px, 0)`,
        width: `${currentDim.width * colWidth - 12}px`,
        height: `${currentDim.height * rowHeight - 12}px`,
        zIndex: isSelected ? 30 : visual.layout.zIndex || 1,
        position: "absolute",
        left: 0,
        top: 0,
        transition: isDragging || isResizing ? "none" : "transform 0.15s ease, width 0.15s ease, height 0.15s ease",
      };

  const currentZIndex = visual.layout.zIndex || 1;

  // Visual-level appearance overrides — read straight from visual.style, the
  // same field the property panel and AI chat both write via
  // UPDATE_VISUAL/UPDATE_STYLE, so any change either path makes is visible
  // here without any separate rendering path.
  const border = visual.style?.border;
  const appearanceStyle: React.CSSProperties = {
    ...(visual.style?.background ? { backgroundColor: visual.style.background } : {}),
    ...(visual.style?.opacity !== undefined ? { opacity: visual.style.opacity } : {}),
    ...(border
      ? {
          borderStyle: border.style === "none" ? "none" : border.style || "solid",
          borderWidth: border.width ?? 1,
          borderColor: border.color || undefined,
          borderRadius: border.radius ?? undefined,
        }
      : {}),
  };
  const titleFontStyle: React.CSSProperties = {
    ...(visual.style?.font?.size ? { fontSize: `${visual.style.font.size}px` } : {}),
    ...(visual.style?.font?.weight
      ? {
          fontWeight:
            visual.style.font.weight === "semibold"
              ? 600
              : visual.style.font.weight === "bold"
                ? 700
                : visual.style.font.weight === "medium"
                  ? 500
                  : 400,
        }
      : {}),
    ...(visual.style?.font?.color ? { color: visual.style.font.color } : {}),
  };

  // Keyboard equivalent of drag/resize: Enter/Space selects (matches click);
  // once selected, arrow keys nudge position and Shift+arrow resizes, so
  // moving and resizing a chart is fully usable without a mouse or touch.
  // Delete/Backspace removes the selected chart, mirroring the toolbar button.
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect(visual.id);
      return;
    }
    if (isReadOnly || !isSelected) return;

    const STEP = 1;
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      onDelete(visual.id);
      return;
    }
    // All arithmetic here happens in ACTIVE-column units (matching the current
    // breakpoint's grid), converting back to canonical 12-column units only
    // for the final onMove/onResize call — same rule as drag/resize above.
    const activeX = toActiveColumns(visual.layout.x, columns);
    const activeWidth = toActiveColumns(visual.layout.width, columns);

    if (e.shiftKey && (e.key === "ArrowRight" || e.key === "ArrowLeft" || e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      const dw = e.key === "ArrowRight" ? STEP : e.key === "ArrowLeft" ? -STEP : 0;
      const dh = e.key === "ArrowDown" ? STEP : e.key === "ArrowUp" ? -STEP : 0;
      const newActiveWidth = Math.max(2, Math.min(columns - activeX, activeWidth + dw));
      onResize(
        visual.id,
        toCanonicalColumns(newActiveWidth, columns),
        Math.max(2, visual.layout.height + dh)
      );
      return;
    }
    if (e.key === "ArrowRight" || e.key === "ArrowLeft" || e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const dx = e.key === "ArrowRight" ? STEP : e.key === "ArrowLeft" ? -STEP : 0;
      const dy = e.key === "ArrowDown" ? STEP : e.key === "ArrowUp" ? -STEP : 0;
      const newActiveX = Math.max(0, Math.min(columns - activeWidth, activeX + dx));
      onMove(visual.id, toCanonicalColumns(newActiveX, columns), Math.max(0, visual.layout.y + dy));
    }
  };

  return (
    <div
      ref={cardRef}
      style={{ ...stylePos, ...appearanceStyle }}
      onClick={() => onSelect(visual.id)}
      role="option"
      aria-selected={isSelected}
      aria-label={`${visual.title || "Untitled chart"}, ${visual.kind} chart${isSelected ? " (selected)" : ""}${
        isReadOnly ? "" : ". Press Enter to select, arrow keys to move, Shift plus arrow keys to resize, Delete to remove."
      }`}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className={`group rounded-xl bg-app-surface/90 backdrop-blur-md border transition-all duration-200 flex flex-col overflow-hidden focus-visible:outline focus-visible:outline-2 focus-visible:outline-app-primary focus-visible:outline-offset-2 ${
        isSelected
          ? "border-app-primary shadow-xl ring-1 ring-app-primary/40"
          : "border-app-border/60 hover:border-app-border shadow-md"
      }`}
    >
      {/* Visual Header */}
      <div className="h-10 px-3 bg-app-bg/40 border-b border-app-border/60 flex items-center justify-between select-none">
        <div className="flex items-center gap-2 overflow-hidden">
          {/* Drag Handle with minimum 44x44px hit target */}
          {!isReadOnly && (
            <div
              onMouseDown={handleDragStart}
              onTouchStart={handleDragStart}
              aria-hidden="true"
              title="Drag to move chart (or select it and use arrow keys)"
              className="min-w-[44px] min-h-[44px] -ml-2 flex items-center justify-center cursor-grab active:cursor-grabbing text-app-muted hover:text-app-text transition-colors"
            >
              <GripVertical className="w-4 h-4" />
            </div>
          )}
          <span
            className="font-semibold text-xs text-app-text truncate"
            style={titleFontStyle}
            title={visual.title}
          >
            {visual.title || "Untitled Chart"}
          </span>
          <span className="text-[10px] px-1.5 py-0.5 rounded uppercase font-mono tracking-wider bg-app-surface text-app-muted">
            {visual.kind}
          </span>
        </div>

        {/* Action Controls with minimum 44x44px hit targets */}
        <div className="flex items-center space-x-1">
          {!isReadOnly && (
            <>
              {/* Bring Forward / Send Backward */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onZIndexChange(visual.id, currentZIndex + 1);
                }}
                aria-label={`Bring ${visual.title || "chart"} forward`}
                title="Bring Forward"
                className="w-8 h-8 flex items-center justify-center rounded text-app-muted hover:text-app-text hover:bg-app-bg transition-colors"
              >
                <ArrowUp className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onZIndexChange(visual.id, Math.max(1, currentZIndex - 1));
                }}
                aria-label={`Send ${visual.title || "chart"} backward`}
                title="Send Backward"
                className="w-8 h-8 flex items-center justify-center rounded text-app-muted hover:text-app-text hover:bg-app-bg transition-colors"
              >
                <ArrowDown className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
              {/* Edit Properties Button */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect(visual.id);
                }}
                aria-label={`Edit ${visual.title || "chart"} properties`}
                title="Edit Properties"
                className="w-8 h-8 flex items-center justify-center rounded text-app-muted hover:text-app-primary hover:bg-app-bg transition-colors"
              >
                <Settings className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
              {/* Delete Button */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(visual.id);
                }}
                aria-label={`Delete ${visual.title || "chart"}`}
                title="Delete Chart"
                className="w-8 h-8 flex items-center justify-center rounded text-app-muted hover:text-app-danger hover:bg-app-bg transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Chart Canvas Content */}
      <div className="flex-1 w-full min-h-0 relative p-2">
        <ChartRenderer visual={visual} dataRows={dataRows} theme={theme} />
      </div>

      {/* Corner Resize Handle with minimum 44x44px touch hit target */}
      {!isReadOnly && (
        <div
          onMouseDown={handleResizeStart}
          onTouchStart={handleResizeStart}
          aria-hidden="true"
          title="Drag to resize chart (or select it and use Shift+arrow keys)"
          className="absolute bottom-0 right-0 min-w-[44px] min-h-[44px] flex items-end justify-end p-1.5 cursor-nwse-resize select-none text-app-muted hover:text-app-primary transition-colors z-20"
        >
          <Maximize2 className="w-3.5 h-3.5 rotate-90" />
        </div>
      )}
    </div>
  );
};
