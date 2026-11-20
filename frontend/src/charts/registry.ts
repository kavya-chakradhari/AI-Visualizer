import type { VisualKind } from "@ai-vis/types";
import {
  BarChart3,
  LineChart as LineIcon,
  PieChart as PieIcon,
  ScatterChart as ScatterIcon,
  Table as TableIcon,
  Activity,
} from "lucide-react";

/**
 * Single source of truth for "what chart types exist" — both the Add Visual
 * modal and the property panel's type switcher read this list instead of
 * each hardcoding their own, so a new type only needs adding here (plus its
 * option builder in echartsOptionBuilder.ts / render branch in
 * ChartRenderer.tsx) to show up identically in every creation path,
 * including the AI chat (which targets the same `kind` values via
 * CHANGE_CHART_TYPE / CREATE_VISUAL).
 */
export interface ChartTypeDef {
  kind: VisualKind;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Encoding fields this type actually uses, for future field-requirement validation. */
  requiredFields: {
    dimension?: boolean;
    metric?: boolean;
  };
}

export const CHART_REGISTRY: ChartTypeDef[] = [
  {
    kind: "bar",
    label: "Bar Chart",
    description: "Compare quantities across categorical groups",
    icon: BarChart3,
    requiredFields: { dimension: true, metric: true },
  },
  {
    kind: "line",
    label: "Line Chart",
    description: "Track trends and continuous progressions",
    icon: LineIcon,
    requiredFields: { dimension: true, metric: true },
  },
  {
    kind: "pie",
    label: "Pie / Donut",
    description: "Display proportional parts of a whole",
    icon: PieIcon,
    requiredFields: { dimension: true, metric: true },
  },
  {
    kind: "scatter",
    label: "Scatter Plot",
    description: "Identify correlations between two numeric metrics",
    icon: ScatterIcon,
    requiredFields: { dimension: true, metric: true },
  },
  {
    kind: "table",
    label: "Data Table",
    description: "Inspect multi-column row records and details",
    icon: TableIcon,
    requiredFields: {},
  },
  {
    kind: "kpi",
    label: "KPI Scorecard",
    description: "Highlight a single critical summary metric",
    icon: Activity,
    requiredFields: { metric: true },
  },
];

export function getChartTypeDef(kind: VisualKind): ChartTypeDef | undefined {
  return CHART_REGISTRY.find((c) => c.kind === kind);
}
