import React, { useState } from "react";
import {
  Hash,
  Tag,
  Calendar,
  Key,
  Percent,
  DollarSign,
  HelpCircle,
  AlertTriangle,
  Check,
  ChevronDown,
  Layers,
  Database,
  HardDrive,
} from "lucide-react";
import type { ColumnProfile, FieldSemanticType, Dataset } from "@ai-vis/types";

interface ColumnSummaryPanelProps {
  dataset: Dataset;
  onUpdateColumnType?: (columnName: string, newSemanticType: FieldSemanticType) => void;
}

export const ColumnSummaryPanel: React.FC<ColumnSummaryPanelProps> = ({
  dataset,
  onUpdateColumnType,
}) => {
  const [activeOverrides, setActiveOverrides] = useState<Record<string, FieldSemanticType>>({});
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);

  const getSemanticTypeBadge = (type: FieldSemanticType, isAmbiguous?: boolean) => {
    switch (type) {
      case "numeric":
        return {
          icon: <Hash className="w-3.5 h-3.5" />,
          label: "Numeric",
          bg: "bg-blue-500/10 text-blue-400 border-blue-500/20",
        };
      case "categorical":
        return {
          icon: <Tag className="w-3.5 h-3.5" />,
          label: "Categorical",
          bg: "bg-purple-500/10 text-purple-400 border-purple-500/20",
        };
      case "date":
        return {
          icon: <Calendar className="w-3.5 h-3.5" />,
          label: "Date / Time",
          bg: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
        };
      case "identifier":
        return {
          icon: <Key className="w-3.5 h-3.5" />,
          label: "Identifier",
          bg: "bg-amber-500/10 text-amber-400 border-amber-500/20",
        };
      case "percentage":
        return {
          icon: <Percent className="w-3.5 h-3.5" />,
          label: "Percentage",
          bg: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20",
        };
      case "currency":
        return {
          icon: <DollarSign className="w-3.5 h-3.5" />,
          label: "Currency",
          bg: "bg-green-500/10 text-green-400 border-green-500/20",
        };
      case "unknown":
      default:
        return {
          icon: isAmbiguous ? (
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
          ) : (
            <HelpCircle className="w-3.5 h-3.5" />
          ),
          label: isAmbiguous ? "Ambiguous (Unknown)" : "Unknown",
          bg: "bg-app-border/40 text-app-text border-app-border/40",
        };
    }
  };

  const handleSelectOverride = (colName: string, type: FieldSemanticType) => {
    setActiveOverrides((prev) => ({ ...prev, [colName]: type }));
    setOpenDropdown(null);
    if (onUpdateColumnType) {
      onUpdateColumnType(colName, type);
    }
  };

  const availableTypes: FieldSemanticType[] = [
    "numeric",
    "categorical",
    "date",
    "identifier",
    "percentage",
    "currency",
    "unknown",
  ];

  const formatFileSize = (bytes?: number) => {
    if (!bytes) return "N/A";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  return (
    <div className="space-y-6">
      {/* Overview Stat Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-app-surface/70 border border-app-border rounded-xl p-4">
          <div className="flex items-center space-x-2 text-app-muted text-xs font-medium mb-1">
            <Database className="w-4 h-4 text-app-primary" />
            <span>Total Records</span>
          </div>
          <p className="text-xl sm:text-2xl font-bold text-app-text">
            {dataset.rowCount.toLocaleString()}
          </p>
          <span className="text-[11px] text-app-muted">Rows parsed & stored</span>
        </div>

        <div className="bg-app-surface/70 border border-app-border rounded-xl p-4">
          <div className="flex items-center space-x-2 text-app-muted text-xs font-medium mb-1">
            <Layers className="w-4 h-4 text-purple-400" />
            <span>Columns</span>
          </div>
          <p className="text-xl sm:text-2xl font-bold text-app-text">{dataset.columnCount}</p>
          <span className="text-[11px] text-app-muted">Profiled attributes</span>
        </div>

        <div className="bg-app-surface/70 border border-app-border rounded-xl p-4">
          <div className="flex items-center space-x-2 text-app-muted text-xs font-medium mb-1">
            <HardDrive className="w-4 h-4 text-emerald-400" />
            <span>File Size</span>
          </div>
          <p className="text-xl sm:text-2xl font-bold text-app-text">
            {formatFileSize(dataset.fileSizeBytes)}
          </p>
          <span className="text-[11px] text-app-muted">
            {dataset.sourceFileType || "CSV"} Ingestion
          </span>
        </div>

        <div className="bg-app-surface/70 border border-app-border rounded-xl p-4">
          <div className="flex items-center space-x-2 text-app-muted text-xs font-medium mb-1">
            <Check className="w-4 h-4 text-cyan-400" />
            <span>Profiling Engine</span>
          </div>
          <p className="text-xl sm:text-2xl font-bold text-cyan-400">100%</p>
          <span className="text-[11px] text-app-muted">Deterministic stats</span>
        </div>
      </div>

      {/* Column Schema Cards Grid */}
      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h3 className="text-base sm:text-lg font-semibold text-app-text">
              Profiled Column Schema & Statistics
            </h3>
            <p className="text-xs text-app-muted">
              Each column is profiled for semantic type, null ratios, cardinality, and statistical
              bounds without LLM hallucinations.
            </p>
          </div>
          <span className="text-xs font-mono text-app-muted bg-app-surface/80 px-2.5 py-1 rounded-lg self-start">
            {dataset.schema.length} Profiled Fields
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {dataset.schema.map((col: ColumnProfile) => {
            const currentType = activeOverrides[col.name] || col.semanticType;
            const badge = getSemanticTypeBadge(currentType, col.isAmbiguous);
            const isAmbiguous = col.isAmbiguous && !activeOverrides[col.name];

            return (
              <div
                key={col.name}
                className={`bg-app-surface/60 border rounded-xl p-4 space-y-3 transition-all ${
                  isAmbiguous
                    ? "border-amber-500/40 bg-amber-950/10 shadow-sm shadow-amber-500/5"
                    : "border-app-border hover:border-app-border"
                }`}
              >
                {/* Column Header & Type Selector */}
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h4
                      className="text-sm font-semibold text-app-text truncate"
                      title={col.name}
                    >
                      {col.name}
                    </h4>
                    <span className="text-[11px] text-app-muted font-mono">
                      data: {col.dataType}
                    </span>
                  </div>

                  {/* Semantic Type Badge / Dropdown */}
                  <div className="relative shrink-0">
                    <button
                      type="button"
                      onClick={() =>
                        setOpenDropdown(openDropdown === col.name ? null : col.name)
                      }
                      aria-haspopup="listbox"
                      aria-expanded={openDropdown === col.name}
                      aria-label={`Column type for ${col.name}: ${badge.label}. Change type`}
                      className={`inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-lg border text-xs font-medium transition-colors ${badge.bg}`}
                    >
                      {badge.icon}
                      <span>{badge.label}</span>
                      <ChevronDown className="w-3 h-3 ml-0.5 opacity-60" aria-hidden="true" />
                    </button>

                    {/* Interactive Confirmation Dropdown (Constraint: confirm ambiguous type) */}
                    {openDropdown === col.name && (
                      <div className="absolute right-0 mt-1 w-44 bg-app-surface border border-app-border rounded-xl shadow-xl z-20 py-1.5">
                        <div className="px-3 py-1 text-[10px] uppercase font-bold text-app-muted tracking-wider">
                          Confirm / Override Type
                        </div>
                        {availableTypes.map((t) => {
                          const tBadge = getSemanticTypeBadge(t);
                          return (
                            <button
                              key={t}
                              type="button"
                              onClick={() => handleSelectOverride(col.name, t)}
                              className={`w-full text-left px-3 py-1.5 text-xs flex items-center space-x-2 hover:bg-app-surface transition-colors ${
                                currentType === t
                                  ? "text-app-primary font-medium"
                                  : "text-app-text"
                              }`}
                            >
                              {tBadge.icon}
                              <span>{tBadge.label}</span>
                              {currentType === t && (
                                <Check className="w-3 h-3 ml-auto text-app-primary" />
                              )}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>

                {/* Ambiguous Warning Alert (Constraint) */}
                {isAmbiguous && (
                  <div className="p-2 rounded-lg bg-amber-950/40 border border-amber-500/30 text-amber-200 text-xs flex items-start space-x-1.5">
                    <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                    <span className="text-[11px] leading-snug">
                      <strong>Ambiguous Type:</strong> Pure statistical checks detected mixed or
                      uncertain patterns. Confirm the type using the dropdown above.
                    </span>
                  </div>
                )}

                {/* Metrics Stats */}
                <div className="grid grid-cols-2 gap-2 text-xs pt-1">
                  <div className="bg-app-surface/40 rounded-lg p-2">
                    <div className="flex justify-between text-app-muted mb-1 text-[11px]">
                      <span>Null Values</span>
                      <span>{col.nullPercentage}%</span>
                    </div>
                    <div className="h-1.5 w-full bg-app-border rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${
                          col.nullPercentage > 50
                            ? "bg-red-400"
                            : col.nullPercentage > 0
                            ? "bg-amber-400"
                            : "bg-emerald-400"
                        }`}
                        style={{ width: `${Math.min(100, col.nullPercentage)}%` }}
                      />
                    </div>
                    <span className="text-[10px] text-app-muted mt-1 block">
                      {col.nullCount} of {col.totalCount} missing
                    </span>
                  </div>

                  <div className="bg-app-surface/40 rounded-lg p-2">
                    <span className="text-app-muted text-[11px] block mb-0.5">Unique Count</span>
                    <span className="text-sm font-semibold text-app-text">
                      {col.uniqueCount.toLocaleString()}
                    </span>
                    <span className="text-[10px] text-app-muted block truncate">
                      ratio: {(col.cardinalityRatio * 100).toFixed(1)}%
                    </span>
                  </div>
                </div>

                {/* Min / Max / Mean for numeric/date/currency/percentage */}
                {(col.min !== null || col.max !== null || col.mean !== null) && (
                  <div className="bg-app-surface/30 rounded-lg p-2 text-xs flex items-center justify-between text-app-muted font-mono">
                    {col.min !== null && (
                      <div>
                        <span className="text-[10px] text-app-muted block">MIN</span>
                        <span className="text-app-text">
                          {typeof col.min === "string" && col.min.includes("T")
                            ? col.min.substring(0, 10)
                            : col.min}
                        </span>
                      </div>
                    )}
                    {col.max !== null && (
                      <div>
                        <span className="text-[10px] text-app-muted block">MAX</span>
                        <span className="text-app-text">
                          {typeof col.max === "string" && col.max.includes("T")
                            ? col.max.substring(0, 10)
                            : col.max}
                        </span>
                      </div>
                    )}
                    {col.mean !== null && (
                      <div>
                        <span className="text-[10px] text-app-muted block">MEAN</span>
                        <span className="text-app-text">{col.mean}</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Sample Values */}
                {col.sampleValues && col.sampleValues.length > 0 && (
                  <div className="pt-1">
                    <span className="text-[10px] uppercase font-bold text-app-muted tracking-wider block mb-1.5">
                      Sample Values
                    </span>
                    <div className="flex flex-wrap gap-1">
                      {col.sampleValues.slice(0, 4).map((val, idx) => (
                        <span
                          key={idx}
                          className="px-2 py-0.5 rounded-md bg-app-surface text-app-text text-[11px] font-mono border border-app-border/60 max-w-[140px] truncate"
                          title={String(val)}
                        >
                          {val === null ? (
                            <em className="text-app-muted">null</em>
                          ) : (
                            String(val)
                          )}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
