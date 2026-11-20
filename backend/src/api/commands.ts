/**
 * Command debug API — DEV ONLY.
 *
 * ⚠️  These routes execute arbitrary commands against any dashboard with no
 *     authorization check beyond the stub auth middleware. They exist so the
 *     validation engine can be exercised with raw JSON before the AI layer is
 *     wired up. `devOnly` below refuses to serve them outside development;
 *     delete this router or put it behind real authorization before production.
 *
 *   POST /api/commands/execute   — validate + execute (atomic, all-or-nothing)
 *   POST /api/commands/validate  — dry run: validate only, never mutates
 *   GET  /api/commands/schema    — introspect the command contract
 *
 * Request body (both POST routes):
 *   { dashboardId, command: {...} }            single command
 *   { dashboardId, commands: [{...}, ...] }    batch — succeeds or fails as a unit
 *
 * Failure response:
 *   { success: false, stage, message, suggestions?, fieldErrors?, commandIndex? }
 *   where stage ∈ schema | semantic | scope | execution | persistence
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { dashboardEngine } from "../state/index.js";
import { validateCommandFull } from "../commands/validator.js";
import {
  CommandEnvelopeSchema,
  PAYLOAD_SCHEMAS,
  COMMAND_SCOPES,
  COMMAND_SCHEMA_VERSION,
  KNOWN_COMMAND_TYPES,
} from "../commands/schemas.js";
import { applyCommandToDashboard } from "../commands/index.js";
import { logger } from "../utils/index.js";
import type { Command, CommandInput, ColumnProfile, DashboardState } from "@ai-vis/types";
import { COMMAND_TYPE_ALIASES } from "@ai-vis/types";
import prisma from "../db/client.js";

const commandsRouter = Router();

// ─────────────────────────────────────────────
// Dev-only gate
// ─────────────────────────────────────────────

/**
 * Refuses the request unless the server is running in development or test.
 * Set `ENABLE_COMMAND_DEBUG_API=true` to opt in explicitly elsewhere (e.g. a
 * staging box) — never set it in production.
 */
function devOnly(_req: Request, res: Response, next: NextFunction): void {
  const env = process.env.NODE_ENV ?? "development";
  const enabled =
    env === "development" ||
    env === "test" ||
    process.env.ENABLE_COMMAND_DEBUG_API === "true";

  if (!enabled) {
    res.status(404).json({
      success: false,
      error: "NOT_FOUND",
      message: "Not found.",
    });
    return;
  }
  next();
}

commandsRouter.use(devOnly);

// ─────────────────────────────────────────────
// Request schema
// ─────────────────────────────────────────────

const ExecuteRequestSchema = z
  .object({
    dashboardId: z.string().min(1, "dashboardId is required"),
    command: CommandEnvelopeSchema.optional(),
    commands: z.array(CommandEnvelopeSchema).optional(),
  })
  .strict()
  .refine((d) => d.command !== undefined || (d.commands?.length ?? 0) > 0, {
    message: "Provide either 'command' (single) or a non-empty 'commands' array.",
  });

/** Flatten Zod issues into the same `fieldErrors` shape the validator emits. */
function toFieldErrors(error: z.ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const path = issue.path.map(String).join(".") || "_root";
    (out[path] ??= []).push(issue.message);
  }
  return out;
}

/**
 * Parse the request envelope. Returns the command list, or writes a
 * schema-stage error response and returns null.
 */
function parseRequest(
  req: Request,
  res: Response
): { dashboardId: string; commands: CommandInput[] } | null {
  const parsed = ExecuteRequestSchema.safeParse(req.body);

  if (!parsed.success) {
    const fieldErrors = toFieldErrors(parsed.error);
    res.status(400).json({
      success: false,
      valid: false,
      stage: "schema",
      message: `Request body is malformed: ${parsed.error.issues
        .map((i) => `${i.path.map(String).join(".") || "_root"}: ${i.message}`)
        .join("; ")}`,
      fieldErrors,
    });
    return null;
  }

  const { dashboardId, command, commands } = parsed.data;
  return {
    dashboardId,
    commands: (command ? [command] : (commands ?? [])) as CommandInput[],
  };
}

// ─────────────────────────────────────────────
// POST /execute — atomic execution
// ─────────────────────────────────────────────

commandsRouter.post(
  "/execute",
  async (req: Request, res: Response, next: NextFunction) => {
    const parsed = parseRequest(req, res);
    if (!parsed) return;

    const { dashboardId, commands } = parsed;

    try {
      const result = await dashboardEngine.executeBatch(
        dashboardId,
        commands,
        req.user?.id,
        req.id
      );

      if (!result.success) {
        const status = result.stage === "persistence" ? 500 : 400;
        logger.warn(
          `[commands/execute] Rejected batch of ${commands.length} at stage '${result.stage}': ${result.message}`
        );
        res.status(status).json({
          success: false,
          valid: false,
          stage: result.stage,
          message: result.message,
          ...(result.suggestions ? { suggestions: result.suggestions } : {}),
          ...(result.fieldErrors ? { fieldErrors: result.fieldErrors } : {}),
          ...(result.commandIndex !== undefined
            ? { commandIndex: result.commandIndex, commandType: result.commandType }
            : {}),
          rolledBack: result.rolledBack,
          discardedCount: result.discardedCount,
        });
        return;
      }

      res.json({
        success: true,
        dashboard: result.dashboard,
        executedCount: result.executedCount,
        commandIds: result.applied.map((c) => c.id),
      });
    } catch (err: unknown) {
      next(err);
    }
  }
);

// ─────────────────────────────────────────────
// POST /validate — dry run, never mutates
// ─────────────────────────────────────────────

commandsRouter.post(
  "/validate",
  async (req: Request, res: Response, next: NextFunction) => {
    const parsed = parseRequest(req, res);
    if (!parsed) return;

    const { dashboardId, commands } = parsed;

    try {
      const state = await dashboardEngine.loadState(dashboardId);
      if (!state) {
        res.status(404).json({
          valid: false,
          stage: "semantic",
          message: `Dashboard '${dashboardId}' not found.`,
        });
        return;
      }

      let datasetSchema: ColumnProfile[] | undefined;
      const datasetId = state.dashboard.datasetId;
      if (datasetId) {
        const ds = await prisma.dataset.findUnique({
          where: { id: datasetId },
          select: { schemaJson: true },
        });
        if (ds?.schemaJson) {
          try {
            datasetSchema = JSON.parse(ds.schemaJson) as ColumnProfile[];
          } catch {
            logger.warn(`[commands/validate] Dataset '${datasetId}' has bad schemaJson.`);
          }
        }
      }

      const results: unknown[] = [];
      // Validate each command against the state the previous ones would produce,
      // so a batch that builds on itself validates the way it will execute.
      let working: DashboardState = state;

      for (let i = 0; i < commands.length; i++) {
        const input = commands[i]!;
        const outcome = validateCommandFull(input, {
          dashboardState: working,
          datasetSchema,
        });

        results.push({ commandIndex: i, commandType: input.type, ...outcome });
        if (!outcome.valid) break;

        try {
          const nextDashboard = applyCommandToDashboard(working.dashboard, {
            id: `dryrun_${i}`,
            dashboardId,
            type: outcome.type,
            payload: outcome.payload as never,
            origin: input.origin ?? "user",
            timestamp: new Date().toISOString(),
            sequenceNumber: working.commandLogLength + i + 1,
          } satisfies Command);
          working = { ...working, dashboard: nextDashboard, version: nextDashboard.version };
        } catch (err) {
          results.push({
            commandIndex: i,
            commandType: input.type,
            valid: false,
            stage: "execution",
            message: err instanceof Error ? err.message : "Execution failed.",
          });
          break;
        }
      }

      const allValid =
        results.length === commands.length &&
        results.every((r) => (r as { valid?: boolean }).valid === true);

      res.json({
        valid: allValid,
        results,
        validatedCount: results.length,
        totalCommands: commands.length,
      });
    } catch (err: unknown) {
      next(err);
    }
  }
);

// ─────────────────────────────────────────────
// GET /schema — contract introspection
// ─────────────────────────────────────────────

/**
 * Describes the command contract: every type, its scope, and its accepted
 * aliases. Useful when hand-writing debug payloads, and it will be the basis of
 * the tool definition handed to the AI planner later.
 */
commandsRouter.get("/schema", (_req: Request, res: Response) => {
  const aliasesByType: Record<string, string[]> = {};
  for (const [alias, canonical] of Object.entries(COMMAND_TYPE_ALIASES)) {
    (aliasesByType[canonical] ??= []).push(alias);
  }

  res.json({
    schemaVersion: COMMAND_SCHEMA_VERSION,
    commands: KNOWN_COMMAND_TYPES.map((type) => ({
      type,
      scope: COMMAND_SCOPES[type],
      aliases: aliasesByType[type] ?? [],
      payload: z.toJSONSchema(PAYLOAD_SCHEMAS[type], { io: "input", unrepresentable: "any" }),
    })),
  });
});

export default commandsRouter;
