/**
 * 3-Stage Command Validation Engine
 *
 * Every incoming command — manual UI or AI, no exceptions — passes through all
 * three stages in this order before it is allowed to execute:
 *
 *   Stage 1 SCHEMA   — the command type resolves to a known command, the declared
 *                      schemaVersion is supported, and the payload survives
 *                      `zod.parse` against that command's strict schema.
 *   Stage 2 SEMANTIC — every entity the payload names (page, visual, field,
 *                      measure) actually exists in the current state. Misses come
 *                      back with Levenshtein-ranked suggestions.
 *   Stage 3 SCOPE    — the command targets the hierarchy level it claims to
 *                      (visual | page | dashboard), with exactly the identifiers
 *                      that level requires and no identifiers it must not have.
 *
 * Stage 2 only checks identifiers that are *present*; a missing-but-required
 * identifier is a scope concern and is reported by stage 3, so each failure is
 * attributed to the stage that actually owns it.
 *
 * Never throws. Returns a structured `ValidationOutcome`.
 */

import type { ZodError } from "zod";
import type {
  Command,
  CommandActionType,
  CommandScope,
  DashboardState,
  ColumnProfile,
  Page,
  Visual,
} from "@ai-vis/types";
import { normalizeCommandType, COMMAND_SCOPES } from "@ai-vis/types";
import { PAYLOAD_SCHEMAS, KNOWN_COMMAND_TYPES, COMMAND_SCHEMA_VERSION } from "./schemas.js";

// ─────────────────────────────────────────────
// Public Types
// ─────────────────────────────────────────────

export type ValidationStage = "schema" | "semantic" | "scope";

export interface ValidationSuccess {
  valid: true;
  /** Canonical command type the input resolved to. */
  type: CommandActionType;
  /** The parsed + normalised payload. This — not the raw input — is what executes. */
  payload: unknown;
  /** Effective scope: intrinsic for most commands, from the payload for explicit ones. */
  scope: CommandScope;
}

export interface ValidationFailure {
  valid: false;
  stage: ValidationStage;
  message: string;
  /** Ranked near-miss candidates for a name that did not resolve. */
  suggestions?: string[];
  /** Structured per-path errors from Zod (schema stage only). */
  fieldErrors?: Record<string, string[]>;
}

export type ValidationOutcome = ValidationSuccess | ValidationFailure;

export interface ValidationContext {
  dashboardState: DashboardState;
  /** Column profiles for the bound dataset. Field checks are skipped when absent. */
  datasetSchema?: ColumnProfile[];
  /** Per-dataset column list, keyed by dataset id — lets a command bound to a specific dataset be checked against just that dataset's fields. */
  datasetSchemasById?: Map<string, ColumnProfile[]>;
  /** Dataset ids confirmed to exist in the database — used to validate ATTACH_DATASET targets. */
  knownDatasetIds?: Set<string>;
}

/** @deprecated Use ValidationSuccess. Kept for existing imports. */
export type ValidationResult = ValidationSuccess;

// ─────────────────────────────────────────────
// Levenshtein distance (fuzzy "did you mean" suggestions)
// ─────────────────────────────────────────────

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  // Single-row rolling buffer — O(min(m,n)) space.
  let prev: number[] = Array.from({ length: n + 1 }, (_, j) => j);
  let curr: number[] = new Array<number>(n + 1).fill(0);

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n]!;
}

/**
 * Rank candidates by edit distance to `name`. The threshold scales with the
 * length of the name so that short names don't match everything and long names
 * still tolerate a typo or two.
 */
export function findSuggestions(name: string, candidates: string[]): string[] {
  const target = name.toLowerCase();
  const maxDistance = Math.max(2, Math.floor(target.length / 3));

  return candidates
    .map((c) => {
      const lower = c.toLowerCase();
      // A containment match (e.g. "revenue" → "total_revenue") is a strong signal
      // even when the edit distance is large, so score it as a near-exact match.
      const contains = lower.includes(target) || target.includes(lower);
      return { name: c, dist: contains ? 0.5 : levenshtein(target, lower) };
    })
    .filter(({ dist }) => dist > 0 && dist <= maxDistance)
    .sort((a, b) => a.dist - b.dist || a.name.localeCompare(b.name))
    .slice(0, 5)
    .map(({ name: n }) => n);
}

// ─────────────────────────────────────────────
// Stage 1: Schema Validation (Zod)
// ─────────────────────────────────────────────

interface SchemaSuccess {
  valid: true;
  type: CommandActionType;
  payload: unknown;
}

function validateSchema(command: {
  type: string;
  payload: unknown;
  schemaVersion?: number;
}): SchemaSuccess | ValidationFailure {
  const type = normalizeCommandType(command.type);

  if (!type) {
    return {
      valid: false,
      stage: "schema",
      message: `Unknown command type '${command.type}'.`,
      suggestions: findSuggestions(command.type, KNOWN_COMMAND_TYPES),
    };
  }

  if (command.schemaVersion !== undefined && command.schemaVersion > COMMAND_SCHEMA_VERSION) {
    return {
      valid: false,
      stage: "schema",
      message: `Command declares schemaVersion ${command.schemaVersion}, but this server implements version ${COMMAND_SCHEMA_VERSION}.`,
    };
  }

  const schema = PAYLOAD_SCHEMAS[type];
  const result = schema.safeParse(command.payload ?? {});

  if (!result.success) {
    const zodError = result.error as ZodError;
    const fieldErrors: Record<string, string[]> = {};
    const messages: string[] = [];

    for (const issue of zodError.issues) {
      const path = issue.path.map(String).join(".") || "_root";
      (fieldErrors[path] ??= []).push(issue.message);
      messages.push(path === "_root" ? issue.message : `${path}: ${issue.message}`);
    }

    const shown = messages.slice(0, 3).join("; ");
    const extra = messages.length > 3 ? ` (+${messages.length - 3} more)` : "";

    return {
      valid: false,
      stage: "schema",
      message: `Schema validation failed for '${type}': ${shown}${extra}`,
      fieldErrors,
    };
  }

  return { valid: true, type, payload: result.data };
}

// ─────────────────────────────────────────────
// Stage 2: Semantic Validation
// ─────────────────────────────────────────────

function validateSemantic(
  type: CommandActionType,
  payload: Record<string, unknown>,
  context: ValidationContext
): ValidationFailure | null {
  const { dashboardState, datasetSchema, datasetSchemasById, knownDatasetIds } = context;
  const { pages, calculatedFields } = dashboardState.dashboard;

  /** Verify a `datasetId` a command wants to bind is actually attached to this dashboard. */
  function checkDatasetAttached(datasetId: unknown): ValidationFailure | null {
    if (typeof datasetId !== "string" || !datasetId) return null;
    if (dashboardState.dashboard.datasetIds.includes(datasetId)) return null;
    return {
      valid: false,
      stage: "semantic",
      message: `Dataset '${datasetId}' is not attached to this dashboard. Attach it first.`,
    };
  }

  // Known field names = dataset columns + dashboard-level calculated measures.
  const knownFields = datasetSchema
    ? [
        ...datasetSchema.map((c) => c.name),
        ...(calculatedFields ?? []).map((f) => f.name),
      ]
    : null;
  const knownFieldsLower = knownFields
    ? new Set(knownFields.map((n) => n.toLowerCase()))
    : null;

  /**
   * The known-field list to check against for a command bound to a specific
   * dataset: that dataset's own columns + calculated measures — stricter than
   * the union-of-everything-attached fallback, so a chart can't accept a
   * field that only exists on a *different* attached dataset.
   * Falls back to the union when the dataset's own schema isn't available
   * (e.g. `datasetSchemasById` wasn't supplied, as in older tests/fixtures).
   */
  function knownFieldsFor(
    datasetId: string | undefined
  ): { list: string[]; lower: Set<string> } | null {
    const scoped = datasetId ? datasetSchemasById?.get(datasetId) : undefined;
    if (!scoped) return knownFields && knownFieldsLower ? { list: knownFields, lower: knownFieldsLower } : null;
    const list = [...scoped.map((c) => c.name), ...(calculatedFields ?? []).map((f) => f.name)];
    return { list, lower: new Set(list.map((n) => n.toLowerCase())) };
  }

  /** Verify a field exists in the dataset. No-op when no dataset is bound. */
  function checkField(
    field: unknown,
    label: string,
    known: { list: string[]; lower: Set<string> } | null = knownFields && knownFieldsLower
      ? { list: knownFields, lower: knownFieldsLower }
      : null
  ): ValidationFailure | null {
    if (typeof field !== "string" || !field) return null;
    if (!known) return null;
    if (known.lower.has(field.toLowerCase())) return null;

    const suggestions = findSuggestions(field, known.list);
    return {
      valid: false,
      stage: "semantic",
      message:
        `${label} '${field}' does not exist in the dataset.` +
        (suggestions.length > 0 ? ` Did you mean '${suggestions[0]}'?` : ""),
      ...(suggestions.length > 0 ? { suggestions } : {}),
    };
  }

  function checkFields(
    fields: unknown,
    label: string,
    known: { list: string[]; lower: Set<string> } | null = knownFields && knownFieldsLower
      ? { list: knownFields, lower: knownFieldsLower }
      : null
  ): ValidationFailure | null {
    const list = Array.isArray(fields) ? fields : [fields];
    for (const f of list) {
      const err = checkField(f, label, known);
      if (err) return err;
    }
    return null;
  }

  function checkEncoding(
    encoding: unknown,
    known: { list: string[]; lower: Set<string> } | null = knownFields && knownFieldsLower
      ? { list: knownFields, lower: knownFieldsLower }
      : null
  ): ValidationFailure | null {
    if (!encoding || typeof encoding !== "object") return null;
    const e = encoding as Record<string, unknown>;
    const err =
      checkField(e.xField, "Field", known) ??
      checkFields(e.yField, "Field", known) ??
      checkField(e.seriesField, "Series field", known) ??
      checkField(e.colorField, "Color field", known) ??
      checkField(e.sizeField, "Size field", known) ??
      checkField(e.labelField, "Label field", known);
    if (err) return err;

    if (Array.isArray(e.measures)) {
      for (const m of e.measures as { field?: unknown }[]) {
        const mErr = checkField(m?.field, "Measure field", known);
        if (mErr) return mErr;
      }
    }
    return null;
  }

  /** Resolve a page. Returns null when pageId is absent — stage 3 reports that. */
  function resolvePage(pageId: unknown): Page | ValidationFailure | null {
    if (typeof pageId !== "string" || !pageId) return null;
    const page = pages.find((p) => p.id === pageId);
    if (page) return page;

    const suggestions = findSuggestions(
      pageId,
      pages.map((p) => p.id)
    );
    return {
      valid: false,
      stage: "semantic",
      message: `Page '${pageId}' does not exist on this dashboard.`,
      ...(suggestions.length > 0 ? { suggestions } : {}),
    };
  }

  /** Resolve a visual within its page. Returns null when either id is absent. */
  function resolveVisual(
    pageId: unknown,
    visualId: unknown
  ): { page: Page; visual: Visual } | ValidationFailure | null {
    const pageResult = resolvePage(pageId);
    if (pageResult === null) return null;
    if ("valid" in pageResult) return pageResult;
    if (typeof visualId !== "string" || !visualId) return null;

    const visual = pageResult.visuals.find((v) => v.id === visualId);
    if (visual) return { page: pageResult, visual };

    const suggestions = findSuggestions(
      visualId,
      pageResult.visuals.map((v) => v.id)
    );
    return {
      valid: false,
      stage: "semantic",
      message: `Visual '${visualId}' does not exist on page '${pageResult.id}'.`,
      ...(suggestions.length > 0 ? { suggestions } : {}),
    };
  }

  /** Reject layouts that would overflow the page's column grid. */
  function checkBounds(page: Page, x: number, width: number): ValidationFailure | null {
    const columns = page.layoutConfig?.columns ?? 12;
    if (x + width > columns) {
      return {
        valid: false,
        stage: "semantic",
        message: `Layout out of bounds: x (${x}) + width (${width}) = ${x + width} exceeds the page's ${columns}-column grid.`,
      };
    }
    return null;
  }

  switch (type) {
    case "CREATE_VISUAL": {
      const page = resolvePage(payload.pageId);
      if (page && "valid" in page) return page;

      if (page) {
        const layout = (payload.layout ?? {}) as { x?: number; width?: number };
        const err = checkBounds(page, layout.x ?? 0, layout.width ?? 6);
        if (err) return err;
      }
      const targetDatasetId = (payload.datasetId as string | undefined) ?? dashboardState.dashboard.datasetId;
      return (
        checkDatasetAttached(payload.datasetId) ??
        checkEncoding(payload.encoding, knownFieldsFor(targetDatasetId))
      );
    }

    case "UPDATE_VISUAL": {
      const target = resolveVisual(payload.pageId, payload.visualId);
      if (target && "valid" in target) return target;

      const patch = (payload.patch ?? {}) as Record<string, unknown>;
      if (target && patch.layout) {
        const lp = patch.layout as { x?: number; width?: number };
        const err = checkBounds(
          target.page,
          lp.x ?? target.visual.layout.x,
          lp.width ?? target.visual.layout.width
        );
        if (err) return err;
      }
      const targetDatasetId =
        (patch.datasetId as string | undefined) ??
        target?.visual.datasetId ??
        dashboardState.dashboard.datasetId;
      return (
        checkDatasetAttached(patch.datasetId) ??
        checkEncoding(patch.encoding, knownFieldsFor(targetDatasetId))
      );
    }

    case "DELETE_VISUAL":
    case "CHANGE_CHART_TYPE": {
      const target = resolveVisual(payload.pageId, payload.visualId);
      return target && "valid" in target ? target : null;
    }

    case "MOVE_VISUAL": {
      const target = resolveVisual(payload.pageId, payload.visualId);
      if (target && "valid" in target) return target;
      if (!target) return null;
      return checkBounds(target.page, payload.x as number, target.visual.layout.width);
    }

    case "RESIZE_VISUAL": {
      const target = resolveVisual(payload.pageId, payload.visualId);
      if (target && "valid" in target) return target;
      if (!target) return null;
      return checkBounds(target.page, target.visual.layout.x, payload.width as number);
    }

    case "CHANGE_DIMENSION": {
      const target = resolveVisual(payload.pageId, payload.visualId);
      if (target && "valid" in target) return target;
      return checkField(payload.field, "Dimension field");
    }

    case "CHANGE_MEASURE": {
      const target = resolveVisual(payload.pageId, payload.visualId);
      if (target && "valid" in target) return target;
      return checkField(payload.field, "Measure field");
    }

    case "CHANGE_AGGREGATION": {
      const target = resolveVisual(payload.pageId, payload.visualId);
      if (target && "valid" in target) return target;
      if (!target) return null;

      const index = payload.measureIndex as number | undefined;
      const measures = target.visual.encoding?.measures ?? [];
      if (index !== undefined && index >= measures.length) {
        return {
          valid: false,
          stage: "semantic",
          message: `Visual '${target.visual.id}' has ${measures.length} measure(s); measureIndex ${index} is out of range.`,
        };
      }
      return null;
    }

    case "REORDER_VISUALS": {
      const page = resolvePage(payload.pageId);
      if (page && "valid" in page) return page;
      if (!page) return null;

      const known = new Set(page.visuals.map((v) => v.id));
      const layouts = payload.layouts as { visualId: string; layout: unknown }[];
      const missing = layouts.map((l) => l.visualId).filter((id) => !known.has(id));
      if (missing.length > 0) {
        return {
          valid: false,
          stage: "semantic",
          message: `REORDER_VISUALS references visuals not on page '${page.id}': ${missing.join(", ")}.`,
        };
      }
      return null;
    }

    case "DELETE_PAGE": {
      const page = resolvePage(payload.pageId);
      if (page && "valid" in page) return page;
      if (pages.length <= 1) {
        return {
          valid: false,
          stage: "semantic",
          message: "Cannot delete the last page — a dashboard must have at least one page.",
        };
      }
      return null;
    }

    case "CREATE_PAGE": {
      const pageId = payload.pageId;
      if (typeof pageId === "string" && pages.some((p) => p.id === pageId)) {
        return {
          valid: false,
          stage: "semantic",
          message: `Page '${pageId}' already exists on this dashboard.`,
        };
      }
      return null;
    }

    case "RENAME_PAGE":
    case "SWITCH_PAGE": {
      const page = resolvePage(payload.pageId);
      return page && "valid" in page ? page : null;
    }

    case "REORDER_PAGES": {
      const ids = payload.orderedPageIds as string[];
      const existing = new Set(pages.map((p) => p.id));
      const missing = ids.filter((id) => !existing.has(id));
      if (missing.length > 0) {
        return {
          valid: false,
          stage: "semantic",
          message: `REORDER_PAGES references unknown page IDs: ${missing.join(", ")}.`,
        };
      }
      if (new Set(ids).size !== ids.length) {
        return {
          valid: false,
          stage: "semantic",
          message: "REORDER_PAGES contains duplicate page IDs.",
        };
      }
      if (ids.length !== pages.length) {
        return {
          valid: false,
          stage: "semantic",
          message: `REORDER_PAGES must list all ${pages.length} page IDs; got ${ids.length}.`,
        };
      }
      return null;
    }

    case "CREATE_MEASURE": {
      const name = payload.name as string;
      if ((calculatedFields ?? []).some((f) => f.name === name)) {
        return {
          valid: false,
          stage: "semantic",
          message: `A measure named '${name}' already exists on this dashboard.`,
        };
      }
      // A measure that shadows a dataset column would make field references ambiguous.
      if (knownFieldsLower?.has(name.toLowerCase())) {
        return {
          valid: false,
          stage: "semantic",
          message: `Measure name '${name}' collides with an existing dataset column.`,
        };
      }
      return null;
    }

    case "DELETE_MEASURE": {
      const name = payload.name as string;
      const existing = calculatedFields ?? [];
      if (!existing.some((f) => f.name === name)) {
        const suggestions = findSuggestions(
          name,
          existing.map((f) => f.name)
        );
        return {
          valid: false,
          stage: "semantic",
          message: `No measure named '${name}' exists on this dashboard.`,
          ...(suggestions.length > 0 ? { suggestions } : {}),
        };
      }
      return null;
    }

    case "UPDATE_STYLE": {
      const target = resolveVisual(payload.pageId, payload.visualId);
      if (target && "valid" in target) return target;
      if (payload.visualId === undefined) {
        const page = resolvePage(payload.pageId);
        if (page && "valid" in page) return page;
      }
      return null;
    }

    case "ADD_FILTER": {
      const target = resolveVisual(payload.pageId, payload.visualId);
      if (target && "valid" in target) return target;
      if (payload.visualId === undefined) {
        const page = resolvePage(payload.pageId);
        if (page && "valid" in page) return page;
      }
      return checkField((payload.filter as { field?: unknown })?.field, "Filter field");
    }

    case "REMOVE_FILTER": {
      const scope = payload.scope as CommandScope;
      const field = payload.field as string;

      const target = resolveVisual(payload.pageId, payload.visualId);
      if (target && "valid" in target) return target;

      let existing: { field: string }[] | undefined;
      if (scope === "visual" && target) {
        existing = target.visual.filters;
      } else if (scope === "page") {
        const page = resolvePage(payload.pageId);
        if (page && "valid" in page) return page;
        if (!page) return null;
        existing = page.filters;
      } else if (scope === "dashboard") {
        existing = dashboardState.dashboard.filters;
      } else {
        return null;
      }

      if (!existing?.some((f) => f.field === field)) {
        const suggestions = findSuggestions(field, (existing ?? []).map((f) => f.field));
        return {
          valid: false,
          stage: "semantic",
          message: `No ${scope}-level filter on field '${field}' exists to remove.`,
          ...(suggestions.length > 0 ? { suggestions } : {}),
        };
      }
      return null;
    }

    case "ATTACH_DATASET": {
      const datasetId = payload.datasetId as string;
      if (dashboardState.dashboard.datasetIds.includes(datasetId)) {
        return {
          valid: false,
          stage: "semantic",
          message: `Dataset '${datasetId}' is already attached to this dashboard.`,
        };
      }
      if (knownDatasetIds && !knownDatasetIds.has(datasetId)) {
        return {
          valid: false,
          stage: "semantic",
          message: `Dataset '${datasetId}' does not exist.`,
        };
      }
      return null;
    }

    case "DETACH_DATASET": {
      const datasetId = payload.datasetId as string;
      if (!dashboardState.dashboard.datasetIds.includes(datasetId)) {
        return {
          valid: false,
          stage: "semantic",
          message: `Dataset '${datasetId}' is not attached to this dashboard.`,
        };
      }

      const usedBy: string[] = [];
      for (const page of pages) {
        for (const visual of page.visuals) {
          const boundId = visual.datasetId ?? dashboardState.dashboard.datasetId;
          if (boundId === datasetId) usedBy.push(visual.title || visual.id);
        }
      }
      if (usedBy.length > 0) {
        return {
          valid: false,
          stage: "semantic",
          message:
            `Cannot remove this dataset: ${usedBy.length} chart(s) still use it ` +
            `(${usedBy.slice(0, 5).join(", ")}${usedBy.length > 5 ? ", ..." : ""}). ` +
            `Reassign or delete them first.`,
        };
      }
      return null;
    }

    case "SET_DATASET":
    case "SET_THEME":
    case "UPDATE_DASHBOARD_META":
    case "BATCH_COMMANDS":
    case "UNDO":
    case "REDO":
      return null;

    default:
      return null;
  }
}

// ─────────────────────────────────────────────
// Stage 3: Scope Validation
// ─────────────────────────────────────────────

/** Commands that mint the visual they target, so the id is optional on input. */
const MINTS_VISUAL_ID = new Set<CommandActionType>(["CREATE_VISUAL"]);
/** Commands that mint the page they target, so the id is optional on input. */
const MINTS_PAGE_ID = new Set<CommandActionType>(["CREATE_PAGE"]);

function validateScope(
  type: CommandActionType,
  payload: Record<string, unknown>
): { scope: CommandScope } | ValidationFailure {
  const declared = COMMAND_SCOPES[type];

  const hasPageId = typeof payload.pageId === "string" && payload.pageId.length > 0;
  const hasVisualId = typeof payload.visualId === "string" && payload.visualId.length > 0;

  const scope: CommandScope =
    declared === "explicit" ? (payload.scope as CommandScope) : declared;

  const fail = (message: string): ValidationFailure => ({
    valid: false,
    stage: "scope",
    message,
  });

  switch (scope) {
    case "visual": {
      if (!hasPageId) {
        return fail(
          `'${type}' is visual-scoped and must identify the page its target lives on, but no 'pageId' was provided.`
        );
      }
      if (!hasVisualId && !MINTS_VISUAL_ID.has(type)) {
        return fail(
          `'${type}' is visual-scoped and must identify its target with a 'visualId'.`
        );
      }
      break;
    }

    case "page": {
      if (!hasPageId && !MINTS_PAGE_ID.has(type)) {
        return fail(
          `'${type}' is page-scoped and must identify its target with a 'pageId'.`
        );
      }
      // A page-scoped change must not name a single visual: that would silently
      // narrow a page-wide edit to one chart (or widen a visual edit to the page).
      if (hasVisualId) {
        return fail(
          `Scope mismatch: '${type}' is page-scoped, but the payload targets visual '${String(payload.visualId)}'. Use a visual-scoped command to change a single visual.`
        );
      }
      break;
    }

    case "dashboard": {
      if (hasVisualId) {
        return fail(
          `Scope mismatch: '${type}' is dashboard-scoped, but the payload targets visual '${String(payload.visualId)}'. Dashboard-level changes must not name a single visual.`
        );
      }
      if (hasPageId && declared === "explicit") {
        return fail(
          `Scope mismatch: scope is 'dashboard', but the payload targets page '${String(payload.pageId)}'. Use scope 'page' to change a single page.`
        );
      }
      break;
    }

    default:
      return fail(`Command '${type}' declares an unrecognised scope.`);
  }

  return { scope };
}

// ─────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────

/**
 * Run the full schema → semantic → scope pipeline.
 * Returns the first failure encountered, or the normalised command on success.
 */
export function validateCommandFull(
  command: { type: string; payload: unknown; schemaVersion?: number },
  context: ValidationContext
): ValidationOutcome {
  // ── Stage 1: schema ──
  const schemaResult = validateSchema(command);
  if (!schemaResult.valid) return schemaResult;

  const { type, payload } = schemaResult;
  const payloadRecord = (payload ?? {}) as Record<string, unknown>;

  // ── Stage 2: semantic ──
  const semanticFailure = validateSemantic(type, payloadRecord, context);
  if (semanticFailure) return semanticFailure;

  // ── Stage 3: scope ──
  const scopeResult = validateScope(type, payloadRecord);
  if ("valid" in scopeResult) return scopeResult;

  return { valid: true, type, payload, scope: scopeResult.scope };
}

/**
 * Backward-compatible shim: throws `AppError` on failure.
 * Prefer `validateCommandFull`, which returns structured results and the
 * normalised payload that should actually be executed.
 */
import { AppError } from "../middleware/error-handler.js";

const STAGE_ERROR_CODES: Record<ValidationStage, string> = {
  schema: "SCHEMA_VALIDATION_FAILED",
  semantic: "SEMANTIC_VALIDATION_FAILED",
  scope: "SCOPE_VALIDATION_FAILED",
};

export function validateCommand(command: Command, context: ValidationContext): void {
  const result = validateCommandFull(command, context);
  if (result.valid) return;

  const suffix =
    result.suggestions && result.suggestions.length > 0
      ? ` Did you mean: ${result.suggestions.join(", ")}?`
      : "";

  throw new AppError(400, STAGE_ERROR_CODES[result.stage], result.message + suffix);
}
