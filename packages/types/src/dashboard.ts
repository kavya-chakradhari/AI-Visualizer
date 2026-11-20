// ─────────────────────────────────────────────
// Layout & Style primitives
// ─────────────────────────────────────────────

export interface Layout {
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex?: number;
}

export interface BorderStyle {
  width?: number;
  color?: string;
  radius?: number;
  style?: "solid" | "dashed" | "dotted" | "none";
}

export interface FontStyle {
  family?: string;
  size?: number;
  weight?: "normal" | "medium" | "semibold" | "bold";
  color?: string;
  align?: "left" | "center" | "right";
}

export interface SpacingStyle {
  padding?: number | [number, number] | [number, number, number, number];
  margin?: number | [number, number] | [number, number, number, number];
}

export interface LegendStyle {
  show?: boolean;
}

export interface DataLabelsStyle {
  show?: boolean;
}

export interface Style {
  colors?: string[];
  border?: BorderStyle;
  font?: FontStyle;
  spacing?: SpacingStyle;
  background?: string;
  opacity?: number;
  legend?: LegendStyle;
  dataLabels?: DataLabelsStyle;
}

export type VisualStyle = Style;

// ─────────────────────────────────────────────
// Measures & Calculated Fields
// ─────────────────────────────────────────────

export type AggregationType =
  | "sum"
  | "avg"
  | "count"
  | "min"
  | "max"
  | "median"
  | "distinctCount"
  | "none";

export interface Measure {
  field: string;
  aggregation: AggregationType;
  alias?: string;
  formatString?: string;
}

export interface CalculatedField {
  name: string;
  expression: string;
  dataType: "number" | "string" | "boolean" | "date";
  formatString?: string;
}

// ─────────────────────────────────────────────
// Theme
// ─────────────────────────────────────────────

/**
 * A type scale, in px. Every surface in the app reads sizes from here rather
 * than hardcoding a value, so a theme change (or an AI-driven font-size
 * tweak) reflows text everywhere at once.
 */
export interface ThemeFontSizes {
  xs: number;
  sm: number;
  base: number;
  lg: number;
  xl: number;
  xxl: number;
}

/** A spacing scale, in px, for margins/padding/gaps. */
export interface ThemeSpacingScale {
  xs: number;
  sm: number;
  md: number;
  lg: number;
  xl: number;
}

/**
 * The full theme contract. This is the single source of truth for a
 * dashboard's look — the frontend maps every field here onto a CSS custom
 * property (see frontend/src/theme), so nothing reads these as hardcoded
 * Tailwind color classes and a theme change (manual or AI-driven) reflects
 * everywhere instantly.
 */
export interface Theme {
  name: string;
  mode: "light" | "dark";
  background: string;
  surface: string;
  text: string;
  mutedText: string;
  primary: string;
  secondary: string;
  success: string;
  warning: string;
  danger: string;
  border: string;
  /** Categorical colors for chart series — colorblind-safe by default (Okabe–Ito). */
  chartPalette: string[];
  fontFamily: string;
  fontSizes: ThemeFontSizes;
  /** Corner radius, in px, applied to cards/panels/buttons. */
  borderRadius: number;
  /** A CSS box-shadow value applied to elevated surfaces (cards, drawers, dropdowns). */
  shadow: string;
  spacingScale: ThemeSpacingScale;
}

/**
 * The Okabe–Ito palette — the standard colorblind-safe categorical palette
 * (distinguishable under deuteranopia, protanopia, and tritanopia). Used as
 * the chart palette for every built-in theme, and kept identical across
 * themes so a series keeps the same color when the user switches theme.
 */
export const COLORBLIND_SAFE_PALETTE: string[] = [
  "#E69F00", // orange
  "#56B4E9", // sky blue
  "#009E73", // bluish green
  "#F0E442", // yellow
  "#0072B2", // blue
  "#D55E00", // vermillion
  "#CC79A7", // reddish purple
  "#999999", // grey
];

const FONT_SIZES: ThemeFontSizes = { xs: 11, sm: 12, base: 14, lg: 16, xl: 20, xxl: 28 };
const SPACING_SCALE: ThemeSpacingScale = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };
const FONT_FAMILY = "'Plus Jakarta Sans', system-ui, -apple-system, sans-serif";

/**
 * Dark theme (default). Every text/background/button pairing here has been
 * checked against WCAG AA (4.5:1 normal text, 3:1 large text / UI components) —
 * see the design-system checklist for the full contrast table.
 */
export const DARK_THEME: Theme = {
  name: "Dark",
  mode: "dark",
  background: "#0f172a",
  surface: "#1e293b",
  text: "#f1f5f9",
  mutedText: "#94a3b8",
  primary: "#0284c7",
  secondary: "#8b5cf6",
  success: "#16a34a",
  warning: "#fbbf24",
  danger: "#dc2626",
  border: "#64748b",
  chartPalette: COLORBLIND_SAFE_PALETTE,
  fontFamily: FONT_FAMILY,
  fontSizes: FONT_SIZES,
  borderRadius: 12,
  shadow: "0 8px 24px -4px rgba(0, 0, 0, 0.5)",
  spacingScale: SPACING_SCALE,
};

/** Light / professional theme — the second required built-in. */
export const LIGHT_THEME: Theme = {
  name: "Light",
  mode: "light",
  background: "#f8fafc",
  surface: "#ffffff",
  text: "#0f172a",
  mutedText: "#475569",
  primary: "#0369a1",
  secondary: "#6d28d9",
  success: "#15803d",
  warning: "#92400e",
  danger: "#b91c1c",
  border: "#e2e8f0",
  chartPalette: COLORBLIND_SAFE_PALETTE,
  fontFamily: FONT_FAMILY,
  fontSizes: FONT_SIZES,
  borderRadius: 10,
  shadow: "0 8px 24px -4px rgba(15, 23, 42, 0.12)",
  spacingScale: SPACING_SCALE,
};

export const BUILT_IN_THEMES: Theme[] = [DARK_THEME, LIGHT_THEME];

/** @deprecated Use DARK_THEME. Kept for existing imports during migration. */
export const DEFAULT_THEME: Theme = DARK_THEME;

// ─────────────────────────────────────────────
// Visual encoding
// ─────────────────────────────────────────────

export interface VisualEncoding {
  xField?: string;
  yField?: string | string[];
  seriesField?: string;
  colorField?: string;
  sizeField?: string;
  labelField?: string;
  measures?: Measure[];
  /** Default aggregation for charts that encode a single implicit measure. */
  aggregation?: AggregationType;
}

// ─────────────────────────────────────────────
// Visual Discriminated Union (kind discriminant)
// ─────────────────────────────────────────────

export interface VisualBase {
  id: string;
  pageId: string;
  datasetId?: string;
  title: string;
  layout: Layout;
  style: Style;
  encoding: VisualEncoding;
  filters?: FilterConfig[];
  calculatedFields?: CalculatedField[];
  createdAt: string;
  updatedAt: string;
}

export interface BarChartVisual extends VisualBase {
  kind: "bar";
  type?: "bar";
  stacked?: boolean;
  horizontal?: boolean;
  showDataLabels?: boolean;
}
export type BarChart = BarChartVisual;

export interface LineChartVisual extends VisualBase {
  kind: "line";
  type?: "line";
  smooth?: boolean;
  showArea?: boolean;
  showPoints?: boolean;
}
export type LineChart = LineChartVisual;

export interface AreaChartVisual extends VisualBase {
  kind: "area";
  type?: "area";
  smooth?: boolean;
  stacked?: boolean;
  showPoints?: boolean;
}
export type AreaChart = AreaChartVisual;

export interface PieChartVisual extends VisualBase {
  kind: "pie";
  type?: "pie";
  donut?: boolean;
  innerRadius?: number;
  showLabels?: boolean;
}
export type PieChart = PieChartVisual;

export interface ScatterChartVisual extends VisualBase {
  kind: "scatter";
  type?: "scatter";
  symbolSize?: number;
}
export type ScatterChart = ScatterChartVisual;

export interface TableVisual extends VisualBase {
  kind: "table";
  type?: "table";
  columns?: string[];
  pageSize?: number;
  sortable?: boolean;
  striped?: boolean;
}
export type Table = TableVisual;

export interface KPIVisual extends VisualBase {
  kind: "kpi";
  type?: "kpi";
  valueField: string;
  comparisonField?: string;
  comparisonLabel?: string;
  format?: string;
  prefix?: string;
  suffix?: string;
  showSparkline?: boolean;
}
export type KPI = KPIVisual;

export interface TextBoxVisual extends VisualBase {
  kind: "textbox";
  type?: "textbox";
  content: string; // Markdown-supported rich text
}
export type TextBox = TextBoxVisual;

export type FilterOperator =
  | "eq"
  | "neq"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "in"
  | "notIn"
  | "contains"
  | "notContains"
  | "between"
  | "isNull"
  | "isNotNull";

export interface FilterConfig {
  field: string;
  operator: FilterOperator;
  value?: unknown;
  label?: string;
}

export interface FilterVisual extends VisualBase {
  kind: "filter";
  type?: "filter";
  field: string;
  filterType: "dropdown" | "dateRange" | "slider" | "search" | "multiselect";
  defaultValue?: unknown;
}
export type Filter = FilterVisual;

export type Visual =
  | BarChartVisual
  | LineChartVisual
  | AreaChartVisual
  | PieChartVisual
  | ScatterChartVisual
  | TableVisual
  | KPIVisual
  | TextBoxVisual
  | FilterVisual;

export type VisualKind = Visual["kind"];

// ─────────────────────────────────────────────
// Page & Page Layout
// ─────────────────────────────────────────────

export interface PageLayoutConfig {
  columns: number;
  rowHeight: number;
  margin: [number, number];
}

export interface Page {
  id: string;
  dashboardId: string;
  title: string;
  order: number;
  layoutConfig: PageLayoutConfig;
  visuals: Visual[];
  /** Page-scoped filters — applied to every visual on this page. */
  filters?: FilterConfig[];
  createdAt: string;
  updatedAt: string;
}

// ─────────────────────────────────────────────
// Dashboard & DashboardState
// ─────────────────────────────────────────────

export interface Dashboard {
  id: string;
  title: string;
  description?: string;
  datasetId?: string;
  /** Every dataset attached to this dashboard; `datasetId` (if set) is always one of these. */
  datasetIds: string[];
  pages: Page[];
  activePageId?: string;
  theme?: Theme;
  /** Dashboard-scoped filters — applied to every visual on every page. */
  filters?: FilterConfig[];
  calculatedFields?: CalculatedField[];
  createdById?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

/**
 * DashboardState is the full in-memory snapshot of a dashboard.
 * It is the ONLY authoritative representation — backend persists this to SQLite,
 * and the frontend Zustand store mirrors it exactly.
 */
export interface DashboardState {
  dashboard: Dashboard;
  /** Total number of commands that have been applied (including reverted) */
  commandLogLength: number;
  /** Number of applied (not reverted) commands = undo stack depth */
  appliedCommandCount: number;
  /** Number of reverted commands available for redo */
  revertedCommandCount: number;
  version: number;
}

// ─────────────────────────────────────────────
// Legacy compatibility aliases (for migration)
// ─────────────────────────────────────────────

/** @deprecated Use Style instead */
export type VisualStyleConfig = Style;
/** @deprecated Use Layout instead */
export interface VisualLayout {
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
}
/** @deprecated Use VisualKind instead */
export type VisualType =
  | "bar"
  | "line"
  | "scatter"
  | "pie"
  | "donut"
  | "area"
  | "kpi"
  | "table"
  | "funnel"
  | "heatmap";
