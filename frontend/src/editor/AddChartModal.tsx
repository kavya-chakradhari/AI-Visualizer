import React, { useState, useEffect } from "react";
import type {
  Visual,
  VisualKind,
  ColumnProfile,
  AggregationType,
  CommandPayloadMap,
} from "@ai-vis/types";
import { Layers, X, Plus } from "lucide-react";
import { CHART_REGISTRY } from "../charts/registry.js";

export interface AddChartModalProps {
  isOpen: boolean;
  onClose: () => void;
  pageId: string;
  datasetSchema: ColumnProfile[];
  /** Every dataset attached to the dashboard. A picker is only shown when there's more than one. */
  datasets?: { id: string; name: string; schema: ColumnProfile[] }[];
  /** Which dataset id to preselect (the dashboard's primary dataset). */
  defaultDatasetId?: string;
  /** Visuals already on this page — used to place the new one below them, not stacked at (0,0). */
  existingVisuals: Pick<Visual, "layout">[];
  onSubmit: (payload: CommandPayloadMap["CREATE_VISUAL"]) => void;
}

// Chart type list is sourced from the shared registry (frontend/src/charts/registry.ts)
// so this modal and the property panel's type switcher never drift apart.
const CHART_TYPES = CHART_REGISTRY;

const AGGREGATIONS: Array<{ type: AggregationType; label: string }> = [
  { type: "sum", label: "Sum (Total)" },
  { type: "avg", label: "Average (Mean)" },
  { type: "count", label: "Count (Rows)" },
  { type: "min", label: "Minimum" },
  { type: "max", label: "Maximum" },
  { type: "distinctCount", label: "Distinct Count" },
];

export const AddChartModal: React.FC<AddChartModalProps> = ({
  isOpen,
  onClose,
  pageId,
  datasetSchema: fallbackDatasetSchema,
  datasets = [],
  defaultDatasetId,
  existingVisuals,
  onSubmit,
}) => {
  const [selectedKind, setSelectedKind] = useState<VisualKind>("bar");
  const [dimensionField, setDimensionField] = useState<string>("");
  const [metricField, setMetricField] = useState<string>("");
  const [aggregation, setAggregation] = useState<AggregationType>("sum");
  const [title, setTitle] = useState<string>("");
  const [selectedDatasetId, setSelectedDatasetId] = useState<string>(defaultDatasetId ?? "");

  useEffect(() => {
    if (isOpen) setSelectedDatasetId(defaultDatasetId ?? datasets[0]?.id ?? "");
  }, [isOpen, defaultDatasetId, datasets]);

  const datasetSchema =
    datasets.length > 0
      ? datasets.find((d) => d.id === selectedDatasetId)?.schema ?? fallbackDatasetSchema
      : fallbackDatasetSchema;

  // Populate sensible initial defaults from schema
  useEffect(() => {
    if (datasetSchema.length > 0) {
      const catCol =
        datasetSchema.find(
          (c) =>
            c.semanticType === "categorical" ||
            c.dataType === "string"
        )?.name || datasetSchema[0]!.name;

      const numCol =
        datasetSchema.find(
          (c) =>
            c.semanticType === "currency" ||
            c.semanticType === "percentage" ||
            c.semanticType === "numeric" ||
            c.dataType === "number"
        )?.name || datasetSchema[Math.min(1, datasetSchema.length - 1)]!.name;

      setDimensionField(catCol);
      setMetricField(numCol);
      setTitle(`${numCol} by ${catCol}`);
    }
  }, [datasetSchema, isOpen]);

  // Update suggested title when fields change
  const handleDimensionChange = (newDim: string) => {
    setDimensionField(newDim);
    if (metricField) {
      setTitle(`${metricField} by ${newDim}`);
    }
  };

  const handleMetricChange = (newMetric: string) => {
    setMetricField(newMetric);
    if (dimensionField) {
      setTitle(`${newMetric} by ${dimensionField}`);
    } else {
      setTitle(newMetric);
    }
  };

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const chartTitle =
      title.trim() ||
      (metricField ? `${metricField} by ${dimensionField || "Category"}` : "New Visual");

    // Place the new chart below everything already on the page — otherwise
    // every chart lands at (0,0) and stacks exactly on top of the last one,
    // forcing a manual drag apart before the dashboard is even readable.
    const nextY = existingVisuals.reduce(
      (max, v) => Math.max(max, v.layout.y + v.layout.height),
      0
    );

    const payload: CommandPayloadMap["CREATE_VISUAL"] = {
      pageId,
      kind: selectedKind,
      title: chartTitle,
      layout: {
        x: 0,
        y: nextY,
        width: selectedKind === "kpi" ? 4 : 6,
        height: selectedKind === "kpi" ? 3 : 4,
      },
      encoding: {
        xField: dimensionField,
        yField: metricField,
        measures: [
          {
            field: metricField,
            aggregation,
            alias: `${aggregation.toUpperCase()}(${metricField})`,
          },
        ],
      },
      style: {
        colors: ["#0c8ee6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6"],
      },
      ...(datasets.length > 1 && selectedDatasetId ? { datasetId: selectedDatasetId } : {}),
    };

    // KPI's valueField is derived server-side from encoding.measures[0] — the
    // CREATE_VISUAL schema is strict and rejects any key it doesn't define,
    // so it must never be set here directly (it used to be, and every KPI
    // creation failed schema validation as a result).

    onSubmit(payload);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-app-bg/80 backdrop-blur-sm animate-in fade-in duration-150">
      <div
        className="w-full max-w-xl rounded-2xl bg-app-surface border border-app-border shadow-2xl flex flex-col overflow-hidden text-app-text max-h-[90vh]"
        role="dialog"
        aria-modal="true"
        aria-label="Add visual to canvas"
      >
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-app-border flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-app-primary/20 text-app-primary flex items-center justify-center">
              <Layers className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-app-text">Add Visual to Canvas</h2>
              <p className="text-xs text-app-muted">
                Configure chart type, dimension, and aggregated metrics
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="w-9 h-9 flex items-center justify-center rounded-lg text-app-muted hover:text-app-text hover:bg-app-bg transition-colors flex-shrink-0"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        {/* Modal Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5 overflow-y-auto">
          {/* Chart Type Grid */}
          <div>
            <label className="block text-xs font-semibold text-app-text uppercase tracking-wider mb-2.5">
              1. Choose Chart Type
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              {CHART_TYPES.map((chart) => {
                const Icon = chart.icon;
                const isSelected = selectedKind === chart.kind;
                return (
                  <button
                    key={chart.kind}
                    type="button"
                    onClick={() => setSelectedKind(chart.kind)}
                    className={`p-3 rounded-xl border text-left flex flex-col gap-1.5 transition-all min-h-[44px] ${
                      isSelected
                        ? "bg-app-primary/10 border-app-primary text-app-text ring-1 ring-app-primary/50"
                        : "bg-app-surface/40 border-app-border/80 text-app-text hover:border-app-border hover:bg-app-surface/80"
                    }`}
                  >
                    <Icon
                      className={`w-5 h-5 ${
                        isSelected ? "text-app-primary" : "text-app-muted"
                      }`}
                    />
                    <div>
                      <div className="text-xs font-semibold">{chart.label}</div>
                      <div className="text-[10px] text-app-muted line-clamp-1">
                        {chart.description}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Dataset Picker — only shown once more than one dataset is attached */}
          {datasets.length > 1 && (
            <div>
              <label
                htmlFor="dataset-select"
                className="block text-xs font-semibold text-app-text uppercase tracking-wider mb-2.5"
              >
                Dataset
              </label>
              <select
                id="dataset-select"
                value={selectedDatasetId}
                onChange={(e) => setSelectedDatasetId(e.target.value)}
                className="w-full h-11 px-3 bg-app-bg border border-app-border rounded-xl text-xs text-app-text focus:outline-none focus:border-app-primary transition-colors"
              >
                {datasets.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Fields Selection */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Dimension Column */}
            <div>
              <label
                htmlFor="dim-select"
                className="block text-xs font-medium text-app-text mb-1.5"
              >
                Dimension / Category (X-Axis)
              </label>
              <select
                id="dim-select"
                value={dimensionField}
                onChange={(e) => handleDimensionChange(e.target.value)}
                className="w-full h-11 px-3 bg-app-bg border border-app-border rounded-xl text-xs text-app-text focus:outline-none focus:border-app-primary transition-colors"
              >
                {datasetSchema.map((col) => (
                  <option key={col.name} value={col.name}>
                    {col.name} ({col.semanticType || col.dataType})
                  </option>
                ))}
              </select>
            </div>

            {/* Metric Column */}
            <div>
              <label
                htmlFor="metric-select"
                className="block text-xs font-medium text-app-text mb-1.5"
              >
                Metric / Measure (Y-Axis)
              </label>
              <select
                id="metric-select"
                value={metricField}
                onChange={(e) => handleMetricChange(e.target.value)}
                className="w-full h-11 px-3 bg-app-bg border border-app-border rounded-xl text-xs text-app-text focus:outline-none focus:border-app-primary transition-colors"
              >
                {datasetSchema.map((col) => (
                  <option key={col.name} value={col.name}>
                    {col.name} ({col.semanticType || col.dataType})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Aggregation & Title */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Aggregation */}
            <div>
              <label
                htmlFor="agg-select"
                className="block text-xs font-medium text-app-text mb-1.5"
              >
                Aggregation Function
              </label>
              <select
                id="agg-select"
                value={aggregation}
                onChange={(e) => setAggregation(e.target.value as AggregationType)}
                className="w-full h-11 px-3 bg-app-bg border border-app-border rounded-xl text-xs text-app-text focus:outline-none focus:border-app-primary transition-colors"
              >
                {AGGREGATIONS.map((agg) => (
                  <option key={agg.type} value={agg.type}>
                    {agg.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Title */}
            <div>
              <label
                htmlFor="chart-title"
                className="block text-xs font-medium text-app-text mb-1.5"
              >
                Chart Title
              </label>
              <input
                id="chart-title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Sales by Region"
                className="w-full h-11 px-3 bg-app-bg border border-app-border rounded-xl text-xs text-app-text focus:outline-none focus:border-app-primary transition-colors"
              />
            </div>
          </div>

          {/* Action Buttons with touch-friendly min 44x44px target */}
          <div className="pt-2 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl border border-app-border text-app-muted hover:text-app-text hover:bg-app-surface text-xs font-semibold transition-colors min-h-[44px]"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-app-primary hover:brightness-110 text-white text-xs font-semibold shadow-md transition-all active:scale-[0.98] min-h-[44px]"
            >
              <Plus className="w-4 h-4" />
              Add Chart to Canvas
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
