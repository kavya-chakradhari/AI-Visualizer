import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import apiRouter from "./api/index.js";
import {
  authMiddleware,
  errorHandler,
  notFoundHandler,
  requestIdMiddleware,
} from "./middleware/index.js";
import { logger } from "./utils/index.js";

dotenv.config();

export const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 4000;

// Global process exception handlers to prevent unhandled crashes
process.on("uncaughtException", (error: Error) => {
  logger.error("Uncaught Exception caught safely:", error.message);
});

process.on("unhandledRejection", (reason: unknown) => {
  logger.error("Unhandled Promise Rejection caught safely:", reason);
});

// Middleware
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || "http://localhost:5173",
    credentials: true,
  })
);
app.use(express.json());
app.use(requestIdMiddleware);
app.use(authMiddleware);

// Routes
app.use("/api", apiRouter);

// 404 Catch-all
app.use(notFoundHandler);

// Global Error Handler (must be last)
app.use(errorHandler);

if (process.env.NODE_ENV !== "test") {
  app.listen(PORT, () => {
    logger.info(`Server running on http://localhost:${PORT}`);
    logger.info(`Health check available at http://localhost:${PORT}/api/health`);
  });
}

export default app;
