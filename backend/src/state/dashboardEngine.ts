import { v4 as uuidv4 } from "uuid";
import { Prisma } from "@prisma/client";
import prisma from "../db/client.js";
import { createEmptyDashboardState } from "../commands/index.js";
import {
  executeCommandBatch,
  type BatchOutcome,
  type CommandBatchStore,
  type ExecutionStage,
} from "../commands/transaction.js";
import { summarizeCommands } from "../commands/summary.js";
import { computeBatchDiff } from "../commands/diff.js";
import { logger, logStructured } from "../utils/index.js";
import type {
  Command,
  CommandActionType,
  CommandInput,
  CommandResult,
  CommandAuditLog,
  CommandHistoryEntry,
  CommandBatchDiff,
  CommandSource,
  CommandBatchStatus,
  DashboardState,
  Dashboard,
  Page,
  Visual,
  ColumnProfile,
} from "@ai-vis/types";

// ─────────────────────────────────────────────
// Prisma helpers: serialize/deserialize Dashboard
// ─────────────────────────────────────────────

export function serializeDashboard(state: DashboardState): string {
  return JSON.stringify(state);
}

export function deserializeDashboard(json: string): DashboardState {
  const state = JSON.parse(json) as DashboardState;
  // Backward compatibility: dashboards persisted before multi-dataset support
  // have no `datasetIds` in their stored snapshot.
  if (!state.dashboard.datasetIds) {
    state.dashboard.datasetIds = state.dashboard.datasetId ? [state.dashboard.datasetId] : [];
  }
  return state;
}

// ─────────────────────────────────────────────
// Build a Command record from DB row
// ─────────────────────────────────────────────

interface DbCommand {
  id: string;
  dashboardId: string;
  action: string;
  origin: string;
  prompt: string | null;
  payloadJson: string;
  status: string;
  sequenceNumber: number;
  createdAt: Date;
}

function dbRowToCommand(row: DbCommand): Command {
  return {
    id: row.id,
    dashboardId: row.dashboardId,
    type: row.action as CommandActionType,
    payload: JSON.parse(row.payloadJson),
    origin: row.origin as Command["origin"],
    prompt: row.prompt ?? undefined,
    timestamp: row.createdAt.toISOString(),
    sequenceNumber: row.sequenceNumber,
  };
}

/** Failure stage → the error code surfaced to callers of `applyAndPersist`. */
const STAGE_ERROR_CODES: Record<ExecutionStage, string> = {
  schema: "SCHEMA_VALIDATION_FAILED",
  semantic: "SEMANTIC_VALIDATION_FAILED",
  scope: "SCOPE_VALIDATION_FAILED",
  execution: "COMMAND_EXECUTION_FAILED",
  persistence: "PERSIST_FAILED",
};

// ─────────────────────────────────────────────
// DashboardEngine
// ─────────────────────────────────────────────

class DashboardEngine {
  /** In-memory LRU-style cache of latest DashboardState per dashboardId */
  private cache = new Map<string, DashboardState>();

  // ── Load ──────────────────────────────────────

  async loadState(dashboardId: string): Promise<DashboardState | null> {
    // 1. Check in-memory cache
    const cached = this.cache.get(dashboardId);
    if (cached) return cached;

    // 2. Load from SQLite
    const record = await prisma.dashboard.findUnique({
      where: { id: dashboardId },
      include: { pages: true },
    });

    if (!record) return null;

    // 3. Reconstruct DashboardState from DB record
    let state: DashboardState;

    // If we have a stateJson snapshot, use it directly
    const stateJson = (record as unknown as { stateJson?: string | null }).stateJson;
    if (stateJson) {
      state = deserializeDashboard(stateJson);
    } else {
      // Reconstruct from relational page rows (legacy fallback)
      const pages: Page[] = record.pages.map((p) => ({
        id: p.id,
        dashboardId: p.dashboardId,
        title: p.title,
        order: p.order,
        layoutConfig: JSON.parse(p.layoutConfigJson) as Page["layoutConfig"],
        visuals: JSON.parse(p.visualsJson) as Visual[],
        createdAt: p.createdAt.toISOString(),
        updatedAt: p.updatedAt.toISOString(),
      }));

      const dashboard: Dashboard = {
        id: record.id,
        title: record.title,
        description: record.description ?? undefined,
        datasetId: record.datasetId ?? undefined,
        datasetIds: record.datasetId ? [record.datasetId] : [],
        pages: pages.sort((a, b) => a.order - b.order),
        activePageId: pages[0]?.id,
        version: record.version,
        createdById: record.createdById ?? undefined,
        createdAt: record.createdAt.toISOString(),
        updatedAt: record.updatedAt.toISOString(),
      };

      // Count applied / reverted commands
      const [appliedCount, revertedCount, totalCount] = await Promise.all([
        prisma.command.count({
          where: { dashboardId, status: "applied" },
        }),
        prisma.command.count({
          where: { dashboardId, status: "reverted" },
        }),
        prisma.command.count({ where: { dashboardId } }),
      ]);

      state = {
        dashboard,
        commandLogLength: totalCount,
        appliedCommandCount: appliedCount,
        revertedCommandCount: revertedCount,
        version: record.version,
      };
    }

    this.cache.set(dashboardId, state);
    return state;
  }

  // ── Apply & Persist ────────────────────────────

  /**
   * Apply a single command. Delegates to the same atomic batch pipeline the AI
   * and debug endpoints use, so manual UI actions and AI actions are validated
   * and persisted by exactly one code path.
   */
  async applyAndPersist(
    dashboardId: string,
    command: Omit<Command, "id" | "dashboardId" | "timestamp" | "sequenceNumber">,
    userId?: string,
    requestId?: string
  ): Promise<CommandResult> {
    const result = await this.executeBatch(
      dashboardId,
      [
        {
          type: command.type,
          payload: command.payload,
          origin: command.origin,
          ...(command.prompt !== undefined ? { prompt: command.prompt } : {}),
        },
      ],
      userId,
      requestId
    );

    if (result.success) {
      return {
        success: true,
        dashboard: result.dashboard,
        commandId: result.applied[0]?.id ?? "",
      };
    }

    return {
      success: false,
      dashboard: result.dashboard ?? createEmptyDashboardState(dashboardId),
      commandId: "",
      errorCode: STAGE_ERROR_CODES[result.stage],
      errorMessage: result.message,
    };
  }

  // ── Undo ──────────────────────────────────────

  /**
   * Reverts the most recent applied batch — a single manual edit, or an
   * entire multi-command AI turn, as one atomic step either way. Restores
   * directly from that batch's stored `previousStateJson`; nothing is replayed.
   */
  async undo(dashboardId: string, _userId?: string): Promise<CommandResult> {
    const state = await this.loadState(dashboardId);
    if (!state) {
      return {
        success: false,
        dashboard: createEmptyDashboardState(dashboardId),
        commandId: "",
        errorCode: "DASHBOARD_NOT_FOUND",
        errorMessage: `Dashboard '${dashboardId}' not found.`,
      };
    }

    const lastApplied = await prisma.commandBatch.findFirst({
      where: { dashboardId, status: "applied" },
      orderBy: { sequenceNumber: "desc" },
    });

    if (!lastApplied) {
      // No-op: nothing has ever been applied, or everything has already been undone.
      return {
        success: false,
        dashboard: state,
        commandId: "",
        errorCode: "NOTHING_TO_UNDO",
        errorMessage: "No commands available to undo.",
      };
    }

    const restored = deserializeDashboard(lastApplied.previousStateJson);

    await prisma.$transaction(async (tx) => {
      await tx.commandBatch.update({
        where: { id: lastApplied.id },
        data: { status: "reverted" },
      });
      await tx.command.updateMany({
        where: { batchId: lastApplied.id },
        data: { status: "reverted" },
      });
      await this.persistSnapshot(tx, dashboardId, restored);
    });

    const finalState: DashboardState = {
      ...restored,
      ...(await this.computeCommandCounters(dashboardId)),
    };
    this.cache.set(dashboardId, finalState);

    return { success: true, dashboard: finalState, commandId: lastApplied.id };
  }

  // ── Redo ──────────────────────────────────────

  /**
   * Re-applies the most recently undone batch, restoring directly from its
   * stored `resultingStateJson`. Cleared entirely the moment any NEW batch is
   * committed (see `createBatchStore`'s commit) — the standard behavior:
   * undo, then do something new, and the old redo path is gone.
   */
  async redo(dashboardId: string, _userId?: string): Promise<CommandResult> {
    const state = await this.loadState(dashboardId);
    if (!state) {
      return {
        success: false,
        dashboard: createEmptyDashboardState(dashboardId),
        commandId: "",
        errorCode: "DASHBOARD_NOT_FOUND",
        errorMessage: `Dashboard '${dashboardId}' not found.`,
      };
    }

    // The reverted set is always a contiguous suffix of the sequence (undo/redo
    // only ever move the one boundary between "applied" and "reverted"), so the
    // lowest-numbered reverted batch is always the correct next thing to redo.
    const firstReverted = await prisma.commandBatch.findFirst({
      where: { dashboardId, status: "reverted" },
      orderBy: { sequenceNumber: "asc" },
    });

    if (!firstReverted) {
      return {
        success: false,
        dashboard: state,
        commandId: "",
        errorCode: "NOTHING_TO_REDO",
        errorMessage: "No commands available to redo.",
      };
    }

    const restored = deserializeDashboard(firstReverted.resultingStateJson);

    await prisma.$transaction(async (tx) => {
      await tx.commandBatch.update({
        where: { id: firstReverted.id },
        data: { status: "applied" },
      });
      await tx.command.updateMany({
        where: { batchId: firstReverted.id },
        data: { status: "applied" },
      });
      await this.persistSnapshot(tx, dashboardId, restored);
    });

    const finalState: DashboardState = {
      ...restored,
      ...(await this.computeCommandCounters(dashboardId)),
    };
    this.cache.set(dashboardId, finalState);

    return { success: true, dashboard: finalState, commandId: firstReverted.id };
  }

  // ── Shared persistence helper ──────────────────

  /** Writes a full DashboardState snapshot to the dashboard + page rows. Used by commit, undo, and redo alike. */
  private async persistSnapshot(
    tx: Prisma.TransactionClient,
    dashboardId: string,
    state: DashboardState
  ): Promise<void> {
    await tx.dashboard.update({
      where: { id: dashboardId },
      data: {
        title: state.dashboard.title,
        description: state.dashboard.description,
        datasetId: state.dashboard.datasetId,
        version: state.dashboard.version,
        updatedAt: new Date(state.dashboard.updatedAt),
      },
    });

    for (const page of state.dashboard.pages) {
      await tx.page.upsert({
        where: { id: page.id },
        create: {
          id: page.id,
          dashboardId,
          title: page.title,
          order: page.order,
          layoutConfigJson: JSON.stringify(page.layoutConfig),
          visualsJson: JSON.stringify(page.visuals),
        },
        update: {
          title: page.title,
          order: page.order,
          layoutConfigJson: JSON.stringify(page.layoutConfig),
          visualsJson: JSON.stringify(page.visuals),
          updatedAt: new Date(),
        },
      });
    }

    await tx.page.deleteMany({
      where: { dashboardId, id: { notIn: state.dashboard.pages.map((p) => p.id) } },
    });
  }

  /** Freshly counted, never trusted from a stale restored snapshot. */
  private async computeCommandCounters(dashboardId: string): Promise<{
    commandLogLength: number;
    appliedCommandCount: number;
    revertedCommandCount: number;
  }> {
    const [commandLogLength, appliedCommandCount, revertedCommandCount] = await Promise.all([
      prisma.command.count({ where: { dashboardId } }),
      prisma.command.count({ where: { dashboardId, status: "applied" } }),
      prisma.command.count({ where: { dashboardId, status: "reverted" } }),
    ]);
    return { commandLogLength, appliedCommandCount, revertedCommandCount };
  }

  // ── Command Log (raw, per-command audit trail) ─

  async getCommandLog(
    dashboardId: string,
    limit = 50
  ): Promise<CommandAuditLog[]> {
    const rows = await prisma.command.findMany({
      where: { dashboardId },
      orderBy: { sequenceNumber: "desc" },
      take: limit,
    });

    return rows.map((row) => ({
      id: row.id,
      dashboardId: row.dashboardId,
      commandId: row.id,
      action: row.action as CommandActionType,
      origin: row.origin as Command["origin"],
      prompt: row.prompt ?? undefined,
      status: row.status as CommandAuditLog["status"],
      payloadJson: row.payloadJson,
      errorMessage: row.errorMessage ?? undefined,
      executedAt: row.createdAt.toISOString(),
      userId: row.userId ?? undefined,
      sequenceNumber: row.sequenceNumber,
    }));
  }

  // ── Command History (batch-level, for the undo/redo timeline UI) ─

  /**
   * One row per atomic undo/redo unit, newest first. Permanently-discarded
   * batches (an abandoned redo branch) are excluded — they're no longer part
   * of any reachable timeline.
   */
  async getCommandHistory(dashboardId: string, limit = 50): Promise<CommandHistoryEntry[]> {
    const batches = await prisma.commandBatch.findMany({
      where: { dashboardId, status: { in: ["applied", "reverted"] } },
      orderBy: { sequenceNumber: "desc" },
      take: limit,
      include: { commands: { orderBy: { sequenceNumber: "asc" } } },
    });

    return batches.map((batch) => ({
      id: batch.id,
      sequenceNumber: batch.sequenceNumber,
      source: batch.source as CommandSource,
      status: batch.status as CommandBatchStatus,
      summary: batch.summary,
      createdAt: batch.createdAt.toISOString(),
      prompt: batch.commands.find((c) => c.prompt)?.prompt ?? undefined,
      commands: batch.commands.map((c) => ({
        id: c.id,
        type: c.action as CommandActionType,
        payload: JSON.parse(c.payloadJson) as unknown,
      })),
    }));
  }

  /** "What changed" detail for one history entry, computed on demand from its two stored snapshots. */
  async getBatchDiff(dashboardId: string, batchId: string): Promise<CommandBatchDiff | null> {
    const batch = await prisma.commandBatch.findFirst({
      where: { id: batchId, dashboardId },
      include: { commands: { orderBy: { sequenceNumber: "asc" } } },
    });
    if (!batch) return null;

    const previous = deserializeDashboard(batch.previousStateJson);
    const resulting = deserializeDashboard(batch.resultingStateJson);
    const commands = batch.commands.map((row) => dbRowToCommand(row));

    const { visualChanges, otherChanges } = computeBatchDiff(
      commands,
      previous.dashboard,
      resulting.dashboard
    );

    return { batchId: batch.id, summary: batch.summary, visualChanges, otherChanges };
  }

  // ── Create Dashboard ──────────────────────────

  async createDashboard(
    title: string,
    createdById?: string,
    datasetId?: string
  ): Promise<DashboardState> {
    const dashboardId = uuidv4();
    const state = createEmptyDashboardState(dashboardId, title, createdById);

    // Ensure user exists (upsert)
    if (createdById) {
      await prisma.user.upsert({
        where: { id: createdById },
        update: {},
        create: {
          id: createdById,
          email: `${createdById}@example.com`,
          name: "User",
        },
      });
    }

    const firstPage = state.dashboard.pages[0]!;

    await prisma.dashboard.create({
      data: {
        id: dashboardId,
        title,
        datasetId,
        version: 0,
        createdById,
        pages: {
          create: {
            id: firstPage.id,
            title: firstPage.title,
            order: 0,
            layoutConfigJson: JSON.stringify(firstPage.layoutConfig),
            visualsJson: JSON.stringify([]),
          },
        },
      },
    });

    const finalState: DashboardState = {
      ...state,
      dashboard: { ...state.dashboard, datasetId, datasetIds: datasetId ? [datasetId] : [] },
    };

    this.cache.set(dashboardId, finalState);
    return finalState;
  }

  /** Invalidate cache entry (call when needed to force reload) */
  invalidate(dashboardId: string): void {
    this.cache.delete(dashboardId);
  }

  // ── Atomic batch execution ────────────────────

  /**
   * A `CommandBatchStore` backed by Prisma. `commit` writes the resulting
   * dashboard state, the CommandBatch (the undo/redo unit) with both its
   * before/after snapshots, and its member Command rows, all inside one
   * `$transaction` — so either the whole batch lands or none of it does.
   */
  createBatchStore(userId?: string): CommandBatchStore {
    return {
      load: (dashboardId) => this.loadState(dashboardId),

      commit: async (dashboardId, previous, next, applied) => {
        await prisma.$transaction(async (tx) => {
          // Applying anything new permanently discards the redo path —
          // standard undo/redo behavior. These batches are no longer
          // reachable by either undo or redo.
          await tx.commandBatch.updateMany({
            where: { dashboardId, status: "reverted" },
            data: { status: "discarded" },
          });
          await tx.command.updateMany({
            where: { dashboardId, status: "reverted" },
            data: { status: "failed" },
          });

          const lastBatch = await tx.commandBatch.findFirst({
            where: { dashboardId },
            orderBy: { sequenceNumber: "desc" },
            select: { sequenceNumber: true },
          });
          const nextSequence = (lastBatch?.sequenceNumber ?? 0) + 1;

          const source: CommandSource = applied.some((c) => c.origin === "ai") ? "ai" : "manual";
          const summary = summarizeCommands(applied, previous.dashboard, next.dashboard);

          const batch = await tx.commandBatch.create({
            data: {
              dashboardId,
              source,
              status: "applied",
              sequenceNumber: nextSequence,
              summary,
              previousStateJson: serializeDashboard(previous),
              resultingStateJson: serializeDashboard(next),
            },
          });

          for (const command of applied) {
            await tx.command.create({
              data: {
                id: command.id,
                dashboardId,
                action: command.type,
                origin: command.origin,
                prompt: command.prompt,
                payloadJson: JSON.stringify(command.payload),
                status: "applied",
                sequenceNumber: command.sequenceNumber,
                userId,
                batchId: batch.id,
              },
            });
          }

          await this.persistSnapshot(tx, dashboardId, next);
        });

        // Only reached when the transaction committed.
        this.cache.set(dashboardId, next);
      },
    };
  }

  /**
   * Validate and execute a batch of commands atomically. On any failure the
   * dashboard is left exactly as it was, and the cache is re-synced from the
   * database so it cannot hold a state that was never persisted.
   *
   * This is the single choke point every command execution passes through —
   * manual UI edits (via `applyAndPersist`), AI-driven batches, and the debug
   * API alike — so it is the one place a structured log event is emitted per
   * execution, covering all three origins identically.
   */
  async executeBatch(
    dashboardId: string,
    commands: CommandInput[],
    userId?: string,
    requestId?: string
  ): Promise<BatchOutcome> {
    const startedAt = Date.now();
    const commandTypes = commands.map((c) => c.type).join(",");
    const origins = [...new Set(commands.map((c) => c.origin ?? "user"))].join(",");

    const state = await this.loadState(dashboardId);
    const { schema: datasetSchema, schemasByDatasetId, knownDatasetIds } = state
      ? await this.loadDatasetSchema(state, commands)
      : { schema: undefined, schemasByDatasetId: new Map<string, ColumnProfile[]>(), knownDatasetIds: new Set<string>() };

    const result = await executeCommandBatch(dashboardId, commands, {
      store: this.createBatchStore(userId),
      datasetSchema,
      datasetSchemasById: schemasByDatasetId,
      knownDatasetIds,
    });

    const durationMs = Date.now() - startedAt;

    if (!result.success) {
      // Drop any cache entry so the next read comes from the database of record.
      this.invalidate(dashboardId);
      logger.warn(
        `[DashboardEngine] Batch of ${commands.length} rejected at stage '${result.stage}': ${result.message}`
      );
      logStructured({
        event: "command.execute",
        success: false,
        requestId,
        userId,
        dashboardId,
        commandType: commandTypes,
        origin: origins,
        stage: result.stage,
        durationMs,
        message: result.message,
        commandCount: commands.length,
      });
    } else {
      logStructured({
        event: "command.execute",
        success: true,
        requestId,
        userId,
        dashboardId,
        commandType: commandTypes,
        origin: origins,
        durationMs,
        commandCount: commands.length,
        executedCount: result.executedCount,
      });
    }

    return result;
  }

  /**
   * Resolve the known-field list for semantic validation: the union of every
   * dataset already attached to the dashboard, plus any dataset id a command
   * in this batch names (e.g. a SET_DATASET/ATTACH_DATASET target, or a
   * CREATE_VISUAL targeting a dataset not yet attached) — so field checks
   * never spuriously reject a command that's still landing its own
   * attach/rebind in the same batch.
   */
  private async loadDatasetSchema(
    state: DashboardState,
    commands: CommandInput[]
  ): Promise<{
    schema: ColumnProfile[] | undefined;
    schemasByDatasetId: Map<string, ColumnProfile[]>;
    knownDatasetIds: Set<string>;
  }> {
    const idsFromCommands = commands
      .map((c) => (c.payload as { datasetId?: unknown } | undefined)?.datasetId)
      .filter((id): id is string => typeof id === "string" && id.length > 0);

    const datasetIds = Array.from(
      new Set([...(state.dashboard.datasetIds ?? []), ...idsFromCommands])
    );
    if (datasetIds.length === 0) {
      return { schema: undefined, schemasByDatasetId: new Map(), knownDatasetIds: new Set() };
    }

    const rows = await prisma.dataset.findMany({
      where: { id: { in: datasetIds } },
      select: { id: true, schemaJson: true },
    });

    const byName = new Map<string, ColumnProfile>();
    const schemasByDatasetId = new Map<string, ColumnProfile[]>();
    for (const row of rows) {
      if (!row.schemaJson) continue;
      try {
        const cols = JSON.parse(row.schemaJson) as ColumnProfile[];
        schemasByDatasetId.set(row.id, cols);
        for (const c of cols) byName.set(c.name.toLowerCase(), c);
      } catch {
        logger.warn(`[DashboardEngine] A dataset has unparseable schemaJson.`);
      }
    }
    return {
      schema: byName.size > 0 ? Array.from(byName.values()) : undefined,
      schemasByDatasetId,
      knownDatasetIds: new Set(rows.map((r) => r.id)),
    };
  }
}

// Singleton engine instance
export const dashboardEngine = new DashboardEngine();
export type { DashboardEngine };
