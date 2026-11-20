import React, { useState } from "react";
import type {
  Visual,
  VisualKind,
  ColumnProfile,
  AggregationType,
  BorderStyle,
  FontStyle,
} from "@ai-vis/types";
import {
  X,
  Sliders,
  Palette,
  Maximize2,
  Trash2,
  Check,
} from "lucide-react";
import { CHART_REGISTRY } from "../charts/registry.js";

export interface PropertyEditorProps {
  visual: Visual | null;
  datasetSchema: ColumnProfile[];
  /** Every dataset attached to the dashboard. A picker is only shown when there's more than one. */
  datasets?: { id: string; name: string; schema: ColumnProfile[] }[];
  /** The dashboard's primary dataset id — the fallback for a visual with no `datasetId` of its own. */
  primaryDatasetId?: string;
  onClose: () => void;
  onUpdate: (visualId: string, patch: Partial<Visual>) => void;
  onDelete: (visualId: string) => void;
}

const PALETTE_PRESETS = [
  { name: "Sky Blue", colors: ["#0c8ee6", "#38bdf8", "#0284c7", "#64748b", "#94a3b8"] },
  { name: "Emerald Teal", colors: ["#10b981", "#34d399", "#059669", "#0d9488", "#14b8a6"] },
  { name: "Sunset Orange", colors: ["#f59e0b", "#fbbf24", "#d97706", "#f97316", "#ea580c"] },
  { name: "Violet Orchid", colors: ["#8b5cf6", "#a78bfa", "#7c3aed", "#6366f1", "#4f46e5"] },
  { name: "Crimson Rose", colors: ["#ef4444", "#f87171", "#dc2626", "#e11d48", "#be123c"] },
];

export const PropertyEditor: React.FC<PropertyEditorProps> = ({
  visual,
  datasetSchema: fallbackDatasetSchema,
  datasets = [],
  primaryDatasetId,
  onClose,
  onUpdate,
  onDelete,
}) => {
  const [activeTab, setActiveTab] = useState<"data" | "style" | "layout">("data");

  if (!visual) return null;

  const selectedDatasetId = visual.datasetId ?? primaryDatasetId ?? "";
  const datasetSchema =
    datasets.length > 0
      ? datasets.find((d) => d.id === selectedDatasetId)?.schema ?? fallbackDatasetSchema
      : fallbackDatasetSchema;

  const handleDatasetChange = (datasetId: string) => {
    // Switching datasets: the old field mappings almost certainly don't exist
    // on the new schema, so clear them rather than leave stale field names
    // that would fail validation on the next edit.
    onUpdate(visual.id, { datasetId, encoding: {} } as Partial<Visual>);
  };

  const encoding = visual.encoding || {};
  const currentMeasure = encoding.measures?.[0];
  const currentAgg = currentMeasure?.aggregation || "sum";
  const currentColors = visual.style?.colors || PALETTE_PRESETS[0]!.colors;

  const handleTitleChange = (newTitle: string) => {
    onUpdate(visual.id, { title: newTitle });
  };

  const handleKindChange = (newKind: VisualKind) => {
    onUpdate(visual.id, { kind: newKind, type: newKind } as Partial<Visual>);
  };

  const handleDimensionChange = (xField: string) => {
    onUpdate(visual.id, {
      encoding: { ...encoding, xField },
    });
  };

  const handleMetricChange = (yField: string) => {
    onUpdate(visual.id, {
      encoding: {
        ...encoding,
        yField,
        measures: [
          {
            field: yField,
            aggregation: currentAgg,
            alias: `${currentAgg.toUpperCase()}(${yField})`,
          },
        ],
      },
    });
  };

  const handleAggregationChange = (agg: AggregationType) => {
    const metric = typeof encoding.yField === "string" ? encoding.yField : "Value";
    onUpdate(visual.id, {
      encoding: {
        ...encoding,
        measures: [
          {
            field: metric,
            aggregation: agg,
            alias: `${agg.toUpperCase()}(${metric})`,
          },
        ],
      },
    });
  };

  const handlePaletteSelect = (colors: string[]) => {
    onUpdate(visual.id, {
      style: { ...visual.style, colors },
    });
  };

  const handleSeriesColorChange = (index: number, color: string) => {
    const next = [...currentColors];
    next[index] = color;
    onUpdate(visual.id, { style: { ...visual.style, colors: next } });
  };

  const handleBorderChange = (patch: Partial<BorderStyle>) => {
    onUpdate(visual.id, {
      style: { ...visual.style, border: { ...visual.style?.border, ...patch } },
    });
  };

  const handleBackgroundChange = (background: string) => {
    onUpdate(visual.id, { style: { ...visual.style, background } });
  };

  const handleFontChange = (patch: Partial<FontStyle>) => {
    onUpdate(visual.id, {
      style: { ...visual.style, font: { ...visual.style?.font, ...patch } },
    });
  };

  const handleLegendToggle = (show: boolean) => {
    onUpdate(visual.id, { style: { ...visual.style, legend: { show } } });
  };

  const handleDataLabelsToggle = (show: boolean) => {
    onUpdate(visual.id, { style: { ...visual.style, dataLabels: { show } } });
  };

  const handleLayoutChange = (key: "x" | "y" | "width" | "height", val: number) => {
    onUpdate(visual.id, {
      layout: { ...visual.layout, [key]: Math.max(1, val) },
    });
  };

  const isChartKind = ["bar", "line", "area", "pie", "scatter"].includes(visual.kind);
  const border = visual.style?.border || {};
  const font = visual.style?.font || {};

  return (
    <>
      {/* Backdrop on mobile only, so tapping outside closes the full-screen overlay. */}
      <div
        className="fixed inset-0 z-30 bg-black/40 sm:hidden"
        onClick={onClose}
        aria-hidden="true"
      />

      <aside
        className="fixed z-40 inset-0 sm:inset-auto sm:top-16 sm:bottom-0 sm:right-0 sm:w-96 bg-app-surface/95 backdrop-blur-xl sm:border-l border-app-border shadow-2xl flex flex-col animate-in slide-in-from-right duration-200"
        role="dialog"
        aria-modal="true"
        aria-label="Visual properties"
      >
        {/* Editor Header */}
        <div className="h-14 px-4 border-b border-app-border flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2 overflow-hidden">
            <div className="w-7 h-7 rounded-lg bg-app-primary/20 text-app-primary flex items-center justify-center">
              <Sliders className="w-3.5 h-3.5" aria-hidden="true" />
            </div>
            <div className="overflow-hidden">
              <h3 className="text-xs font-semibold text-app-text truncate">
                {visual.title || "Chart Properties"}
              </h3>
              <span className="text-[10px] text-app-muted uppercase font-mono">
                {visual.kind} visual
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close properties panel"
            className="w-9 h-9 flex items-center justify-center rounded-lg text-app-muted hover:text-app-text hover:bg-app-bg transition-colors"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

      {/* Navigation Tabs */}
      <div className="px-3 pt-2 border-b border-app-border flex space-x-1">
        <button
          type="button"
          onClick={() => setActiveTab("data")}
          className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-colors min-h-[44px] flex items-center justify-center gap-1.5 ${
            activeTab === "data"
              ? "bg-app-surface text-app-text shadow-sm"
              : "text-app-muted hover:text-app-text"
          }`}
        >
          <Sliders className="w-3.5 h-3.5" />
          Data
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("style")}
          className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-colors min-h-[44px] flex items-center justify-center gap-1.5 ${
            activeTab === "style"
              ? "bg-app-surface text-app-text shadow-sm"
              : "text-app-muted hover:text-app-text"
          }`}
        >
          <Palette className="w-3.5 h-3.5" />
          Style
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("layout")}
          className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-colors min-h-[44px] flex items-center justify-center gap-1.5 ${
            activeTab === "layout"
              ? "bg-app-surface text-app-text shadow-sm"
              : "text-app-muted hover:text-app-text"
          }`}
        >
          <Maximize2 className="w-3.5 h-3.5" />
          Layout
        </button>
      </div>

      {/* Tab Panels */}
      <div className="flex-1 overflow-y-auto p-4 space-y-5 text-xs">
        {/* DATA TAB */}
        {activeTab === "data" && (
          <div className="space-y-4">
            {/* Title */}
            <div>
              <label className="block text-app-text font-medium mb-1.5">
                Chart Title
              </label>
              <input
                type="text"
                value={visual.title}
                onChange={(e) => handleTitleChange(e.target.value)}
                className="w-full h-10 px-3 bg-app-bg border border-app-border rounded-xl text-app-text focus:outline-none focus:border-app-primary transition-colors"
              />
            </div>

            {/* Change Chart Type */}
            <div>
              <label className="block text-app-text font-medium mb-1.5">
                Chart Type
              </label>
              <div className="grid grid-cols-3 gap-2">
                {CHART_REGISTRY.map((item) => {
                  const Icon = item.icon;
                  const isSelected = visual.kind === item.kind;
                  return (
                    <button
                      key={item.kind}
                      type="button"
                      onClick={() => handleKindChange(item.kind as VisualKind)}
                      className={`p-2 rounded-xl border flex flex-col items-center gap-1 min-h-[44px] transition-colors ${
                        isSelected
                          ? "bg-app-primary/10 border-app-primary text-app-text"
                          : "bg-app-bg/60 border-app-border text-app-muted hover:text-app-text"
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                      <span className="text-[11px] font-medium">{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Dataset Picker — only shown once more than one dataset is attached */}
            {datasets.length > 1 && (
              <div>
                <label className="block text-app-text font-medium mb-1.5">Dataset</label>
                <select
                  value={selectedDatasetId}
                  onChange={(e) => handleDatasetChange(e.target.value)}
                  className="w-full h-10 px-3 bg-app-bg border border-app-border rounded-xl text-app-text focus:outline-none focus:border-app-primary transition-colors"
                >
                  {datasets.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Dimension Column */}
            <div>
              <label className="block text-app-text font-medium mb-1.5">
                Dimension (X-Axis)
              </label>
              <select
                value={encoding.xField || ""}
                onChange={(e) => handleDimensionChange(e.target.value)}
                className="w-full h-10 px-3 bg-app-bg border border-app-border rounded-xl text-app-text focus:outline-none focus:border-app-primary transition-colors"
              >
                <option value="">(Select dimension column)</option>
                {datasetSchema.map((col) => (
                  <option key={col.name} value={col.name}>
                    {col.name} ({col.semanticType || col.dataType})
                  </option>
                ))}
              </select>
            </div>

            {/* Metric Column */}
            <div>
              <label className="block text-app-text font-medium mb-1.5">
                Metric (Y-Axis)
              </label>
              <select
                value={typeof encoding.yField === "string" ? encoding.yField : ""}
                onChange={(e) => handleMetricChange(e.target.value)}
                className="w-full h-10 px-3 bg-app-bg border border-app-border rounded-xl text-app-text focus:outline-none focus:border-app-primary transition-colors"
              >
                <option value="">(Select metric column)</option>
                {datasetSchema.map((col) => (
                  <option key={col.name} value={col.name}>
                    {col.name} ({col.semanticType || col.dataType})
                  </option>
                ))}
              </select>
            </div>

            {/* Aggregation */}
            <div>
              <label className="block text-app-text font-medium mb-1.5">
                Aggregation Function
              </label>
              <select
                value={currentAgg}
                onChange={(e) => handleAggregationChange(e.target.value as AggregationType)}
                className="w-full h-10 px-3 bg-app-bg border border-app-border rounded-xl text-app-text focus:outline-none focus:border-app-primary transition-colors"
              >
                <option value="sum">Sum</option>
                <option value="avg">Average</option>
                <option value="count">Count</option>
                <option value="min">Minimum</option>
                <option value="max">Maximum</option>
                <option value="distinctCount">Distinct Count</option>
              </select>
            </div>
          </div>
        )}

        {/* STYLE TAB */}
        {activeTab === "style" && (
          <div className="space-y-5">
            <div>
              <label className="block text-app-text font-medium mb-2">
                Color Palette Presets
              </label>
              <div className="space-y-2">
                {PALETTE_PRESETS.map((p) => {
                  const isMatch =
                    currentColors[0]?.toLowerCase() === p.colors[0]?.toLowerCase();
                  return (
                    <button
                      key={p.name}
                      type="button"
                      onClick={() => handlePaletteSelect(p.colors)}
                      className={`w-full p-2.5 rounded-xl border flex items-center justify-between min-h-[44px] transition-colors ${
                        isMatch
                          ? "bg-app-surface border-app-primary ring-1 ring-app-primary/40 text-app-text"
                          : "bg-app-bg/60 border-app-border text-app-muted hover:border-app-border"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <div className="flex -space-x-1">
                          {p.colors.slice(0, 4).map((c, i) => (
                            <span
                              key={i}
                              style={{ backgroundColor: c }}
                              className="w-4 h-4 rounded-full border border-app-border"
                            />
                          ))}
                        </div>
                        <span className="text-xs font-medium text-app-text">{p.name}</span>
                      </div>
                      {isMatch && <Check className="w-3.5 h-3.5 text-app-primary" />}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Per-series color pickers */}
            {isChartKind && (
              <div>
                <label className="block text-app-text font-medium mb-2">
                  Series Colors
                </label>
                <div className="grid grid-cols-5 gap-2">
                  {currentColors.slice(0, 5).map((c, i) => (
                    <label
                      key={i}
                      className="relative w-full aspect-square rounded-lg border border-app-border overflow-hidden cursor-pointer"
                      style={{ backgroundColor: c }}
                      title={`Series ${i + 1} color`}
                    >
                      <input
                        type="color"
                        value={c}
                        onChange={(e) => handleSeriesColorChange(i, e.target.value)}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                        aria-label={`Series ${i + 1} color`}
                      />
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* Background */}
            <div>
              <label className="block text-app-text font-medium mb-2">Background</label>
              <div className="flex items-center gap-2">
                <label
                  className="w-10 h-10 rounded-lg border border-app-border overflow-hidden cursor-pointer flex-shrink-0"
                  style={{ backgroundColor: visual.style?.background || "transparent" }}
                >
                  <input
                    type="color"
                    value={visual.style?.background || "#1e293b"}
                    onChange={(e) => handleBackgroundChange(e.target.value)}
                    className="w-full h-full opacity-0 cursor-pointer"
                    aria-label="Background color"
                  />
                </label>
                <button
                  type="button"
                  onClick={() =>
                    onUpdate(visual.id, {
                      style: { ...visual.style, background: undefined },
                    })
                  }
                  className="text-[11px] text-app-muted hover:text-app-text underline"
                >
                  Reset to default
                </button>
              </div>
            </div>

            {/* Border */}
            <div>
              <label className="block text-app-text font-medium mb-2">Border</label>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <span className="block text-[11px] text-app-muted mb-1">Color</span>
                  <label
                    className="block w-full h-9 rounded-lg border border-app-border overflow-hidden cursor-pointer"
                    style={{ backgroundColor: border.color || "#334155" }}
                  >
                    <input
                      type="color"
                      value={border.color || "#334155"}
                      onChange={(e) => handleBorderChange({ color: e.target.value })}
                      className="w-full h-full opacity-0 cursor-pointer"
                      aria-label="Border color"
                    />
                  </label>
                </div>
                <div>
                  <span className="block text-[11px] text-app-muted mb-1">Style</span>
                  <select
                    value={border.style || "solid"}
                    onChange={(e) =>
                      handleBorderChange({ style: e.target.value as BorderStyle["style"] })
                    }
                    className="w-full h-9 px-2 bg-app-bg border border-app-border rounded-lg text-app-text"
                  >
                    <option value="solid">Solid</option>
                    <option value="dashed">Dashed</option>
                    <option value="dotted">Dotted</option>
                    <option value="none">None</option>
                  </select>
                </div>
                <div>
                  <span className="block text-[11px] text-app-muted mb-1">Width (px)</span>
                  <input
                    type="number"
                    min="0"
                    max="12"
                    value={border.width ?? 1}
                    onChange={(e) => handleBorderChange({ width: Number(e.target.value) })}
                    className="w-full h-9 px-2 bg-app-bg border border-app-border rounded-lg text-app-text"
                  />
                </div>
                <div>
                  <span className="block text-[11px] text-app-muted mb-1">Radius (px)</span>
                  <input
                    type="number"
                    min="0"
                    max="48"
                    value={border.radius ?? 12}
                    onChange={(e) => handleBorderChange({ radius: Number(e.target.value) })}
                    className="w-full h-9 px-2 bg-app-bg border border-app-border rounded-lg text-app-text"
                  />
                </div>
              </div>
            </div>

            {/* Font */}
            <div>
              <label className="block text-app-text font-medium mb-2">Title Font</label>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <span className="block text-[11px] text-app-muted mb-1">Size (px)</span>
                  <input
                    type="number"
                    min="8"
                    max="48"
                    value={font.size ?? 13}
                    onChange={(e) => handleFontChange({ size: Number(e.target.value) })}
                    className="w-full h-9 px-2 bg-app-bg border border-app-border rounded-lg text-app-text"
                  />
                </div>
                <div>
                  <span className="block text-[11px] text-app-muted mb-1">Weight</span>
                  <select
                    value={font.weight || "semibold"}
                    onChange={(e) =>
                      handleFontChange({ weight: e.target.value as FontStyle["weight"] })
                    }
                    className="w-full h-9 px-2 bg-app-bg border border-app-border rounded-lg text-app-text"
                  >
                    <option value="normal">Normal</option>
                    <option value="medium">Medium</option>
                    <option value="semibold">Semibold</option>
                    <option value="bold">Bold</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Legend & Data Labels toggles */}
            {isChartKind && (
              <div className="space-y-2.5">
                <label className="flex items-center justify-between p-2.5 rounded-xl border border-app-border bg-app-bg/60 min-h-[44px] cursor-pointer">
                  <span className="text-app-text font-medium">Show Legend</span>
                  <input
                    type="checkbox"
                    checked={visual.style?.legend?.show ?? true}
                    onChange={(e) => handleLegendToggle(e.target.checked)}
                    className="w-4 h-4 accent-app-primary"
                  />
                </label>
                <label className="flex items-center justify-between p-2.5 rounded-xl border border-app-border bg-app-bg/60 min-h-[44px] cursor-pointer">
                  <span className="text-app-text font-medium">Show Data Labels</span>
                  <input
                    type="checkbox"
                    checked={visual.style?.dataLabels?.show ?? false}
                    onChange={(e) => handleDataLabelsToggle(e.target.checked)}
                    className="w-4 h-4 accent-app-primary"
                  />
                </label>
              </div>
            )}
          </div>
        )}

        {/* LAYOUT TAB */}
        {activeTab === "layout" && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-app-text font-medium mb-1">
                  Grid X (Column)
                </label>
                <input
                  type="number"
                  min="0"
                  max="11"
                  value={visual.layout.x}
                  onChange={(e) => handleLayoutChange("x", parseInt(e.target.value, 10))}
                  className="w-full h-10 px-3 bg-app-bg border border-app-border rounded-xl text-app-text"
                />
              </div>
              <div>
                <label className="block text-app-text font-medium mb-1">
                  Grid Y (Row)
                </label>
                <input
                  type="number"
                  min="0"
                  value={visual.layout.y}
                  onChange={(e) => handleLayoutChange("y", parseInt(e.target.value, 10))}
                  className="w-full h-10 px-3 bg-app-bg border border-app-border rounded-xl text-app-text"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-app-text font-medium mb-1">
                  Width (Columns)
                </label>
                <input
                  type="number"
                  min="2"
                  max="12"
                  value={visual.layout.width}
                  onChange={(e) => handleLayoutChange("width", parseInt(e.target.value, 10))}
                  className="w-full h-10 px-3 bg-app-bg border border-app-border rounded-xl text-app-text"
                />
              </div>
              <div>
                <label className="block text-app-text font-medium mb-1">
                  Height (Rows)
                </label>
                <input
                  type="number"
                  min="2"
                  value={visual.layout.height}
                  onChange={(e) => handleLayoutChange("height", parseInt(e.target.value, 10))}
                  className="w-full h-10 px-3 bg-app-bg border border-app-border rounded-xl text-app-text"
                />
              </div>
            </div>

            <div className="pt-4 border-t border-app-border">
              <button
                type="button"
                onClick={() => {
                  onDelete(visual.id);
                  onClose();
                }}
                className="w-full py-2.5 px-3 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 flex items-center justify-center gap-2 font-semibold transition-colors min-h-[44px]"
              >
                <Trash2 className="w-4 h-4" />
                Delete Visual from Dashboard
              </button>
            </div>
          </div>
        )}
      </div>
      </aside>
    </>
  );
};
