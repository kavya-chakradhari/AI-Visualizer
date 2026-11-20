/**
 * Transactional command execution.
 *
 * A batch of commands is all-or-nothing. The executor validates and applies the
 * whole batch against an in-memory working copy of the dashboard state and only
 * then hands the final state to the store to be committed in a single database
 * transaction. Nothing is written until every command has succeeded, so a
 * mid-batch failure leaves the persisted dashboard exactly as it was — there is
 * no partially-applied state to unwind.
 *
 * If the commit itself fails, the pre-batch snapshot is returned and the caller
 * restores its cache from it, so in-memory state cannot drift from the database.
 */

import { randomUUID } from "node:crypto";
import { applyCommandToDashboard } from "@ai-vis/types";
import type {
  Command,
  CommandActionType,
  CommandInput,
  CommandOrigin,
  CommandScope,
  ColumnProfile,
  DashboardState,
} from "@ai-vis/types";
import { COMMAND_SCHEMA_VERSION } from "@ai-vis/types";
import { validateCommandFull, type ValidationStage } from "./validator.js";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export type ExecutionStage = ValidationStage | "execution" | "persistence";

export interface BatchSuccess {
  success: true;
  /** State after the whole batch, as committed. */
  dashboard: DashboardState;
  /** The commands that were applied, in order, fully resolved. */
  applied: Command[];
  executedCount: number;
}

export interface BatchFailure {
  success: false;
  valid: false;
  stage: ExecutionStage;
  message: string;
  suggestions?: string[];
  fieldErrors?: Record<string, string[]>;
  /** Index into the (flattened) input batch of the command that failed. */
  commandIndex?: number;
  commandType?: string;
  /** Always true: the batch was rejected in full and nothing was persisted. */
  rolledBack: true;
  /** How many commands had already been applied to the working copy and were discarded. */
  discardedCount: number;
  /** The unchanged state the dashboard remains in. Absent if it does not exist. */
  dashboard?: DashboardState;
}

export type BatchOutcome = BatchSuccess | BatchFailure;

/**
 * Persistence boundary. The production implementation wraps Prisma's
 * `$transaction`; tests substitute an in-memory double that can be made to fail
 * on demand to exercise rollback.
 */
export interface CommandBatchStore {
  load(dashboardId: string): Promise<DashboardState | null>;
  /**
   * Must persist the state and the command log atomically, or throw.
   * `previous` is the snapshot immediately before this batch — stored
   * alongside `next` so undo can restore directly from it, with no replay.
   */
  commit(
    dashboardId: string,
    previous: DashboardState,
    next: DashboardState,
    applied: Command[]
  ): Promise<void>;
}

export interface ExecuteBatchOptions {
  store: CommandBatchStore;
  datasetSchema?: ColumnProfile[];
  /** Per-dataset column list, keyed by dataset id — used to check a chart's fields against its own declared dataset rather than the union of all attached ones. */
  datasetSchemasById?: Map<string, ColumnProfile[]>;
  /** Dataset ids confirmed to exist in the database — used to validate ATTACH_DATASET targets. */
  knownDatasetIds?: Set<string>;
  /** Defaults to "user". Individual commands may override. */
  defaultOrigin?: CommandOrigin;
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

/** Deep structural clone used for the rollback snapshot. */
function snapshot(state: DashboardState): DashboardState {
  return structuredClone(state);
}

/**
 * Expand BATCH_COMMANDS envelopes into their constituent commands so every
 * command — nested or not — is validated and counted individually.
 */
function flatten(inputs: CommandInput[], depth = 0): CommandInput[] {
  if (depth > 4) {
    throw new Error("BATCH_COMMANDS nesting exceeds the maximum depth of 4.");
  }
  const out: CommandInput[] = [];
  for (const input of inputs) {
    const isBatch = input.type.toUpperCase() === "BATCH_COMMANDS";
    const nested = (input.payload as { commands?: CommandInput[] } | undefined)?.commands;
    if (isBatch && Array.isArray(nested)) {
      out.push(...flatten(nested, depth + 1));
    } else {
      out.push(input);
    }
  }
  return out;
}

/**
 * Fill in ids the reducer would otherwise generate itself, so the persisted
 * command log replays to a byte-identical state.
 */
function seedGeneratedIds(
  type: CommandActionType,
  payload: Record<string, unknown>
): Record<string, unknown> {
  if (type === "CREATE_VISUAL" && !payload.visualId) {
    return { ...payload, visualId: randomUUID() };
  }
  if (type === "CREATE_PAGE" && !payload.pageId) {
    return { ...payload, pageId: randomUUID() };
  }
  return payload;
}

// ─────────────────────────────────────────────
// Executor
// ─────────────────────────────────────────────

/**
 * Validate and execute a batch of commands atomically.
 *
 * Pipeline per command: schema → semantic → scope → execution, each validated
 * against the state as it stands *after* the preceding commands in the batch,
 * so a batch like `[create_page, create_chart on that page]` validates correctly.
 */
export async function executeCommandBatch(
  dashboardId: string,
  inputs: CommandInput[],
  options: ExecuteBatchOptions
): Promise<BatchOutcome> {
  const { store, datasetSchema, datasetSchemasById, knownDatasetIds, defaultOrigin = "user" } =
    options;

  const loaded = await store.load(dashboardId);
  if (!loaded) {
    return {
      success: false,
      valid: false,
      stage: "semantic",
      message: `Dashboard '${dashboardId}' not found.`,
      rolledBack: true,
      discardedCount: 0,
    };
  }

  // The rollback target. `working` is mutated freely; `original` never is.
  const original = snapshot(loaded);

  let flat: CommandInput[];
  try {
    flat = flatten(inputs);
  } catch (err) {
    return {
      success: false,
      valid: false,
      stage: "schema",
      message: err instanceof Error ? err.message : "Invalid command batch.",
      rolledBack: true,
      discardedCount: 0,
      dashboard: original,
    };
  }

  if (flat.length === 0) {
    return {
      success: false,
      valid: false,
      stage: "schema",
      message: "Command batch is empty — provide at least one command.",
      rolledBack: true,
      discardedCount: 0,
      dashboard: original,
    };
  }

  const reject = (
    stage: ExecutionStage,
    message: string,
    index: number,
    commandType: string,
    extra: Partial<Pick<BatchFailure, "suggestions" | "fieldErrors">> = {}
  ): BatchFailure => ({
    success: false,
    valid: false,
    stage,
    message,
    commandIndex: index,
    commandType,
    rolledBack: true,
    // Everything applied to the working copy so far is thrown away unwritten.
    discardedCount: index,
    dashboard: original,
    ...extra,
  });

  let working = loaded;
  const applied: Command[] = [];
  const baseSequence = loaded.commandLogLength;

  for (let i = 0; i < flat.length; i++) {
    const input = flat[i]!;

    // ── Stages 1–3: schema, semantic, scope ──
    const validation = validateCommandFull(
      { type: input.type, payload: input.payload, schemaVersion: input.schemaVersion },
      { dashboardState: working, datasetSchema, datasetSchemasById, knownDatasetIds }
    );

    if (!validation.valid) {
      return reject(validation.stage, validation.message, i, input.type, {
        ...(validation.suggestions ? { suggestions: validation.suggestions } : {}),
        ...(validation.fieldErrors ? { fieldErrors: validation.fieldErrors } : {}),
      });
    }

    // ── Stage 4: execution against the in-memory working copy ──
    const payload = seedGeneratedIds(
      validation.type,
      (validation.payload ?? {}) as Record<string, unknown>
    );

    const command: Command = {
      id: randomUUID(),
      dashboardId,
      type: validation.type,
      payload: payload as never,
      origin: input.origin ?? defaultOrigin,
      ...(input.prompt !== undefined ? { prompt: input.prompt } : {}),
      timestamp: new Date().toISOString(),
      sequenceNumber: baseSequence + i + 1,
      schemaVersion: COMMAND_SCHEMA_VERSION,
    };

    try {
      const nextDashboard = applyCommandToDashboard(working.dashboard, command);
      working = {
        ...working,
        dashboard: nextDashboard,
        version: nextDashboard.version,
        appliedCommandCount: working.appliedCommandCount + 1,
      };
    } catch (err) {
      return reject(
        "execution",
        err instanceof Error ? err.message : "Command execution failed.",
        i,
        input.type
      );
    }

    applied.push(command);
  }

  // ── Commit: single atomic write of the final state + the whole command log ──
  const committed: DashboardState = {
    ...working,
    commandLogLength: baseSequence + applied.length,
    revertedCommandCount: 0,
  };

  try {
    await store.commit(dashboardId, original, committed, applied);
  } catch (err) {
    // The store guarantees its write was atomic, so the database still holds the
    // pre-batch state. Hand the snapshot back so the caller can restore its cache.
    return {
      success: false,
      valid: false,
      stage: "persistence",
      message: err instanceof Error ? err.message : "Failed to persist command batch.",
      rolledBack: true,
      discardedCount: applied.length,
      dashboard: original,
    };
  }

  return {
    success: true,
    dashboard: committed,
    applied,
    executedCount: applied.length,
  };
}

export type { CommandScope };
