import type { Visual, Theme, AggregationType } from "@ai-vis/types";
import { coerceNumeric } from "./numeric.js";

export interface AggregateResult {
  categories: string[];
  series: Array<{
    name: string;
    data: number[];
    color?: string;
  }>;
}

/**
 * Deterministic aggregation of tabular data rows by dimension & metric
 */
export function aggregateData(
  dataRows: Record<string, unknown>[],
  xField?: string,
  yField?: string | string[],
  aggregation: AggregationType = "sum"
): AggregateResult {
  if (!dataRows || dataRows.length === 0) {
    return { categories: [], series: [] };
  }

  const dim = xField;
  const metrics = Array.isArray(yField) ? yField : yField ? [yField] : [];

  if (!dim || metrics.length === 0) {
    // Fallback: take first 20 rows directly
    const firstMetric = metrics[0];
    const categories = dim
      ? dataRows.slice(0, 25).map((r) => String(r[dim] ?? ""))
      : dataRows.slice(0, 25).map((_, i) => `Row ${i + 1}`);
    const data = firstMetric
      ? dataRows.slice(0, 25).map((r) => coerceNumeric(r[firstMetric]) ?? 0)
      : [];
    return {
      categories,
      series: [{ name: firstMetric || "Value", data }],
    };
  }

  // Group rows by dimension
  const groups = new Map<string, Record<string, number[]>>();
  const distinctSets = new Map<string, Record<string, Set<unknown>>>();

  for (const row of dataRows) {
    const key = String(row[dim] ?? "Unknown");
    if (!groups.has(key)) {
      groups.set(key, {});
      distinctSets.set(key, {});
      for (const m of metrics) {
        groups.get(key)![m] = [];
        distinctSets.get(key)![m] = new Set();
      }
    }

    for (const m of metrics) {
      const val = row[m];
      const num = coerceNumeric(val);
      if (num !== null) {
        groups.get(key)![m]!.push(num);
      }
      if (val !== null && val !== undefined) {
        distinctSets.get(key)![m]!.add(val);
      }
    }
  }

  // Compute aggregate value per group per metric
  const categories = Array.from(groups.keys()).slice(0, 50); // cap at 50 categories for visual clarity

  const series = metrics.map((m) => {
    const data = categories.map((cat) => {
      const vals = groups.get(cat)?.[m] ?? [];
      const distinctSet = distinctSets.get(cat)?.[m] ?? new Set();

      if (vals.length === 0 && aggregation !== "count" && aggregation !== "distinctCount") {
        return 0;
      }

      switch (aggregation) {
        case "avg": {
          const sum = vals.reduce((a, b) => a + b, 0);
          return vals.length > 0 ? Math.round((sum / vals.length) * 100) / 100 : 0;
        }
        case "count":
          return vals.length;
        case "distinctCount":
          return distinctSet.size;
        case "min":
          return Math.min(...vals);
        case "max":
          return Math.max(...vals);
        case "sum":
        default:
          return Math.round(vals.reduce((a, b) => a + b, 0) * 100) / 100;
      }
    });

    return {
      name: m,
      data,
    };
  });

  return { categories, series };
}

/**
 * Builds standard ECharts option object from Visual specification and data rows
 */
/** Colorblind-safe fallback (Okabe–Ito) — used only if no theme is supplied at all. */
const FALLBACK_PALETTE = [
  "#E69F00",
  "#56B4E9",
  "#009E73",
  "#F0E442",
  "#0072B2",
  "#D55E00",
  "#CC79A7",
  "#999999",
];

export function buildEChartsOption(
  visual: Visual,
  dataRows: Record<string, unknown>[],
  theme?: Theme
): Record<string, unknown> {
  const palette =
    visual.style?.colors && visual.style.colors.length > 0
      ? visual.style.colors
      : theme?.chartPalette ?? FALLBACK_PALETTE;

  const primaryColor = palette[0] || theme?.primary || "#0284c7";
  const fontFamily =
    visual.style?.font?.family || theme?.fontFamily || "'Plus Jakarta Sans', system-ui, sans-serif";

  const encoding = visual.encoding || {};
  const xField = encoding.xField;
  const yField = encoding.yField;
  const aggregation = encoding.measures?.[0]?.aggregation ?? "sum";

  const { categories, series } = aggregateData(dataRows, xField, yField, aggregation);

  // Every color here comes from the theme itself — not a hardcoded isDark
  // ternary — so a custom (AI or manual) theme override repaints charts too,
  // not just the app chrome around them.
  const isDark = theme?.mode !== "light";
  const textColor = theme?.mutedText ?? (isDark ? "#94a3b8" : "#475569");
  const tooltipBg = theme?.surface ?? (isDark ? "#0f172a" : "#ffffff");
  const tooltipText = theme?.text ?? (isDark ? "#f8fafc" : "#0f172a");
  const tooltipBorder = theme?.border ?? (isDark ? "#334155" : "#e2e8f0");
  const splitLineColor = theme?.border
    ? `${theme.border}${isDark ? "40" : "30"}` // theme border color, softened with alpha
    : isDark
      ? "rgba(255, 255, 255, 0.08)"
      : "rgba(0, 0, 0, 0.06)";

  // Style-driven cross-cutting toggles — applied identically no matter which
  // path (manual property panel or AI chat) wrote visual.style, since both
  // funnel through the same UPDATE_VISUAL/UPDATE_STYLE commands.
  const showLegend = visual.style?.legend?.show ?? series.length > 1;
  const showDataLabels = visual.style?.dataLabels?.show ?? false;
  const labelStyle = { show: showDataLabels, color: textColor, fontFamily, fontSize: 10, position: "top" as const };
  const legendConfig = {
    show: showLegend,
    top: 0,
    textStyle: { color: textColor, fontFamily, fontSize: 11 },
  };

  // Base layout grid — give a bit more headroom when the legend is visible
  // above the plot area so series names don't overlap the axis.
  const grid = {
    top: showLegend ? 56 : 36,
    right: 20,
    bottom: 36,
    left: 48,
    containLabel: true,
  };

  // 1. Bar Chart
  if (visual.kind === "bar") {
    const isHorizontal = "horizontal" in visual && visual.horizontal;
    const isStacked = "stacked" in visual && visual.stacked;

    const categoryAxis = {
      type: "category",
      data: categories,
      axisLabel: { color: textColor, fontFamily, rotate: categories.length > 8 ? 30 : 0 },
      axisLine: { lineStyle: { color: splitLineColor } },
      axisTick: { show: false },
    };

    const valueAxis = {
      type: "value",
      axisLabel: { color: textColor, fontFamily },
      splitLine: { lineStyle: { color: splitLineColor, type: "dashed" } },
    };

    return {
      color: palette,
      tooltip: {
        trigger: "axis",
        backgroundColor: tooltipBg,
        borderColor: tooltipBorder,
        textStyle: { color: tooltipText, fontFamily },
      },
      legend: legendConfig,
      grid,
      xAxis: isHorizontal ? valueAxis : categoryAxis,
      yAxis: isHorizontal ? categoryAxis : valueAxis,
      series: series.map((s, idx) => ({
        name: s.name,
        type: "bar",
        data: s.data,
        stack: isStacked ? "total" : undefined,
        label: labelStyle,
        itemStyle: {
          borderRadius: isHorizontal ? [0, 4, 4, 0] : [4, 4, 0, 0],
          color: palette[idx % palette.length],
        },
      })),
    };
  }

  // 2. Line Chart
  if (visual.kind === "line") {
    const isSmooth = "smooth" in visual ? visual.smooth : true;
    const showArea = "showArea" in visual && visual.showArea;
    const showPoints = "showPoints" in visual ? visual.showPoints : true;

    return {
      color: palette,
      tooltip: {
        trigger: "axis",
        backgroundColor: tooltipBg,
        borderColor: tooltipBorder,
        textStyle: { color: tooltipText, fontFamily },
      },
      legend: legendConfig,
      grid,
      xAxis: {
        type: "category",
        data: categories,
        axisLabel: { color: textColor, fontFamily, rotate: categories.length > 8 ? 30 : 0 },
        axisLine: { lineStyle: { color: splitLineColor } },
        axisTick: { show: false },
      },
      yAxis: {
        type: "value",
        axisLabel: { color: textColor, fontFamily },
        splitLine: { lineStyle: { color: splitLineColor, type: "dashed" } },
      },
      series: series.map((s, idx) => {
        const col = palette[idx % palette.length] || primaryColor;
        return {
          name: s.name,
          type: "line",
          data: s.data,
          smooth: isSmooth,
          showSymbol: showPoints,
          symbolSize: 6,
          label: labelStyle,
          lineStyle: { width: 2.5, color: col },
          itemStyle: { color: col },
          areaStyle: showArea
            ? {
                color: {
                  type: "linear",
                  x: 0,
                  y: 0,
                  x2: 0,
                  y2: 1,
                  colorStops: [
                    { offset: 0, color: col + "88" },
                    { offset: 1, color: col + "05" },
                  ],
                },
              }
            : undefined,
        };
      }),
    };
  }

  // 3. Pie / Donut Chart
  if (visual.kind === "pie") {
    const isDonut = "donut" in visual && visual.donut;
    const firstSeries = series[0]?.data ?? [];
    const pieData = categories.map((cat, i) => ({
      name: cat,
      value: firstSeries[i] ?? 0,
    }));

    return {
      color: palette,
      tooltip: {
        trigger: "item",
        formatter: "{b}: {c} ({d}%)",
        backgroundColor: tooltipBg,
        borderColor: tooltipBorder,
        textStyle: { color: tooltipText, fontFamily },
      },
      legend: {
        show: visual.style?.legend?.show ?? true,
        orient: "horizontal",
        bottom: 4,
        textStyle: { color: textColor, fontFamily, fontSize: 11 },
      },
      series: [
        {
          name: visual.title,
          type: "pie",
          radius: isDonut ? ["42%", "70%"] : "68%",
          center: ["50%", "45%"],
          avoidLabelOverlap: true,
          itemStyle: {
            borderRadius: 6,
            borderColor: theme?.surface ?? (isDark ? "#0f172a" : "#ffffff"),
            borderWidth: 2,
          },
          label: {
            show: visual.style?.dataLabels?.show ?? ("showLabels" in visual ? visual.showLabels : true),
            color: textColor,
            fontFamily,
            fontSize: 11,
          },
          data: pieData,
        },
      ],
    };
  }

  // 4. Scatter Chart
  if (visual.kind === "scatter") {
    const scatterData = dataRows.slice(0, 200).map((r) => [
      coerceNumeric(r[xField || ""]) ?? 0,
      coerceNumeric(r[Array.isArray(yField) ? yField[0] : yField || ""]) ?? 0,
    ]);

    return {
      color: palette,
      tooltip: {
        trigger: "item",
        formatter: (params: { data: [number, number] }) =>
          `${xField || "X"}: ${params.data[0]}<br/>${yField || "Y"}: ${params.data[1]}`,
        backgroundColor: tooltipBg,
        borderColor: tooltipBorder,
        textStyle: { color: tooltipText, fontFamily },
      },
      grid,
      xAxis: {
        type: "value",
        name: xField,
        nameTextStyle: { color: textColor, fontFamily },
        axisLabel: { color: textColor, fontFamily },
        splitLine: { lineStyle: { color: splitLineColor, type: "dashed" } },
      },
      yAxis: {
        type: "value",
        name: Array.isArray(yField) ? yField[0] : yField,
        nameTextStyle: { color: textColor, fontFamily },
        axisLabel: { color: textColor, fontFamily },
        splitLine: { lineStyle: { color: splitLineColor, type: "dashed" } },
      },
      series: [
        {
          type: "scatter",
          data: scatterData,
          symbolSize: "symbolSize" in visual && visual.symbolSize ? visual.symbolSize : 8,
          label: labelStyle,
          itemStyle: { color: primaryColor, opacity: 0.8 },
        },
      ],
    };
  }

  // Fallback / default
  return {
    title: { text: visual.title, textStyle: { color: textColor } },
    series: [],
  };
}
