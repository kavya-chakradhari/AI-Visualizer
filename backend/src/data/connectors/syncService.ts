import prisma from "../../db/client.js";
import { executeApiRequest } from "./apiConnector.js";
import { executeDatabaseQuery } from "./databaseConnector.js";
import { profileDataset } from "../profiler.js";
import { saveDatasetRowsToFile } from "../storage.js";
import type { Dataset, DatasetSyncResponse, ApiSourceConfig, DatabaseSourceConfig } from "@ai-vis/types";

/**
 * Re-fetches the latest data from an API or Database source, updates disk storage,
 * re-profiles columns, and updates metadata in SQLite.
 */
export async function syncDataset(datasetId: string): Promise<DatasetSyncResponse> {
  const record = await prisma.dataset.findUnique({
    where: { id: datasetId },
  });

  if (!record) {
    throw new Error(`Dataset with ID '${datasetId}' was not found.`);
  }

  const sourceType = record.sourceType || "file";
  if (sourceType === "file") {
    throw new Error("Static file datasets (CSV/XLSX) cannot be re-synced. Only live API or Database sources support syncing.");
  }

  if (!record.sourceConfigJson) {
    throw new Error(`No source configuration found for dataset '${datasetId}'.`);
  }

  let rows: Record<string, unknown>[] = [];
  let headers: string[] = [];
  let totalRows = 0;

  if (sourceType === "api") {
    const config = JSON.parse(record.sourceConfigJson) as ApiSourceConfig;
    const result = await executeApiRequest(config);
    rows = result.rows;
    headers = result.headers;
    totalRows = result.totalRows;
  } else if (sourceType === "database" || sourceType === "bigquery") {
    const config = JSON.parse(record.sourceConfigJson) as DatabaseSourceConfig;
    const result = await executeDatabaseQuery(config);
    rows = result.rows;
    headers = result.headers;
    totalRows = result.totalRows;
  } else {
    throw new Error(`Unsupported source type: '${sourceType}'`);
  }

  // 1. Run statistical data profiler on the new rows
  const schema = profileDataset(headers, rows, totalRows);

  // 2. Persist full new row set to file storage
  await saveDatasetRowsToFile(datasetId, rows);

  // 3. Update dataset record in SQLite
  const now = new Date();
  const updatedRecord = await prisma.dataset.update({
    where: { id: datasetId },
    data: {
      rowCount: totalRows,
      columnCount: headers.length,
      schemaJson: JSON.stringify(schema),
      sampleRowsJson: JSON.stringify(rows.slice(0, 50)),
      lastSyncedAt: now,
    },
  });

  const dataset: Dataset = {
    id: updatedRecord.id,
    name: updatedRecord.name,
    description: updatedRecord.description ?? undefined,
    rowCount: updatedRecord.rowCount,
    columnCount: updatedRecord.columnCount,
    schema: JSON.parse(updatedRecord.schemaJson),
    sampleRows: JSON.parse(updatedRecord.sampleRowsJson),
    storagePath: updatedRecord.storagePath ?? undefined,
    sourceFileName: updatedRecord.sourceFileName ?? undefined,
    sourceFileType: updatedRecord.sourceFileType ?? undefined,
    sourceType: (updatedRecord.sourceType as Dataset["sourceType"]) ?? "file",
    sourceConfig: updatedRecord.sourceConfigJson ? JSON.parse(updatedRecord.sourceConfigJson) : undefined,
    lastSyncedAt: updatedRecord.lastSyncedAt ? updatedRecord.lastSyncedAt.toISOString() : undefined,
    refreshIntervalSeconds: updatedRecord.refreshIntervalSeconds ?? 0,
    fileSizeBytes: updatedRecord.fileSizeBytes ?? undefined,
    createdAt: updatedRecord.createdAt.toISOString(),
    updatedAt: updatedRecord.updatedAt.toISOString(),
    createdById: updatedRecord.createdById ?? undefined,
  };

  return {
    dataset,
    sampleRows: rows.slice(0, 50),
    refreshedAt: now.toISOString(),
    rowsCount: totalRows,
  };
}
