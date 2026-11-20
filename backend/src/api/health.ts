import { Router, type Request, type Response } from "express";
import type { HealthResponse } from "@ai-vis/types";

const router = Router();

/**
 * GET /api/health
 * Health check endpoint responding 200 OK
 */
router.get("/health", (_req: Request, res: Response<HealthResponse>) => {
  res.status(200).json({
    status: "ok",
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    version: "0.1.0",
  });
});

export default router;

