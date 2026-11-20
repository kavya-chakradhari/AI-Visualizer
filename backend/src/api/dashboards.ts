import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { dashboardEngine } from "../state/index.js";
import { AppError } from "../middleware/error-handler.js";
import { zParams, zQuery, zBody, IdSchema, IdParamSchema, limitQuerySchema } from "../middleware/validation.js";
import { CommandEnvelopeSchema, CommandOriginSchema } from "../commands/schemas.js";
import prisma from "../db/client.js";
import type {
  ApiResponse,
  CommandActionType,
  CommandHistoryEntry,
  CommandBatchDiff,
  DashboardState,
} from "@ai-vis/types";

const dashboardsRouter = Router();

// ─────────────────────────────────────────────
// Request schemas
// ─────────────────────────────────────────────

const CreateDashboardBodySchema = z
  .object({
    title: z.string().trim().min(1, "title is required").max(200, "title is too long"),
    datasetId: IdSchema.optional(),
  })
  .strict();

/**
 * The PATCH body must carry an `origin` (not merely accept one) — unlike
 * `CommandEnvelopeSchema`'s wire-optional `origin`, this endpoint distinguishes
 * manual vs. AI-driven commands and needs the caller to say which.
 */
const PatchCommandBodySchema = CommandEnvelopeSchema.extend({
  origin: CommandOriginSchema,
});

const HistoryDetailParamsSchema = z
  .object({ id: IdSchema, batchId: IdSchema })
  .passthrough();

// ─────────────────────────────────────────────
// POST /api/dashboards — Create new dashboard
// ─────────────────────────────────────────────

dashboardsRouter.post(
  "/",
  zBody(CreateDashboardBodySchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { title, datasetId } = req.body as z.infer<typeof CreateDashboardBodySchema>;
      const createdById = req.user?.id;

      const state = await dashboardEngine.createDashboard(title, createdById, datasetId);

      const response: ApiResponse<DashboardState> = { data: state };
      res.status(201).json(response);
    } catch (err) {
      next(err);
    }
  }
);

// ─────────────────────────────────────────────
// GET /api/dashboards — List dashboards (metadata only)
// ─────────────────────────────────────────────

dashboardsRouter.get(
  "/",
  async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const records = await prisma.dashboard.findMany({
        orderBy: { updatedAt: "desc" },
        take: 20,
        select: {
          id: true,
          title: true,
          description: true,
          version: true,
          datasetId: true,
          createdById: true,
          createdAt: true,
          updatedAt: true,
          _count: { select: { pages: true } },
        },
      });

      const dashboards = records.map((r) => ({
        id: r.id,
        title: r.title,
        description: r.description ?? undefined,
        version: r.version,
        datasetId: r.datasetId ?? undefined,
        createdById: r.createdById ?? undefined,
        pageCount: r._count.pages,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      }));

      const response: ApiResponse<typeof dashboards> = { data: dashboards };
      res.json(response);
    } catch (err) {
      next(err);
    }
  }
);

// ─────────────────────────────────────────────
// GET /api/dashboards/:id — Full dashboard state
// ─────────────────────────────────────────────

dashboardsRouter.get(
  "/:id",
  zParams(IdParamSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = req.params.id as string;
      const state = await dashboardEngine.loadState(id);

      if (!state) {
        throw new AppError(
          404,
          "DASHBOARD_NOT_FOUND",
          `Dashboard '${id}' was not found.`
        );
      }

      const response: ApiResponse<DashboardState> = { data: state };
      res.json(response);
    } catch (err) {
      next(err);
    }
  }
);

// ─────────────────────────────────────────────
// PATCH /api/dashboards/:id — Apply a Command
//
// CRITICAL CONSTRAINT: This endpoint accepts ONLY a Command body.
// It does NOT accept raw field patches.
// Both manual user edits and AI-driven commands MUST use this endpoint.
// They are identical from the server's perspective — only `origin` differs.
// ─────────────────────────────────────────────

dashboardsRouter.patch(
  "/:id",
  zParams(IdParamSchema),
  zBody(PatchCommandBodySchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const dashboardId = req.params.id as string;
      const { type, payload, origin, prompt } = req.body as z.infer<
        typeof PatchCommandBodySchema
      >;

      const commandInput = {
        // The real command-type check (is this one of the known types?) is
        // stage-1 schema validation inside applyAndPersist, not here — this
        // cast just satisfies the narrower type it expects on the way in.
        type: type as CommandActionType,
        payload: (payload ?? {}) as Record<string, unknown>,
        origin,
        prompt,
      };

      const result = await dashboardEngine.applyAndPersist(
        dashboardId,
        commandInput,
        req.user?.id,
        req.id
      );

      if (!result.success) {
        throw new AppError(
          400,
          result.errorCode ?? "COMMAND_FAILED",
          result.errorMessage ?? "Command execution failed."
        );
      }

      const response: ApiResponse<{
        state: DashboardState;
        commandId: string;
      }> = {
        data: {
          state: result.dashboard,
          commandId: result.commandId,
        },
      };
      res.json(response);
    } catch (err) {
      next(err);
    }
  }
);

// ─────────────────────────────────────────────
// POST /api/dashboards/:id/undo
// ─────────────────────────────────────────────

dashboardsRouter.post(
  "/:id/undo",
  zParams(IdParamSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const dashboardId = req.params.id as string;
      const result = await dashboardEngine.undo(dashboardId, req.user?.id);

      if (!result.success) {
        throw new AppError(
          400,
          result.errorCode ?? "UNDO_FAILED",
          result.errorMessage ?? "Undo failed."
        );
      }

      const response: ApiResponse<DashboardState> = { data: result.dashboard };
      res.json(response);
    } catch (err) {
      next(err);
    }
  }
);

// ─────────────────────────────────────────────
// POST /api/dashboards/:id/redo
// ─────────────────────────────────────────────

dashboardsRouter.post(
  "/:id/redo",
  zParams(IdParamSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const dashboardId = req.params.id as string;
      const result = await dashboardEngine.redo(dashboardId, req.user?.id);

      if (!result.success) {
        throw new AppError(
          400,
          result.errorCode ?? "REDO_FAILED",
          result.errorMessage ?? "Redo failed."
        );
      }

      const response: ApiResponse<DashboardState> = { data: result.dashboard };
      res.json(response);
    } catch (err) {
      next(err);
    }
  }
);

// ─────────────────────────────────────────────
// GET /api/dashboards/:id/commands — Command log
// ─────────────────────────────────────────────

dashboardsRouter.get(
  "/:id/commands",
  zParams(IdParamSchema),
  zQuery(limitQuerySchema(500, 50)),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const dashboardId = req.params.id as string;
      const { limit } = req.query as unknown as { limit: number };
      const log = await dashboardEngine.getCommandLog(dashboardId, limit);

      const response: ApiResponse<typeof log> = { data: log };
      res.json(response);
    } catch (err) {
      next(err);
    }
  }
);

// ─────────────────────────────────────────────
// GET /api/dashboards/:id/history — Command History (batch-level undo/redo timeline)
// ─────────────────────────────────────────────

dashboardsRouter.get(
  "/:id/history",
  zParams(IdParamSchema),
  zQuery(limitQuerySchema(500, 50)),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const dashboardId = req.params.id as string;
      const { limit } = req.query as unknown as { limit: number };
      const history = await dashboardEngine.getCommandHistory(dashboardId, limit);

      const response: ApiResponse<CommandHistoryEntry[]> = { data: history };
      res.json(response);
    } catch (err) {
      next(err);
    }
  }
);

// ─────────────────────────────────────────────
// GET /api/dashboards/:id/history/:batchId — "What changed" detail for one entry
// ─────────────────────────────────────────────

dashboardsRouter.get(
  "/:id/history/:batchId",
  zParams(HistoryDetailParamsSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const dashboardId = req.params.id as string;
      const batchId = req.params.batchId as string;
      const diff = await dashboardEngine.getBatchDiff(dashboardId, batchId);

      if (!diff) {
        throw new AppError(404, "HISTORY_ENTRY_NOT_FOUND", `No history entry '${batchId}' found.`);
      }

      const response: ApiResponse<CommandBatchDiff> = { data: diff };
      res.json(response);
    } catch (err) {
      next(err);
    }
  }
);

export default dashboardsRouter;
