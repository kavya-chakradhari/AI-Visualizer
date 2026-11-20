/**
 * Zod Command Schemas — the single authoritative, versioned contract for every
 * command type. Manual UI actions and AI-generated actions are validated by
 * exactly these schemas; there is no second path.
 *
 * Contract version: COMMAND_SCHEMA_VERSION (see @ai-vis/types).
 *
 * Every payload schema is `.strict()`: unknown keys are a schema-stage error
 * rather than being silently dropped. That matters most for AI-generated
 * commands, where a hallucinated key is a signal the model misunderstood the
 * contract and should be told so.
 *
 * Enum values are normalised on parse (`distinct_count` → `distinctCount`,
 * `not_in` → `notIn`), so the reducer only ever sees canonical spellings.
 */
import { z } from "zod";
import {
  COMMAND_SCHEMA_VERSION,
  COMMAND_SCOPES,
  ALL_COMMAND_TYPES,
  normalizeCommandType,
  type CommandActionType,
  type CommandScope,
} from "@ai-vis/types";

export { COMMAND_SCHEMA_VERSION, COMMAND_SCOPES, normalizeCommandType };
export type { CommandActionType, CommandScope };

// ─────────────────────────────────────────────
// Reusable primitives
// ─────────────────────────────────────────────

export const LayoutSchema = z
  .object({
    x: z.number().int().min(0),
    y: z.number().int().min(0),
    width: z.number().int().min(1),
    height: z.number().int().min(1),
    zIndex: z.number().int().min(0).optional(),
  })
  .strict();

export const PartialLayoutSchema = LayoutSchema.partial();

export const VisualKindSchema = z.enum([
  "bar",
  "line",
  "area",
  "pie",
  "scatter",
  "table",
  "kpi",
  "textbox",
  "filter",
]);

/** Accepted aggregation spellings, normalised to the canonical `AggregationType`. */
const AGGREGATION_ALIASES: Record<string, string> = {
  sum: "sum",
  total: "sum",
  avg: "avg",
  average: "avg",
  mean: "avg",
  count: "count",
  min: "min",
  minimum: "min",
  max: "max",
  maximum: "max",
  median: "median",
  distinctcount: "distinctCount",
  distinct_count: "distinctCount",
  countdistinct: "distinctCount",
  count_distinct: "distinctCount",
  none: "none",
};

export const AggregationSchema = z
  .string()
  .transform((v, ctx) => {
    const canonical = AGGREGATION_ALIASES[v.toLowerCase()];
    if (!canonical) {
      ctx.addIssue({
        code: "custom",
        message: `Unknown aggregation '${v}'. Expected one of: sum, avg, count, min, max, median, distinctCount, none.`,
      });
      return z.NEVER;
    }
    return canonical as
      | "sum"
      | "avg"
      | "count"
      | "min"
      | "max"
      | "median"
      | "distinctCount"
      | "none";
  });

/** Accepted filter-operator spellings, normalised to the canonical `FilterOperator`. */
const OPERATOR_ALIASES: Record<string, string> = {
  eq: "eq",
  equals: "eq",
  neq: "neq",
  ne: "neq",
  not_equals: "neq",
  gt: "gt",
  gte: "gte",
  lt: "lt",
  lte: "lte",
  in: "in",
  notin: "notIn",
  not_in: "notIn",
  contains: "contains",
  notcontains: "notContains",
  not_contains: "notContains",
  between: "between",
  isnull: "isNull",
  is_null: "isNull",
  isnotnull: "isNotNull",
  is_not_null: "isNotNull",
};

export const FilterOperatorSchema = z.string().transform((v, ctx) => {
  const canonical = OPERATOR_ALIASES[v.toLowerCase()];
  if (!canonical) {
    ctx.addIssue({
      code: "custom",
      message: `Unknown filter operator '${v}'. Expected one of: ${[...new Set(Object.values(OPERATOR_ALIASES))].join(", ")}.`,
    });
    return z.NEVER;
  }
  return canonical as
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
});

/** Operators that take no value, and those that require an array of exactly 2. */
const VALUELESS_OPERATORS = new Set(["isNull", "isNotNull"]);
const LIST_OPERATORS = new Set(["in", "notIn"]);

export const FilterConfigSchema = z
  .object({
    field: z.string().min(1, "Filter field is required"),
    operator: FilterOperatorSchema,
    value: z.unknown().optional(),
    label: z.string().optional(),
  })
  .strict()
  .superRefine((f, ctx) => {
    if (VALUELESS_OPERATORS.has(f.operator)) return;

    if (f.value === undefined || f.value === null) {
      ctx.addIssue({
        code: "custom",
        path: ["value"],
        message: `Operator '${f.operator}' requires a value.`,
      });
      return;
    }
    if (LIST_OPERATORS.has(f.operator) && !Array.isArray(f.value)) {
      ctx.addIssue({
        code: "custom",
        path: ["value"],
        message: `Operator '${f.operator}' requires an array value.`,
      });
    }
    if (
      f.operator === "between" &&
      (!Array.isArray(f.value) || f.value.length !== 2)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["value"],
        message: "Operator 'between' requires a value of exactly two elements.",
      });
    }
  });

export const MeasureSchema = z
  .object({
    field: z.string().min(1),
    aggregation: AggregationSchema,
    alias: z.string().optional(),
    formatString: z.string().optional(),
  })
  .strict();

export const DimensionSlotSchema = z.enum([
  "x",
  "y",
  "series",
  "color",
  "size",
  "label",
]);

export const VisualEncodingSchema = z
  .object({
    xField: z.string().optional(),
    yField: z.union([z.string(), z.array(z.string())]).optional(),
    seriesField: z.string().optional(),
    colorField: z.string().optional(),
    sizeField: z.string().optional(),
    labelField: z.string().optional(),
    measures: z.array(MeasureSchema).optional(),
    aggregation: AggregationSchema.optional(),
  })
  .strict();

const HEX_OR_CSS_COLOR = /^(#[0-9a-fA-F]{3,8}|rgba?\(|hsla?\(|[a-zA-Z]+$)/;

const ColorSchema = z
  .string()
  .min(1)
  .refine((c) => HEX_OR_CSS_COLOR.test(c), {
    message: "Must be a hex, rgb(a), hsl(a) or named CSS color.",
  });

export const BorderStyleSchema = z
  .object({
    width: z.number().min(0).optional(),
    color: ColorSchema.optional(),
    radius: z.number().min(0).optional(),
    style: z.enum(["solid", "dashed", "dotted", "none"]).optional(),
  })
  .strict();

export const FontStyleSchema = z
  .object({
    family: z.string().optional(),
    size: z.number().positive().optional(),
    weight: z.enum(["normal", "medium", "semibold", "bold"]).optional(),
    color: ColorSchema.optional(),
    align: z.enum(["left", "center", "right"]).optional(),
  })
  .strict();

const SpacingValueSchema = z.union([
  z.number(),
  z.tuple([z.number(), z.number()]),
  z.tuple([z.number(), z.number(), z.number(), z.number()]),
]);

export const SpacingStyleSchema = z
  .object({
    padding: SpacingValueSchema.optional(),
    margin: SpacingValueSchema.optional(),
  })
  .strict();

export const LegendStyleSchema = z
  .object({
    show: z.boolean().optional(),
  })
  .strict();

export const DataLabelsStyleSchema = z
  .object({
    show: z.boolean().optional(),
  })
  .strict();

export const StyleSchema = z
  .object({
    colors: z.array(ColorSchema).optional(),
    border: BorderStyleSchema.optional(),
    font: FontStyleSchema.optional(),
    spacing: SpacingStyleSchema.optional(),
    background: ColorSchema.optional(),
    opacity: z.number().min(0).max(1).optional(),
    legend: LegendStyleSchema.optional(),
    dataLabels: DataLabelsStyleSchema.optional(),
  })
  .strict();

/** Alias kept for existing imports. */
export const VisualStyleSchema = StyleSchema;

export const ThemeFontSizesSchema = z
  .object({
    xs: z.number().positive(),
    sm: z.number().positive(),
    base: z.number().positive(),
    lg: z.number().positive(),
    xl: z.number().positive(),
    xxl: z.number().positive(),
  })
  .strict();

export const ThemeSpacingScaleSchema = z
  .object({
    xs: z.number().min(0),
    sm: z.number().min(0),
    md: z.number().min(0),
    lg: z.number().min(0),
    xl: z.number().min(0),
  })
  .strict();

/**
 * The full theme contract — background, surface, text, mutedText, primary,
 * secondary, success, warning, danger, border, chartPalette, fontFamily,
 * fontSizes, borderRadius, shadow, spacingScale. Every field here maps
 * directly onto a CSS custom property on the frontend (see
 * frontend/src/theme) — nothing here is presentation-optional.
 */
export const ThemeSchema = z
  .object({
    name: z.string().min(1),
    mode: z.enum(["light", "dark"]),
    background: ColorSchema,
    surface: ColorSchema,
    text: ColorSchema,
    mutedText: ColorSchema,
    primary: ColorSchema,
    secondary: ColorSchema,
    success: ColorSchema,
    warning: ColorSchema,
    danger: ColorSchema,
    border: ColorSchema,
    chartPalette: z.array(ColorSchema).min(1),
    fontFamily: z.string().min(1),
    fontSizes: ThemeFontSizesSchema,
    borderRadius: z.number().min(0),
    shadow: z.string().min(1),
    spacingScale: ThemeSpacingScaleSchema,
  })
  .strict();

/**
 * A dashboard-scoped update_style patches any subset of the theme — including
 * just one font size or one spacing step, without having to restate the
 * whole scale (the reducer deep-merges `fontSizes`/`spacingScale` specifically,
 * so a partial nested object never clobbers the rest of that scale).
 */
export const PartialThemeSchema = z
  .object({
    name: z.string().min(1).optional(),
    mode: z.enum(["light", "dark"]).optional(),
    background: ColorSchema.optional(),
    surface: ColorSchema.optional(),
    text: ColorSchema.optional(),
    mutedText: ColorSchema.optional(),
    primary: ColorSchema.optional(),
    secondary: ColorSchema.optional(),
    success: ColorSchema.optional(),
    warning: ColorSchema.optional(),
    danger: ColorSchema.optional(),
    border: ColorSchema.optional(),
    chartPalette: z.array(ColorSchema).min(1).optional(),
    fontFamily: z.string().min(1).optional(),
    fontSizes: ThemeFontSizesSchema.partial().optional(),
    borderRadius: z.number().min(0).optional(),
    shadow: z.string().min(1).optional(),
    spacingScale: ThemeSpacingScaleSchema.partial().optional(),
  })
  .strict()
  .refine((t) => Object.keys(t).length > 0, "style must not be empty");

export const PageLayoutConfigSchema = z
  .object({
    columns: z.number().int().min(1).max(24).optional(),
    rowHeight: z.number().int().min(10).optional(),
    margin: z.tuple([z.number(), z.number()]).optional(),
  })
  .strict();

export const CommandOriginSchema = z.enum(["user", "ai", "system"]);

export const CommandScopeSchema = z.enum(["visual", "page", "dashboard"]);

// ─────────────────────────────────────────────
// Command Payload Schemas — one per canonical command type
// ─────────────────────────────────────────────

/** Fields every visual-scoped payload must carry. */
const visualTarget = {
  pageId: z.string().min(1, "pageId is required"),
  visualId: z.string().min(1, "visualId is required"),
};

export const CreateVisualPayloadSchema = z
  .object({
    pageId: z.string().min(1, "pageId is required"),
    kind: VisualKindSchema,
    title: z.string().min(1, "Visual title is required"),
    visualId: z.string().optional(),
    layout: PartialLayoutSchema.optional(),
    encoding: VisualEncodingSchema.optional(),
    style: StyleSchema.optional(),
    datasetId: z.string().optional(),
  })
  .strict();

export const UpdateVisualPayloadSchema = z
  .object({
    ...visualTarget,
    patch: z
      .object({
        title: z.string().min(1).optional(),
        layout: PartialLayoutSchema.optional(),
        encoding: VisualEncodingSchema.optional(),
        style: StyleSchema.optional(),
        filters: z.array(FilterConfigSchema).optional(),
        datasetId: z.string().min(1).optional(),
      })
      .strict()
      .refine((p) => Object.keys(p).length > 0, "patch must not be empty"),
  })
  .strict();

export const DeleteVisualPayloadSchema = z.object(visualTarget).strict();

export const MoveVisualPayloadSchema = z
  .object({
    ...visualTarget,
    x: z.number().int().min(0, "x must be >= 0"),
    y: z.number().int().min(0, "y must be >= 0"),
  })
  .strict();

export const ResizeVisualPayloadSchema = z
  .object({
    ...visualTarget,
    width: z.number().int().min(1, "width must be >= 1"),
    height: z.number().int().min(1, "height must be >= 1"),
  })
  .strict();

export const ChangeChartTypePayloadSchema = z
  .object({ ...visualTarget, kind: VisualKindSchema })
  .strict();

export const ChangeDimensionPayloadSchema = z
  .object({
    ...visualTarget,
    slot: DimensionSlotSchema.optional(),
    field: z.string().min(1).nullable(),
  })
  .strict();

export const ChangeMeasurePayloadSchema = z
  .object({
    ...visualTarget,
    measureIndex: z.number().int().min(0).optional(),
    field: z.string().min(1, "measure field is required"),
    aggregation: AggregationSchema.optional(),
    alias: z.string().optional(),
  })
  .strict();

export const ChangeAggregationPayloadSchema = z
  .object({
    ...visualTarget,
    aggregation: AggregationSchema,
    measureIndex: z.number().int().min(0).optional(),
  })
  .strict();

export const ReorderVisualsPayloadSchema = z
  .object({
    pageId: z.string().min(1, "pageId is required"),
    layouts: z
      .array(
        z
          .object({ visualId: z.string().min(1), layout: LayoutSchema })
          .strict()
      )
      .min(1, "layouts must not be empty"),
  })
  .strict();

export const CreatePagePayloadSchema = z
  .object({
    title: z.string().min(1, "Page title is required"),
    pageId: z.string().optional(),
    layoutConfig: PageLayoutConfigSchema.optional(),
  })
  .strict();

export const DeletePagePayloadSchema = z
  .object({ pageId: z.string().min(1, "pageId is required") })
  .strict();

export const RenamePagePayloadSchema = z
  .object({
    pageId: z.string().min(1, "pageId is required"),
    title: z.string().min(1, "New title is required"),
  })
  .strict();

export const SwitchPagePayloadSchema = z
  .object({ pageId: z.string().min(1, "pageId is required") })
  .strict();

export const ReorderPagesPayloadSchema = z
  .object({ orderedPageIds: z.array(z.string().min(1)).min(1) })
  .strict();

export const UpdateDashboardMetaPayloadSchema = z
  .object({
    title: z.string().min(1).optional(),
    description: z.string().optional(),
  })
  .strict()
  .refine(
    (d) => d.title !== undefined || d.description !== undefined,
    "At least one of title or description must be provided"
  );

export const SetDatasetPayloadSchema = z
  .object({ datasetId: z.string().min(1, "datasetId is required") })
  .strict();

export const AttachDatasetPayloadSchema = z
  .object({ datasetId: z.string().min(1, "datasetId is required") })
  .strict();

export const DetachDatasetPayloadSchema = z
  .object({ datasetId: z.string().min(1, "datasetId is required") })
  .strict();

export const SetThemePayloadSchema = z.object({ theme: ThemeSchema }).strict();

export const CreateMeasurePayloadSchema = z
  .object({
    name: z.string().min(1, "Measure name is required"),
    expression: z.string().min(1, "Measure expression is required"),
    dataType: z.enum(["number", "string", "boolean", "date"]).optional(),
    formatString: z.string().optional(),
  })
  .strict();

export const DeleteMeasurePayloadSchema = z
  .object({ name: z.string().min(1, "Measure name is required") })
  .strict();

/**
 * update_style is a true discriminated union by scope — not just "scope plus
 * optional ids" — so the schema stage itself enforces the shape of each
 * level, before scope validation or the reducer ever runs:
 *   - "visual": pageId + visualId required; style is a visual-style patch.
 *     No other visual can be named or touched.
 *   - "page": pageId required, visualId FORBIDDEN (an extra key here is a
 *     schema-stage rejection, not a semantic one) — style, the same
 *     visual-style shape, is applied to every visual on that one page.
 *   - "dashboard": neither pageId nor visualId is accepted at all; style is a
 *     partial Theme, merged into the dashboard's theme object.
 */
const NonEmptyStyleSchema = StyleSchema.refine(
  (s) => Object.keys(s).length > 0,
  "style must not be empty"
);

export const UpdateStylePayloadSchema = z.discriminatedUnion("scope", [
  z
    .object({
      scope: z.literal("visual"),
      pageId: z.string().min(1, "pageId is required"),
      visualId: z.string().min(1, "visualId is required"),
      style: NonEmptyStyleSchema,
      replace: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      scope: z.literal("page"),
      pageId: z.string().min(1, "pageId is required"),
      style: NonEmptyStyleSchema,
      replace: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      scope: z.literal("dashboard"),
      style: PartialThemeSchema,
      replace: z.boolean().optional(),
    })
    .strict(),
]);

export const AddFilterPayloadSchema = z
  .object({
    scope: CommandScopeSchema,
    pageId: z.string().min(1).optional(),
    visualId: z.string().min(1).optional(),
    filter: FilterConfigSchema,
  })
  .strict();

export const RemoveFilterPayloadSchema = z
  .object({
    scope: CommandScopeSchema,
    pageId: z.string().min(1).optional(),
    visualId: z.string().min(1).optional(),
    field: z.string().min(1, "field is required"),
  })
  .strict();

/** A nested command inside a batch — validated recursively by the engine. */
export const NestedCommandSchema = z
  .object({
    type: z.string().min(1),
    payload: z.unknown(),
    origin: CommandOriginSchema.optional(),
    prompt: z.string().optional(),
  })
  .strict();

export const BatchCommandsPayloadSchema = z
  .object({ commands: z.array(NestedCommandSchema).min(1) })
  .strict();

export const UndoPayloadSchema = z.object({}).strict();
export const RedoPayloadSchema = z.object({}).strict();

// ─────────────────────────────────────────────
// Command-type → Payload Schema lookup
// ─────────────────────────────────────────────

/**
 * Keyed by canonical command type only. Callers must resolve aliases with
 * `normalizeCommandType` first, so there is exactly one schema per command.
 */
export const PAYLOAD_SCHEMAS: Record<CommandActionType, z.ZodTypeAny> = {
  CREATE_VISUAL: CreateVisualPayloadSchema,
  UPDATE_VISUAL: UpdateVisualPayloadSchema,
  DELETE_VISUAL: DeleteVisualPayloadSchema,
  MOVE_VISUAL: MoveVisualPayloadSchema,
  RESIZE_VISUAL: ResizeVisualPayloadSchema,
  CHANGE_CHART_TYPE: ChangeChartTypePayloadSchema,
  CHANGE_DIMENSION: ChangeDimensionPayloadSchema,
  CHANGE_MEASURE: ChangeMeasurePayloadSchema,
  CHANGE_AGGREGATION: ChangeAggregationPayloadSchema,
  REORDER_VISUALS: ReorderVisualsPayloadSchema,
  CREATE_PAGE: CreatePagePayloadSchema,
  DELETE_PAGE: DeletePagePayloadSchema,
  RENAME_PAGE: RenamePagePayloadSchema,
  SWITCH_PAGE: SwitchPagePayloadSchema,
  REORDER_PAGES: ReorderPagesPayloadSchema,
  UPDATE_DASHBOARD_META: UpdateDashboardMetaPayloadSchema,
  SET_DATASET: SetDatasetPayloadSchema,
  ATTACH_DATASET: AttachDatasetPayloadSchema,
  DETACH_DATASET: DetachDatasetPayloadSchema,
  SET_THEME: SetThemePayloadSchema,
  CREATE_MEASURE: CreateMeasurePayloadSchema,
  DELETE_MEASURE: DeleteMeasurePayloadSchema,
  UPDATE_STYLE: UpdateStylePayloadSchema,
  ADD_FILTER: AddFilterPayloadSchema,
  REMOVE_FILTER: RemoveFilterPayloadSchema,
  BATCH_COMMANDS: BatchCommandsPayloadSchema,
  UNDO: UndoPayloadSchema,
  REDO: RedoPayloadSchema,
};

/**
 * Legacy export: scope by command type, including the `"explicit"` marker for
 * commands whose scope is carried in the payload.
 */
export const COMMAND_SCOPE = COMMAND_SCOPES;

/** Every canonical command type, for error messages and introspection. */
export const KNOWN_COMMAND_TYPES = ALL_COMMAND_TYPES;

// ─────────────────────────────────────────────
// Command envelope
// ─────────────────────────────────────────────

/**
 * The envelope every command arrives in, regardless of origin. `schemaVersion`
 * is optional on the wire and defaults to the current version; a command
 * declaring a future version is rejected rather than guessed at.
 */
export const CommandEnvelopeSchema = z
  .object({
    type: z.string().min(1, "Command type is required"),
    payload: z.unknown(),
    origin: CommandOriginSchema.optional(),
    prompt: z.string().optional(),
    schemaVersion: z
      .number()
      .int()
      .min(1)
      .max(
        COMMAND_SCHEMA_VERSION,
        `Unsupported schemaVersion — this server implements version ${COMMAND_SCHEMA_VERSION}.`
      )
      .optional(),
  })
  .strict();

export type CommandEnvelope = z.infer<typeof CommandEnvelopeSchema>;

// ─────────────────────────────────────────────
// Inferred payload types (runtime validation ⇄ compile-time types, one source)
// ─────────────────────────────────────────────

export type CreateVisualPayload = z.infer<typeof CreateVisualPayloadSchema>;
export type UpdateVisualPayload = z.infer<typeof UpdateVisualPayloadSchema>;
export type DeleteVisualPayload = z.infer<typeof DeleteVisualPayloadSchema>;
export type MoveVisualPayload = z.infer<typeof MoveVisualPayloadSchema>;
export type ResizeVisualPayload = z.infer<typeof ResizeVisualPayloadSchema>;
export type ChangeChartTypePayload = z.infer<typeof ChangeChartTypePayloadSchema>;
export type ChangeDimensionPayload = z.infer<typeof ChangeDimensionPayloadSchema>;
export type ChangeMeasurePayload = z.infer<typeof ChangeMeasurePayloadSchema>;
export type ChangeAggregationPayload = z.infer<
  typeof ChangeAggregationPayloadSchema
>;
export type UpdateStylePayload = z.infer<typeof UpdateStylePayloadSchema>;
export type AddFilterPayload = z.infer<typeof AddFilterPayloadSchema>;
export type RemoveFilterPayload = z.infer<typeof RemoveFilterPayloadSchema>;
export type CreateMeasurePayload = z.infer<typeof CreateMeasurePayloadSchema>;
