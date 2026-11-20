import { Router, Request, Response, NextFunction } from "express";
import fs from "fs";
import path from "path";
import multer from "multer";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import {
  uploadMiddleware,
  concurrentUploadLimiter,
  validateFileSignature,
  sanitizeFileName,
  parseCsvStream,
  parseExcelStream,
  profileDataset,
  saveDatasetRowsToFile,
  deleteDatasetRowsFile,
  persistDatasetMetadata,
  readDatasetRowsFromFile,
  rowsToCsv,
  executeApiRequest,
  testApiConnection,
  executeDatabaseQuery,
  testDatabaseConnection,
  syncDataset,
} from "../data/index.js";
import { AppError } from "../middleware/error-handler.js";
import { zParams, zQuery, IdParamSchema, limitQuerySchema } from "../middleware/validation.js";
import { uploadRateLimiter } from "../middleware/rateLimit.js";
import prisma from "../db/client.js";
import type {
  ApiResponse,
  DatasetUploadResponse,
  Dataset,
  ColumnProfile,
  ApiSourceConfig,
  DatabaseSourceConfig,
} from "@ai-vis/types";

const datasetsRouter = Router();

const RowsQuerySchema = limitQuerySchema(1000, 50).extend({
  page: z.coerce.number().int().min(1).optional().default(1),
});

const ApiIngestSchema = z.object({
  name: z.string().min(1, "Dataset name is required"),
  description: z.string().optional(),
  config: z.object({
    url: z.string().url("Must be a valid HTTP or HTTPS URL"),
    method: z.enum(["GET", "POST"]).optional().default("GET"),
    headers: z.record(z.string(), z.string()).optional(),
    body: z.string().optional(),
    dataPath: z.string().optional(),
    refreshIntervalSeconds: z.number().int().nonnegative().optional().default(0),
  }),
});

const DatabaseIngestSchema = z.object({
  name: z.string().min(1, "Dataset name is required"),
  description: z.string().optional(),
  config: z.object({
    type: z.enum(["postgres", "mysql", "sqlite", "bigquery"]),
    connectionString: z.string().optional(),
    host: z.string().optional(),
    port: z.number().int().optional(),
    database: z.string().optional(),
    user: z.string().optional(),
    password: z.string().optional(),
    ssl: z.boolean().optional(),
    projectId: z.string().optional(),
    credentialsJson: z.string().optional(),
    query: z.string().min(1, "SQL query is required"),
    refreshIntervalSeconds: z.number().int().nonnegative().optional().default(0),
  }),
});

function formatDatasetRecord(record: {
  id: string;
  name: string;
  description: string | null;
  rowCount: number;
  columnCount: number;
  schemaJson: string;
  sampleRowsJson: string;
  storagePath: string | null;
  sourceFileName: string | null;
  sourceFileType: string | null;
  fileSizeBytes: number | null;
  sourceType: string | null;
  sourceConfigJson: string | null;
  lastSyncedAt: Date | null;
  refreshIntervalSeconds: number | null;
  createdAt: Date;
  updatedAt: Date;
  createdById: string | null;
}): Dataset {
  return {
    id: record.id,
    name: record.name,
    description: record.description ?? undefined,
    rowCount: record.rowCount,
    columnCount: record.columnCount,
    schema: JSON.parse(record.schemaJson),
    sampleRows: JSON.parse(record.sampleRowsJson),
    storagePath: record.storagePath ?? undefined,
    sourceFileName: record.sourceFileName ?? undefined,
    sourceFileType: record.sourceFileType ?? undefined,
    sourceType: (record.sourceType as Dataset["sourceType"]) ?? "file",
    sourceConfig: record.sourceConfigJson ? JSON.parse(record.sourceConfigJson) : undefined,
    lastSyncedAt: record.lastSyncedAt ? record.lastSyncedAt.toISOString() : undefined,
    refreshIntervalSeconds: record.refreshIntervalSeconds ?? 0,
    fileSizeBytes: record.fileSizeBytes ?? undefined,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    createdById: record.createdById ?? undefined,
  };
}

/**
 * Custom multer wrapper to capture multer errors and format them with specific human-readable messages.
 */
function handleMulterUpload(req: Request, res: Response, next: NextFunction): void {
  uploadMiddleware.single("file")(req, res, (err: unknown) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") {
          return next(
            new AppError(
              400,
              "FILE_TOO_LARGE",
              "The uploaded file exceeds the 25MB file size limit. Please upload a file smaller than 25MB."
            )
          );
        }
        if (err.code === "LIMIT_UNEXPECTED_FILE") {
          return next(
            new AppError(
              400,
              "UNEXPECTED_FIELD",
              "Unexpected field name for file upload. Use the form-data field name 'file'."
            )
          );
        }
        return next(
          new AppError(400, "UPLOAD_ERROR", `File upload error: ${err.message}`)
        );
      }
      if (err instanceof AppError) {
        return next(err);
      }
      return next(new AppError(400, "UPLOAD_FAILED", "Failed to upload file."));
    }
    next();
  });
}

/**
 * POST /api/datasets/upload
 * Ingests, validates, parses, profiles, and persists a dataset (.csv or .xlsx).
 */
datasetsRouter.post(
  "/upload",
  uploadRateLimiter,
  concurrentUploadLimiter,
  handleMulterUpload,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const file = req.file;

    if (!file) {
      return next(
        new AppError(
          400,
          "NO_FILE_UPLOADED",
          "No file was provided in the upload request. Please select a .csv or .xlsx file."
        )
      );
    }

    const tempFilePath = file.path;
    const originalExt = path.extname(file.originalname).toLowerCase();
    const sanitizedOriginalName = sanitizeFileName(file.originalname);
    const datasetName =
      (req.body.name as string)?.trim() ||
      path.parse(sanitizedOriginalName).name.replace(/[_-]/g, " ") ||
      "Untitled Dataset";

    try {
      // 1. Verify actual file signature / magic bytes (detect extension spoofing & empty files)
      const sigValidation = await validateFileSignature(tempFilePath, originalExt);
      if (!sigValidation.valid) {
        throw new AppError(
          400,
          "INVALID_FILE_CONTENT",
          sigValidation.reason ||
            "The file contents do not match the expected format for this file type."
        );
      }

      // 2. Stream parse dataset based on extension
      let parsedResult;
      if (originalExt === ".csv") {
        parsedResult = await parseCsvStream(tempFilePath, 50);
      } else if (originalExt === ".xlsx") {
        parsedResult = await parseExcelStream(tempFilePath, 50);
      } else {
        throw new AppError(
          400,
          "UNSUPPORTED_EXTENSION",
          `File format '${originalExt}' is not supported. Please upload a .csv or .xlsx file.`
        );
      }

      const { headers, totalRows, sampleRows, allRows } = parsedResult;

      // 3. Run pure deterministic statistical data profiler
      const schemaProfiles = profileDataset(headers, allRows, totalRows);

      // 4. Save full parsed dataset to file storage (never raw rows in SQLite)
      const datasetId = uuidv4();
      const storageFilePath = await saveDatasetRowsToFile(datasetId, allRows);

      // 5. Persist metadata + first 50 sample rows into SQLite via Prisma
      const dataset = await persistDatasetMetadata({
        id: datasetId,
        name: datasetName,
        description: (req.body.description as string)?.trim() || undefined,
        rowCount: totalRows,
        columnCount: headers.length,
        schema: schemaProfiles,
        sampleRows,
        storagePath: storageFilePath,
        sourceFileName: sanitizedOriginalName,
        sourceFileType: originalExt.replace(".", "").toUpperCase(),
        fileSizeBytes: file.size,
        createdById: req.user?.id || undefined,
      });

      const responsePayload: ApiResponse<DatasetUploadResponse> = {
        data: {
          dataset,
          sampleRows,
        },
      };

      res.status(201).json(responsePayload);
    } catch (err: unknown) {
      next(err);
    } finally {
      // Always remove the uploaded temporary file from tmp/uploads
      if (fs.existsSync(tempFilePath)) {
        await fs.promises.unlink(tempFilePath).catch((unlinkErr) => {
          console.error("Failed to remove temporary upload file:", unlinkErr);
        });
      }
    }
  }
);

/**
 * POST /api/datasets/api/test
 * Tests a REST API endpoint connection, parses rows, and returns a schema preview without saving.
 */
datasetsRouter.post(
  "/api/test",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const config = req.body as ApiSourceConfig;
      if (!config.url) {
        throw new AppError(400, "INVALID_URL", "API URL is required.");
      }
      const testResult = await testApiConnection(config);
      res.json({ data: testResult });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/datasets/api
 * Ingests data from a live REST API endpoint, profiles columns, and creates a live dataset.
 */
datasetsRouter.post(
  "/api",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = ApiIngestSchema.safeParse(req.body);
      if (!parsed.success) {
        const errorMsg = parsed.error.issues.map((i) => i.message).join("; ");
        throw new AppError(400, "VALIDATION_FAILED", errorMsg);
      }

      const { name, description, config } = parsed.data;

      // 1. Fetch from live API
      const { rows, headers, totalRows } = await executeApiRequest(config);

      // 2. Profile columns
      const schemaProfiles = profileDataset(headers, rows, totalRows);

      // 3. Save rows to file storage
      const datasetId = uuidv4();
      const storageFilePath = await saveDatasetRowsToFile(datasetId, rows);

      // 4. Persist metadata into SQLite
      const dataset = await persistDatasetMetadata({
        id: datasetId,
        name: name.trim(),
        description: description?.trim() || undefined,
        rowCount: totalRows,
        columnCount: headers.length,
        schema: schemaProfiles,
        sampleRows: rows.slice(0, 50),
        storagePath: storageFilePath,
        sourceFileName: config.url,
        sourceFileType: "API",
        sourceType: "api",
        sourceConfigJson: JSON.stringify(config),
        lastSyncedAt: new Date(),
        refreshIntervalSeconds: config.refreshIntervalSeconds || 0,
        createdById: req.user?.id || undefined,
      });

      const responsePayload: ApiResponse<DatasetUploadResponse> = {
        data: {
          dataset,
          sampleRows: rows.slice(0, 50),
        },
      };

      res.status(201).json(responsePayload);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/datasets/database/test
 * Tests database / BigQuery connectivity and previews query execution without saving.
 */
datasetsRouter.post(
  "/database/test",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const config = req.body as DatabaseSourceConfig;
      if (!config.type) {
        throw new AppError(400, "INVALID_DB_TYPE", "Database type is required.");
      }
      if (!config.query) {
        throw new AppError(400, "QUERY_REQUIRED", "SQL query is required.");
      }
      const testResult = await testDatabaseConnection(config);
      res.json({ data: testResult });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/datasets/database
 * Connects to a SQL database or BigQuery, runs query, profiles columns, and creates a live dataset.
 */
datasetsRouter.post(
  "/database",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = DatabaseIngestSchema.safeParse(req.body);
      if (!parsed.success) {
        const errorMsg = parsed.error.issues.map((i) => i.message).join("; ");
        throw new AppError(400, "VALIDATION_FAILED", errorMsg);
      }

      const { name, description, config } = parsed.data;

      // 1. Query database
      const { rows, headers, totalRows } = await executeDatabaseQuery(config as DatabaseSourceConfig);

      // 2. Profile columns
      const schemaProfiles = profileDataset(headers, rows, totalRows);

      // 3. Save rows to file storage
      const datasetId = uuidv4();
      const storageFilePath = await saveDatasetRowsToFile(datasetId, rows);

      // 4. Persist metadata into SQLite
      const dataset = await persistDatasetMetadata({
        id: datasetId,
        name: name.trim(),
        description: description?.trim() || undefined,
        rowCount: totalRows,
        columnCount: headers.length,
        schema: schemaProfiles,
        sampleRows: rows.slice(0, 50),
        storagePath: storageFilePath,
        sourceFileName: `${config.type.toUpperCase()}: ${config.database || config.projectId || "Database"}`,
        sourceFileType: config.type.toUpperCase(),
        sourceType: config.type === "bigquery" ? "bigquery" : "database",
        sourceConfigJson: JSON.stringify(config),
        lastSyncedAt: new Date(),
        refreshIntervalSeconds: config.refreshIntervalSeconds || 0,
        createdById: req.user?.id || undefined,
      });

      const responsePayload: ApiResponse<DatasetUploadResponse> = {
        data: {
          dataset,
          sampleRows: rows.slice(0, 50),
        },
      };

      res.status(201).json(responsePayload);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/datasets/:id/sync
 * Re-fetches the latest live data from its source (API or DB) and updates the dataset.
 */
datasetsRouter.post(
  "/:id/sync",
  zParams(IdParamSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = req.params.id as string;
      const syncResult = await syncDataset(id);
      res.json({ data: syncResult });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/datasets
 * Returns list of uploaded datasets metadata (without heavy row data).
 */
datasetsRouter.get(
  "/",
  async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const records = await prisma.dataset.findMany({
        orderBy: { createdAt: "desc" },
        take: 20,
      });

      const datasets: Dataset[] = records.map(formatDatasetRecord);

      const response: ApiResponse<Dataset[]> = {
        data: datasets,
      };

      res.json(response);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/datasets/:id
 * Fetches dataset metadata and sample rows.
 */
datasetsRouter.get(
  "/:id",
  zParams(IdParamSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = req.params.id as string;
      const record = await prisma.dataset.findUnique({ where: { id } });

      if (!record) {
        throw new AppError(
          404,
          "DATASET_NOT_FOUND",
          `Dataset with ID '${id}' was not found.`
        );
      }

      const dataset: Dataset = formatDatasetRecord(record);

      const response: ApiResponse<Dataset> = {
        data: dataset,
      };

      res.json(response);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/datasets/:id/rows
 * Reads rows from file-based storage with pagination support.
 */
datasetsRouter.get(
  "/:id/rows",
  zParams(IdParamSchema),
  zQuery(RowsQuerySchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = req.params.id as string;
      const { limit, page } = req.query as unknown as { limit: number; page: number };

      const record = await prisma.dataset.findUnique({ where: { id } });
      if (!record) {
        throw new AppError(
          404,
          "DATASET_NOT_FOUND",
          `Dataset with ID '${id}' was not found.`
        );
      }

      const allRows = await readDatasetRowsFromFile(id);
      const startIndex = (page - 1) * limit;
      const paginatedRows = allRows.slice(startIndex, startIndex + limit);

      const response: ApiResponse<{
        rows: Record<string, unknown>[];
        totalRows: number;
        page: number;
        limit: number;
      }> = {
        data: {
          rows: paginatedRows,
          totalRows: allRows.length,
          page,
          limit,
        },
      };

      res.json(response);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/datasets/:id/export/csv
 * Re-download of the full parsed dataset as CSV — the MVP's "raw dataset"
 * export. Regenerated from the on-disk parsed-rows JSON (the original
 * uploaded file is deleted right after parsing; see upload.ts), so this
 * works identically whether the source was a .csv or an .xlsx.
 */
datasetsRouter.get(
  "/:id/export/csv",
  zParams(IdParamSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = req.params.id as string;
      const record = await prisma.dataset.findUnique({ where: { id } });

      if (!record) {
        throw new AppError(404, "DATASET_NOT_FOUND", `Dataset with ID '${id}' was not found.`);
      }

      const headers = (JSON.parse(record.schemaJson) as ColumnProfile[]).map((c) => c.name);
      const rows = await readDatasetRowsFromFile(id);
      const csv = rowsToCsv(headers, rows);
      const filename = sanitizeFileName(`${record.name || "dataset"}.csv`);

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(csv);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * DELETE /api/datasets/:id
 * Removes both the SQLite metadata row and the on-disk parsed-rows file.
 * Any dashboard referencing this dataset keeps working — its `datasetId`
 * is set to null by the FK's `onDelete: SetNull` (see prisma/schema.prisma)
 * rather than the dashboard itself being deleted or blocked.
 *
 * Order matters for "no orphaned files": the on-disk file is removed FIRST.
 * If that fails, the DB row is left in place (a retry is safe — file
 * deletion is idempotent) rather than risking a DB row deleted with its file
 * left behind. If the file removal succeeds but the DB delete then fails,
 * the result is a dangling metadata row pointing at an already-gone file —
 * `readDatasetRowsFromFile` already treats a missing file as "no rows"
 * rather than crashing, so this is a safe (if inconsistent) failure mode,
 * never an orphaned file.
 */
datasetsRouter.delete(
  "/:id",
  zParams(IdParamSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = req.params.id as string;
      const record = await prisma.dataset.findUnique({ where: { id } });

      if (!record) {
        throw new AppError(404, "DATASET_NOT_FOUND", `Dataset with ID '${id}' was not found.`);
      }

      await deleteDatasetRowsFile(id);
      await prisma.dataset.delete({ where: { id } });

      res.status(204).send();
    } catch (err) {
      next(err);
    }
  }
);

export default datasetsRouter;
