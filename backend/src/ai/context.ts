/**
 * Compact context assembly.
 *
 * Before calling the LLM we build a small, structured summary of "what's on
 * screen right now" — current page's visuals, the selected visual, available
 * fields with their types, and the theme. This is NOT the raw dataset: no
 * rows, no per-value samples, just names and types, so the prompt stays small
 * and the model never sees (or needs) actual customer data.
 */
import type {
  DashboardState,
  ColumnProfile,
  Theme,
  VisualKind,
  VisualEncoding,
  Layout,
} from "@ai-vis/types";

export interface AIVisualSummary {
  id: string;
  kind: VisualKind;
  title: string;
  /** Needed for spatial references ("move it to the top"); kept to 4 numbers. */
  layout: Layout;
}

/**
 * The outcome of resolving a pronoun/demonstrative reference ("it", "this
 * chart", "the sales chart", "all charts", "this page") against the current
 * page. See reference.ts for how this is produced — defined here so
 * `AIContext` can embed it without reference.ts and context.ts importing each
 * other in a cycle (reference.ts depends on this module, not the reverse).
 */
export type ReferenceResolution =
  | {
      kind: "single";
      visualId: string;
      pageId: string;
      title: string;
      visualKind: VisualKind;
      layout: Layout;
      matchedVia: "selected" | "last" | "name" | "type" | "only";
    }
  | { kind: "all"; pageId: string; visualIds: string[] }
  | { kind: "page"; pageId: string }
  | { kind: "ambiguous"; term: string; candidates: string[] };

export interface AISelectedVisual extends AIVisualSummary {
  encoding: VisualEncoding;
}

export type AIFieldRole = "dimension" | "measure" | "unknown";

export interface AIFieldSummary {
  name: string;
  dataType: ColumnProfile["dataType"];
  semanticType: ColumnProfile["semanticType"];
  role: AIFieldRole;
  /** True for a dashboard-level calculated measure rather than a raw dataset column. */
  calculated?: boolean;
  /** Which attached dataset this field belongs to. Absent for calculated fields. */
  datasetId?: string;
  datasetName?: string;
}

/** One dataset attached to the dashboard, as summarized for the AI. */
export interface AIDatasetSummary {
  id: string;
  name: string;
}

/** Per-dataset schema, keyed by dataset id — every dataset attached to the dashboard. */
export type DatasetSchemaMap = Map<string, { name: string; schema: ColumnProfile[] }>;

export interface AIThemeSummary {
  name: string;
  mode: Theme["mode"];
  primary: string;
  chartPalette: string[];
}

export interface AIContext {
  dashboardId: string;
  dashboardTitle: string;
  pageId: string;
  pageTitle: string;
  /** Visuals on the current page only: id, kind, title — nothing heavier. */
  visuals: AIVisualSummary[];
  selectedVisual?: AISelectedVisual;
  otherPages: { id: string; title: string }[];
  /** Every field the user could reasonably reference, dataset columns + calculated measures. */
  fields: AIFieldSummary[];
  /** Every dataset attached to the dashboard. Present (possibly with >1 entry) whenever more than one dataset can be targeted. */
  datasets: AIDatasetSummary[];
  theme: AIThemeSummary;
  /**
   * Set by the service when the message contains a resolvable reference.
   * Never "ambiguous" — an ambiguous reference short-circuits into a
   * clarification before context ever reaches a provider.
   */
  resolvedReference?: Exclude<ReferenceResolution, { kind: "ambiguous" }>;
}

const MEASURE_SEMANTIC_TYPES = new Set<ColumnProfile["semanticType"]>([
  "numeric",
  "currency",
  "percentage",
]);
const DIMENSION_SEMANTIC_TYPES = new Set<ColumnProfile["semanticType"]>([
  "categorical",
  "date",
  "identifier",
]);

function classifyRole(semanticType: ColumnProfile["semanticType"]): AIFieldRole {
  if (MEASURE_SEMANTIC_TYPES.has(semanticType)) return "measure";
  if (DIMENSION_SEMANTIC_TYPES.has(semanticType)) return "dimension";
  return "unknown";
}

export function buildAIContext(
  state: DashboardState,
  datasetSchemas: DatasetSchemaMap | undefined,
  selectedVisualId?: string
): AIContext {
  const { dashboard } = state;
  const activePage =
    dashboard.pages.find((p) => p.id === dashboard.activePageId) ?? dashboard.pages[0];

  const visuals: AIVisualSummary[] = (activePage?.visuals ?? []).map((v) => ({
    id: v.id,
    kind: v.kind,
    title: v.title,
    layout: v.layout,
  }));

  const selected = selectedVisualId
    ? activePage?.visuals.find((v) => v.id === selectedVisualId)
    : undefined;

  const datasets: AIDatasetSummary[] = Array.from(datasetSchemas ?? []).map(([id, d]) => ({
    id,
    name: d.name,
  }));

  const fields: AIFieldSummary[] = [
    ...Array.from(datasetSchemas ?? []).flatMap(([datasetId, d]) =>
      d.schema.map((c) => ({
        name: c.name,
        dataType: c.dataType,
        semanticType: c.semanticType,
        role: classifyRole(c.semanticType),
        datasetId,
        datasetName: d.name,
      }))
    ),
    ...(dashboard.calculatedFields ?? []).map((f) => ({
      name: f.name,
      dataType: (f.dataType === "number" || f.dataType === "string" || f.dataType === "boolean" || f.dataType === "date"
        ? f.dataType
        : "unknown") as ColumnProfile["dataType"],
      semanticType: "numeric" as ColumnProfile["semanticType"],
      role: "measure" as const,
      calculated: true,
    })),
  ];

  return {
    dashboardId: dashboard.id,
    dashboardTitle: dashboard.title,
    pageId: activePage?.id ?? "",
    pageTitle: activePage?.title ?? "",
    visuals,
    ...(selected
      ? {
          selectedVisual: {
            id: selected.id,
            kind: selected.kind,
            title: selected.title,
            layout: selected.layout,
            encoding: selected.encoding,
          },
        }
      : {}),
    otherPages: dashboard.pages
      .filter((p) => p.id !== activePage?.id)
      .map((p) => ({ id: p.id, title: p.title })),
    fields,
    datasets,
    theme: {
      name: dashboard.theme?.name ?? "default",
      mode: dashboard.theme?.mode ?? "dark",
      primary: dashboard.theme?.primary ?? "#0284c7",
      chartPalette: dashboard.theme?.chartPalette ?? [],
    },
  };
}
