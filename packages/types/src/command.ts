import type {
  Visual,
  VisualKind,
  Layout,
  Style,
  VisualEncoding,
  AggregationType,
  FilterConfig,
  Theme,
  PageLayoutConfig,
  DashboardState,
} from "./dashboard.js";

// ─────────────────────────────────────────────
// Command Schema Version
// ─────────────────────────────────────────────

/**
 * Version of the command envelope + payload contract.
 *
 * Bump this whenever a payload shape changes in a backwards-incompatible way.
 * Commands persisted in the audit log carry the version they were written with,
 * so replays can migrate old payloads forward.
 */
export const COMMAND_SCHEMA_VERSION = 1 as const;
export type CommandSchemaVersion = typeof COMMAND_SCHEMA_VERSION;

// ─────────────────────────────────────────────
// Scope
// ─────────────────────────────────────────────

/**
 * The hierarchy level a command operates on. Every command type has exactly one
 * intrinsic scope, except UPDATE_STYLE / ADD_FILTER / REMOVE_FILTER which carry
 * an explicit `scope` discriminant in their payload.
 */
export type CommandScope = "visual" | "page" | "dashboard";

// ─────────────────────────────────────────────
// Canonical action types
// ─────────────────────────────────────────────

export type CommandActionType =
  // ── visual scope ──
  | "CREATE_VISUAL"
  | "UPDATE_VISUAL"
  | "DELETE_VISUAL"
  | "MOVE_VISUAL"
  | "RESIZE_VISUAL"
  | "CHANGE_CHART_TYPE"
  | "CHANGE_DIMENSION"
  | "CHANGE_MEASURE"
  | "CHANGE_AGGREGATION"
  // ── page scope ──
  | "REORDER_VISUALS"
  | "CREATE_PAGE"
  | "DELETE_PAGE"
  | "RENAME_PAGE"
  | "SWITCH_PAGE"
  // ── dashboard scope ──
  | "REORDER_PAGES"
  | "UPDATE_DASHBOARD_META"
  | "SET_DATASET"
  | "ATTACH_DATASET"
  | "DETACH_DATASET"
  | "SET_THEME"
  | "CREATE_MEASURE"
  | "DELETE_MEASURE"
  // ── explicitly scoped (scope lives in the payload) ──
  | "UPDATE_STYLE"
  | "ADD_FILTER"
  | "REMOVE_FILTER"
  // ── meta ──
  | "BATCH_COMMANDS"
  | "UNDO"
  | "REDO";

/**
 * Accepted snake_case aliases. The AI planner and some UI call sites emit these;
 * `normalizeCommandType` folds them onto the canonical UPPER_SNAKE name so that
 * exactly one reducer branch and one schema exist per logical command.
 */
export const COMMAND_TYPE_ALIASES: Record<string, CommandActionType> = {
  create_chart: "CREATE_VISUAL",
  create_visual: "CREATE_VISUAL",
  add_chart: "CREATE_VISUAL",
  update_visual: "UPDATE_VISUAL",
  delete_visual: "DELETE_VISUAL",
  delete_chart: "DELETE_VISUAL",
  remove_visual: "DELETE_VISUAL",
  move_visual: "MOVE_VISUAL",
  resize_visual: "RESIZE_VISUAL",
  change_chart_type: "CHANGE_CHART_TYPE",
  change_dimension: "CHANGE_DIMENSION",
  change_measure: "CHANGE_MEASURE",
  change_aggregation: "CHANGE_AGGREGATION",
  reorder_visuals: "REORDER_VISUALS",
  create_page: "CREATE_PAGE",
  delete_page: "DELETE_PAGE",
  rename_page: "RENAME_PAGE",
  switch_page: "SWITCH_PAGE",
  reorder_pages: "REORDER_PAGES",
  update_dashboard_meta: "UPDATE_DASHBOARD_META",
  set_dataset: "SET_DATASET",
  attach_dataset: "ATTACH_DATASET",
  detach_dataset: "DETACH_DATASET",
  set_theme: "SET_THEME",
  create_measure: "CREATE_MEASURE",
  delete_measure: "DELETE_MEASURE",
  update_style: "UPDATE_STYLE",
  add_filter: "ADD_FILTER",
  remove_filter: "REMOVE_FILTER",
  batch_commands: "BATCH_COMMANDS",
  undo: "UNDO",
  redo: "REDO",
};

/** The intrinsic scope of each command type. */
export const COMMAND_SCOPES: Record<CommandActionType, CommandScope | "explicit"> = {
  CREATE_VISUAL: "visual",
  UPDATE_VISUAL: "visual",
  DELETE_VISUAL: "visual",
  MOVE_VISUAL: "visual",
  RESIZE_VISUAL: "visual",
  CHANGE_CHART_TYPE: "visual",
  CHANGE_DIMENSION: "visual",
  CHANGE_MEASURE: "visual",
  CHANGE_AGGREGATION: "visual",
  REORDER_VISUALS: "page",
  CREATE_PAGE: "page",
  DELETE_PAGE: "page",
  RENAME_PAGE: "page",
  SWITCH_PAGE: "page",
  REORDER_PAGES: "dashboard",
  UPDATE_DASHBOARD_META: "dashboard",
  SET_DATASET: "dashboard",
  ATTACH_DATASET: "dashboard",
  DETACH_DATASET: "dashboard",
  SET_THEME: "dashboard",
  CREATE_MEASURE: "dashboard",
  DELETE_MEASURE: "dashboard",
  UPDATE_STYLE: "explicit",
  ADD_FILTER: "explicit",
  REMOVE_FILTER: "explicit",
  BATCH_COMMANDS: "dashboard",
  UNDO: "dashboard",
  REDO: "dashboard",
};

/** Every canonical command type, derived from the scope table so the two cannot drift. */
export const ALL_COMMAND_TYPES = Object.keys(COMMAND_SCOPES) as CommandActionType[];

const CANONICAL_TYPES = new Set<string>(ALL_COMMAND_TYPES);

/**
 * Resolve any accepted spelling of a command type to its canonical form.
 * Returns `null` for unrecognised types (the caller reports a schema-stage error).
 */
export function normalizeCommandType(type: string): CommandActionType | null {
  if (CANONICAL_TYPES.has(type)) return type as CommandActionType;
  const upper = type.toUpperCase();
  if (CANONICAL_TYPES.has(upper)) return upper as CommandActionType;
  return COMMAND_TYPE_ALIASES[type.toLowerCase()] ?? null;
}

export type CommandOrigin = "user" | "ai" | "system";

export type CommandStatus = "pending" | "applied" | "reverted" | "failed";

/** Which encoding slot a CHANGE_DIMENSION command retargets. */
export type DimensionSlot = "x" | "y" | "series" | "color" | "size" | "label";

// ─────────────────────────────────────────────
// Command Payload Map — strictly typed per action
// ─────────────────────────────────────────────

export interface CommandPayloadMap {
  CREATE_VISUAL: {
    pageId: string;
    kind: VisualKind;
    title: string;
    visualId?: string;
    layout?: Partial<Layout>;
    encoding?: Partial<VisualEncoding>;
    style?: Partial<Style>;
    datasetId?: string;
  };
  UPDATE_VISUAL: {
    visualId: string;
    pageId: string;
    /** Partial patch — only provided fields are updated */
    patch: Partial<Omit<Visual, "id" | "pageId" | "kind" | "createdAt">>;
  };
  DELETE_VISUAL: {
    visualId: string;
    pageId: string;
  };
  MOVE_VISUAL: {
    pageId: string;
    visualId: string;
    x: number;
    y: number;
  };
  RESIZE_VISUAL: {
    pageId: string;
    visualId: string;
    width: number;
    height: number;
  };
  CHANGE_CHART_TYPE: {
    pageId: string;
    visualId: string;
    kind: VisualKind;
  };
  CHANGE_DIMENSION: {
    pageId: string;
    visualId: string;
    /** Which encoding slot to retarget. Defaults to "x". */
    slot?: DimensionSlot;
    /** New field name, or null to clear the slot. */
    field: string | null;
  };
  CHANGE_MEASURE: {
    pageId: string;
    visualId: string;
    /** Index into `encoding.measures`. Defaults to 0 (creating it if absent). */
    measureIndex?: number;
    field: string;
    aggregation?: AggregationType;
    alias?: string;
  };
  CHANGE_AGGREGATION: {
    pageId: string;
    visualId: string;
    aggregation: AggregationType;
    /** Index into `encoding.measures`. Omit to apply to every measure. */
    measureIndex?: number;
  };
  REORDER_VISUALS: {
    pageId: string;
    layouts: Array<{ visualId: string; layout: Layout }>;
  };
  CREATE_PAGE: {
    title: string;
    pageId?: string;
    layoutConfig?: Partial<PageLayoutConfig>;
  };
  DELETE_PAGE: {
    pageId: string;
  };
  RENAME_PAGE: {
    pageId: string;
    title: string;
  };
  SWITCH_PAGE: {
    pageId: string;
  };
  REORDER_PAGES: {
    orderedPageIds: string[];
  };
  UPDATE_DASHBOARD_META: {
    title?: string;
    description?: string;
  };
  SET_DATASET: {
    datasetId: string;
  };
  ATTACH_DATASET: {
    datasetId: string;
  };
  DETACH_DATASET: {
    datasetId: string;
  };
  SET_THEME: {
    theme: Theme;
  };
  CREATE_MEASURE: {
    name: string;
    expression: string;
    dataType?: "number" | "string" | "boolean" | "date";
    formatString?: string;
  };
  DELETE_MEASURE: {
    name: string;
  };
  /**
   * Style changes carry an explicit scope, and the shape of `style` depends on
   * which:
   *   - "visual": one visual's own look (colors/border/font/spacing/background) —
   *     requires pageId + visualId.
   *   - "page": the SAME visual-style shape, applied to every visual currently
   *     on that page — requires pageId, must NOT name a visualId.
   *   - "dashboard": the dashboard's theme itself — a partial Theme (any of
   *     primary/success/chartPalette/fontSizes/...), merged into
   *     `dashboard.theme` — must not name a page or visual.
   */
  UPDATE_STYLE:
    | { scope: "visual"; pageId: string; visualId: string; style: Partial<Style>; replace?: boolean }
    | { scope: "page"; pageId: string; style: Partial<Style>; replace?: boolean }
    | { scope: "dashboard"; style: Partial<Theme>; replace?: boolean };
  ADD_FILTER: {
    scope: CommandScope;
    pageId?: string;
    visualId?: string;
    filter: FilterConfig;
  };
  REMOVE_FILTER: {
    scope: CommandScope;
    pageId?: string;
    visualId?: string;
    field: string;
  };
  BATCH_COMMANDS: {
    // eslint-disable-next-line @typescript-eslint/no-use-before-define
    commands: Command[];
  };
  UNDO: Record<string, never>;
  REDO: Record<string, never>;
}

// ─────────────────────────────────────────────
// Command
// ─────────────────────────────────────────────

export interface Command<T extends CommandActionType = CommandActionType> {
  id: string;
  dashboardId: string;
  type: T;
  payload: CommandPayloadMap[T];
  origin: CommandOrigin;
  prompt?: string;
  timestamp: string;
  sequenceNumber: number;
  /** Contract version this command was authored against. */
  schemaVersion?: number;
}

/**
 * A command as it arrives from a client (manual UI or AI) — before the engine
 * assigns an id, sequence number and timestamp.
 */
export interface CommandInput {
  type: string;
  payload: unknown;
  origin?: CommandOrigin;
  prompt?: string;
  schemaVersion?: number;
}

// ─────────────────────────────────────────────
// CommandResult — returned by applyAndPersist
// ─────────────────────────────────────────────

export interface CommandResult {
  success: boolean;
  dashboard: DashboardState;
  commandId: string;
  /** Set only on failure */
  errorCode?: string;
  errorMessage?: string;
}

// ─────────────────────────────────────────────
// CommandAuditLog — SQLite record
// ─────────────────────────────────────────────

export interface CommandAuditLog {
  id: string;
  dashboardId: string;
  commandId: string;
  action: CommandActionType;
  origin: CommandOrigin;
  prompt?: string;
  status: CommandStatus;
  payloadJson: string;
  errorMessage?: string;
  executedAt: string;
  userId?: string;
  sequenceNumber: number;
}

// ─────────────────────────────────────────────
// Command History — the undo/redo timeline
// ─────────────────────────────────────────────

/** Where a batch of commands originated. Maps CommandOrigin "user"/"system" -> "manual". */
export type CommandSource = "manual" | "ai";

/** A batch's position relative to the undo/redo pointer. */
export type CommandBatchStatus = "applied" | "reverted";

export interface CommandHistoryCommand {
  id: string;
  type: CommandActionType;
  payload: unknown;
}

/**
 * One row in the Command History panel — one atomic undo/redo unit. A single
 * manual edit is one command in one batch; a multi-step AI turn is still one
 * batch, undone/redone together.
 */
export interface CommandHistoryEntry {
  id: string;
  sequenceNumber: number;
  source: CommandSource;
  status: CommandBatchStatus;
  /** Human-readable label, e.g. "Created Sales chart" or "3 changes: ...". */
  summary: string;
  createdAt: string;
  prompt?: string;
  commands: CommandHistoryCommand[];
}

/** Before/after for one command that targeted a specific visual. */
export interface VisualDiffEntry {
  commandId: string;
  type: CommandActionType;
  /** null if the visual didn't exist beforehand (created) or is gone afterward (deleted). */
  before: Visual | null;
  after: Visual | null;
}

/** "What changed" detail for one history entry, computed on demand from its stored snapshots. */
export interface CommandBatchDiff {
  batchId: string;
  summary: string;
  visualChanges: VisualDiffEntry[];
  /** Raw payloads for commands that don't resolve to a single visual (page/dashboard-level). */
  otherChanges: CommandHistoryCommand[];
}
