/**
 * AI conversation endpoints.
 *
 *   POST /api/dashboards/:id/ai/message — natural language -> commands -> execution
 *   POST /api/dashboards/:id/ai/confirm — execute a previously-proposed batch
 *                                          the user has explicitly approved
 *
 * Both endpoints ultimately call dashboardEngine.executeBatch — the identical
 * schema -> semantic -> scope -> transaction pipeline manual UI commands use.
 * This layer never applies a command directly, and never returns or logs any
 * API key (it never sees one; that lives only in the provider's env-read).
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { processAIMessage, confirmAICommands } from "../ai/index.js";
import { aiRateLimiter } from "../middleware/rateLimit.js";
import { zParams, IdParamSchema } from "../middleware/validation.js";

const aiRouter = Router();

const HistoryTurnSchema = z
  .object({ role: z.enum(["user", "assistant"]), content: z.string() })
  .strict();

const MessageRequestSchema = z
  .object({
    message: z.string().min(1, "message is required"),
    selectedVisualId: z.string().optional(),
    history: z.array(HistoryTurnSchema).optional(),
  })
  .strict();

const ConfirmCommandSchema = z
  .object({ type: z.string().min(1), payload: z.unknown() })
  .passthrough();

const ConfirmRequestSchema = z
  .object({
    commands: z.array(ConfirmCommandSchema).min(1, "commands must not be empty"),
    prompt: z.string().optional(),
  })
  .strict();

function statusForStage(stage: string): number {
  switch (stage) {
    case "not_found":
      return 404;
    case "provider_error":
    case "ai_protocol":
      return 502;
    case "persistence":
      return 500;
    default:
      return 400;
  }
}

aiRouter.post(
  "/dashboards/:id/ai/message",
  aiRateLimiter,
  zParams(IdParamSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    const parsed = MessageRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        stage: "schema",
        message: "Invalid request body.",
        fieldErrors: Object.fromEntries(
          parsed.error.issues.map((i) => [i.path.map(String).join(".") || "_root", [i.message]])
        ),
      });
      return;
    }

    try {
      const dashboardId = req.params.id as string;
      const result = await processAIMessage(dashboardId, parsed.data.message, {
        selectedVisualId: parsed.data.selectedVisualId,
        history: parsed.data.history,
        userId: req.user?.id,
        requestId: req.id,
      });

      if (!result.success) {
        res.status(statusForStage(result.stage)).json(result);
        return;
      }
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
);

aiRouter.post(
  "/dashboards/:id/ai/confirm",
  aiRateLimiter,
  zParams(IdParamSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    const parsed = ConfirmRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, stage: "schema", message: "Invalid request body." });
      return;
    }

    try {
      const dashboardId = req.params.id as string;
      const result = await confirmAICommands(
        dashboardId,
        parsed.data.commands,
        parsed.data.prompt,
        req.user?.id,
        req.id
      );

      if (!result.success) {
        res.status(statusForStage(result.stage)).json(result);
        return;
      }
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
);

export default aiRouter;
