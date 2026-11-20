import fs from "fs";
import path from "path";
import prisma from "../db/client.js";
import type { Dataset, ColumnProfile } from "@ai-vis/types";

export const STORAGE_DATASETS_DIR = path.resolve(process.cwd(), "data", "storage", "datasets");

if (!fs.existsSync(STORAGE_DATASETS_DIR)) {
  fs.mkdirSync(STORAGE_DATASETS_DIR, { recursive: true });
}

/**
 * Stores the full raw/parsed dataset in a local file-based JSON store outside the database.
 * Never stores raw dataset rows directly in SQLite.
 */
export async function saveDatasetRowsToFile(
  datasetId: string,
  rows: Record<string, unknown>[]
): Promise<string> {
  const filePath = path.join(STORAGE_DATASETS_DIR, `${datasetId}.json`);
  await fs.promises.writeFile(filePath, JSON.stringify(rows), "utf-8");
  return filePath;
}

/**
 * Reads dataset rows from the local file-based store.
 */
export async function readDatasetRowsFromFile(
  datasetId: string,
  limit?: number
): Promise<Record<string, unknown>[]> {
  const filePath = path.join(STORAGE_DATASETS_DIR, `${datasetId}.json`);
  if (!fs.existsSync(filePath)) {
    return [];
  }
  const raw = await fs.promises.readFile(filePath, "utf-8");
  const data = JSON.parse(raw) as Record<string, unknown>[];
  return limit ? data.slice(0, limit) : data;
}

/**
 * Removes the on-disk parsed-rows file for a dataset. A no-op (not an error)
 * if the file is already gone — deletion must be idempotent so a retry after
 * a partial failure never throws on "already deleted".
 */
export async function deleteDatasetRowsFile(datasetId: string): Promise<void> {
  const filePath = path.join(STORAGE_DATASETS_DIR, `${datasetId}.json`);
  try {
    await fs.promises.unlink(filePath);
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      throw err;
    }
  }
}

/**
 * Persists the dataset metadata and first 50 sample rows into SQLite via Prisma.
 */
export async function persistDatasetMetadata(params: {
  id?: string;
  name: string;
  description?: string;
  rowCount: number;
  columnCount: number;
  schema: ColumnProfile[];
  sampleRows: Record<string, unknown>[];
  storagePath: string;
  sourceFileName?: string;
  sourceFileType?: string;
  fileSizeBytes?: number;
  createdById?: string;
  sourceType?: string;
  sourceConfigJson?: string;
  lastSyncedAt?: Date;
  refreshIntervalSeconds?: number;
}): Promise<Dataset> {
  let validUserId: string | undefined = undefined;
  if (params.createdById) {
    try {
      const user = await prisma.user.upsert({
        where: { id: params.createdById },
        update: {},
        create: {
          id: params.createdById,
          email: `${params.createdById}@example.com`,
          name: "User",
        },
      });
      validUserId = user.id;
    } catch {
      validUserId = undefined;
    }
  }

  const record = await prisma.dataset.create({
    data: {
      ...(params.id && { id: params.id }),
      name: params.name,
      description: params.description,
      rowCount: params.rowCount,
      columnCount: params.columnCount,
      schemaJson: JSON.stringify(params.schema),
      sampleRowsJson: JSON.stringify(params.sampleRows.slice(0, 50)),
      storagePath: params.storagePath,
      sourceFileName: params.sourceFileName,
      sourceFileType: params.sourceFileType,
      fileSizeBytes: params.fileSizeBytes,
      sourceType: params.sourceType ?? "file",
      sourceConfigJson: params.sourceConfigJson,
      lastSyncedAt: params.lastSyncedAt,
      refreshIntervalSeconds: params.refreshIntervalSeconds ?? 0,
      createdById: validUserId,
    },
  });

  return {
    id: record.id,
    name: record.name,
    description: record.description ?? undefined,
    rowCount: record.rowCount,
    columnCount: record.columnCount,
    schema: JSON.parse(record.schemaJson) as ColumnProfile[],
    sampleRows: JSON.parse(record.sampleRowsJson) as Record<string, unknown>[],
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
