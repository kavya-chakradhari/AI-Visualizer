import React, { useMemo } from "react";
import ReactECharts from "echarts-for-react";
import type { Visual, Theme } from "@ai-vis/types";
import { buildEChartsOption } from "./echartsOptionBuilder.js";
import { coerceNumeric } from "./numeric.js";
import { TrendingUp, TrendingDown, Table as TableIcon, Layers } from "lucide-react";

export interface ChartRendererProps {
  visual: Visual;
  dataRows: Record<string, unknown>[];
  theme?: Theme;
}

export const ChartRenderer: React.FC<ChartRendererProps> = ({
  visual,
  dataRows,
  theme,
}) => {
  // 1. Table Visual
  if (visual.kind === "table") {
    const columns =
      ("columns" in visual && visual.columns && visual.columns.length > 0)
        ? visual.columns
        : dataRows.length > 0
        ? Object.keys(dataRows[0]!).slice(0, 8)
        : [];

    const previewRows = dataRows.slice(0, 20);

    return (
      <div className="w-full h-full overflow-auto text-xs scrollbar-thin">
        {previewRows.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-slate-500 gap-1">
            <TableIcon className="w-5 h-5 stroke-[1.5]" />
            <span>No data rows available</span>
          </div>
        ) : (
          <table className="w-full text-left border-collapse">
            <thead className="sticky top-0 bg-slate-900/90 backdrop-blur-sm border-b border-slate-800 text-slate-400 uppercase tracking-wider font-semibold">
              <tr>
                {columns.map((col) => (
                  <th key={col} className="py-2 px-3 whitespace-nowrap">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {previewRows.map((row, idx) => (
                <tr
                  key={idx}
                  className="hover:bg-slate-800/40 transition-colors duration-100"
                >
                  {columns.map((col) => (
                    <td
                      key={col}
                      className="py-1.5 px-3 text-slate-200 whitespace-nowrap"
                    >
                      {String(row[col] ?? "—")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    );
  }

  // 2. KPI Visual
  if (visual.kind === "kpi") {
    const valueField = "valueField" in visual ? visual.valueField : "";
    const comparisonField = "comparisonField" in visual ? visual.comparisonField : undefined;
    const prefix = ("prefix" in visual ? visual.prefix : "") || "";
    const suffix = ("suffix" in visual ? visual.suffix : "") || "";
    const comparisonLabel = ("comparisonLabel" in visual ? visual.comparisonLabel : "") || "vs previous";

    const sumField = (field: string): number | null => {
      const nums = dataRows
        .map((r) => coerceNumeric(r[field]))
        .filter((n): n is number => n !== null);
      return nums.length > 0 ? nums.reduce((a, b) => a + b, 0) : null;
    };

    const formatValue = (n: number): string =>
      Math.abs(n) > 1000000
        ? (n / 1000000).toFixed(1) + "M"
        : Math.abs(n) > 1000
        ? (n / 1000).toFixed(1) + "k"
        : n.toLocaleString();

    const currentSum = valueField ? sumField(valueField) : null;
    const displayVal = currentSum !== null ? formatValue(currentSum) : "—";

    // Only show a trend indicator when the visual actually has a comparison
    // field with real data behind it — never fabricate a percentage, since
    // an invented number is worse than no trend line at all.
    const comparisonSum = comparisonField ? sumField(comparisonField) : null;
    const pctChange =
      currentSum !== null && comparisonSum !== null && comparisonSum !== 0
        ? ((currentSum - comparisonSum) / Math.abs(comparisonSum)) * 100
        : null;

    const primaryColor = visual.style?.colors?.[0] || "#0c8ee6";

    return (
      <div
        className="w-full h-full flex flex-col justify-center items-center p-4 text-center select-none"
        style={{
          backgroundColor: visual.style?.background,
          borderRadius: visual.style?.border?.radius,
          borderWidth: visual.style?.border?.width,
          borderColor: visual.style?.border?.color,
          borderStyle:
            visual.style?.border?.style === "none" ? "none" : visual.style?.border?.style || undefined,
        }}
      >
        <div className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-1">
          {visual.title}
        </div>
        <div
          className="text-4xl sm:text-5xl font-extrabold tracking-tight"
          style={{ color: primaryColor }}
        >
          {prefix}{displayVal}{suffix}
        </div>
        {pctChange !== null && (
          <div
            className={`mt-2 flex items-center gap-1 text-xs font-medium ${
              pctChange >= 0 ? "text-emerald-400" : "text-rose-400"
            }`}
          >
            {pctChange >= 0 ? (
              <TrendingUp className="w-3.5 h-3.5" />
            ) : (
              <TrendingDown className="w-3.5 h-3.5" />
            )}
            <span>
              {pctChange >= 0 ? "+" : ""}
              {pctChange.toFixed(1)}% {comparisonLabel}
            </span>
          </div>
        )}
      </div>
    );
  }

  // 3. Textbox Visual
  if (visual.kind === "textbox") {
    const content = "content" in visual ? visual.content : "";
    return (
      <div className="w-full h-full p-4 overflow-auto text-slate-300 text-sm leading-relaxed">
        {content || <span className="text-slate-500 italic">Double-click to edit note...</span>}
      </div>
    );
  }

  // 4. ECharts Charts (Bar, Line, Pie/Donut, Scatter)
  const option = useMemo(() => {
    return buildEChartsOption(visual, dataRows, theme);
  }, [visual, dataRows, theme]);

  return (
    <div className="w-full h-full relative">
      {dataRows.length === 0 ? (
        <div className="h-full flex flex-col items-center justify-center text-slate-500 gap-1.5">
          <Layers className="w-5 h-5 stroke-[1.5]" />
          <span className="text-xs">No data available for chart</span>
        </div>
      ) : (
        <ReactECharts
          option={option}
          notMerge={true}
          lazyUpdate={true}
          style={{ width: "100%", height: "100%" }}
          opts={{ renderer: "svg" }}
        />
      )}
    </div>
  );
};
