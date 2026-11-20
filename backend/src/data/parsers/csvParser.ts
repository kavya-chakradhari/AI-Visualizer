import fs from "fs";
import { parse as csvParse } from "csv-parse";
import { AppError } from "../../middleware/error-handler.js";

export interface ParsedDatasetResult {
  headers: string[];
  totalRows: number;
  sampleRows: Record<string, unknown>[];
  allRows: Record<string, unknown>[];
}

/**
 * Hard cap on data rows kept in memory for a single dataset, shared by both
 * the CSV and Excel parsers. This is independent of the .xlsx
 * decompression-size guard (see excelParser.ts) — it bounds *our own*
 * row-array/profiling cost for any format, including a CSV, which has no
 * "decompressed size" of its own to check.
 */
export const MAX_DATASET_ROWS = process.env.MAX_DATASET_ROWS
  ? parseInt(process.env.MAX_DATASET_ROWS, 10)
  : 200_000;

/**
 * Stream parses a CSV file with robust error detection:
 * - Empty file
 * - Duplicate column headers
 * - Empty column headers
 * - Malformed CSV rows
 * - Mismatched columns
 */
export async function parseCsvStream(
  filePath: string,
  maxSampleRows = 50
): Promise<ParsedDatasetResult> {
  return new Promise((resolve, reject) => {
    const readStream = fs.createReadStream(filePath, { encoding: "utf-8" });

    let headers: string[] = [];
    let isHeaderProcessed = false;
    let totalRows = 0;
    let aborted = false;
    const sampleRows: Record<string, unknown>[] = [];
    const allRows: Record<string, unknown>[] = [];

    const parser = csvParse({
      bom: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: false, // Strict column count matching
    });

    readStream.on("error", (err: Error) => {
      reject(new AppError(400, "FILE_READ_ERROR", `Failed to read CSV file: ${err.message}`));
    });

    parser.on("error", (err: { code?: string; message: string; line?: number }) => {
      if (err.code === "CSV_RECORD_DONT_MATCH_COLUMNS_LENGTH") {
        reject(
          new AppError(
            400,
            "CSV_COLUMN_MISMATCH",
            `Mismatched columns detected: ${err.message}. Ensure every row has the same number of columns as the header.`
          )
        );
        return;
      }
      if (err.code === "CSV_INVALID_CLOSING_QUOTE" || err.code === "CSV_QUOTE_NOT_CLOSED") {
        reject(
          new AppError(
            400,
            "CSV_MALFORMED_QUOTES",
            `Malformed CSV quotation syntax on line ${err.line ?? "unknown"}: ${err.message}`
          )
        );
        return;
      }
      reject(
        new AppError(
          400,
          "MALFORMED_CSV",
          `Malformed CSV file: ${err.message}`
        )
      );
    });

    parser.on("data", (row: string[]) => {
      if (aborted) return;

      if (!isHeaderProcessed) {
        if (!row || row.length === 0) {
          reject(
            new AppError(
              400,
              "EMPTY_HEADER",
              "The uploaded CSV has no header columns."
            )
          );
          return;
        }

        // Validate headers
        const seen = new Set<string>();
        for (let i = 0; i < row.length; i++) {
          const colName = (row[i] || "").trim();
          if (!colName) {
            reject(
              new AppError(
                400,
                "EMPTY_COLUMN_HEADER",
                `Column header at index ${i + 1} is empty or whitespace.`
              )
            );
            return;
          }
          if (seen.has(colName)) {
            reject(
              new AppError(
                400,
                "DUPLICATE_COLUMN_NAME",
                `Duplicate column name detected: '${colName}'. Each column header must be unique.`
              )
            );
            return;
          }
          seen.add(colName);
        }

        headers = row.map((h) => h.trim());
        isHeaderProcessed = true;
        return;
      }

      // Process data row
      totalRows++;

      if (totalRows > MAX_DATASET_ROWS) {
        aborted = true;
        readStream.destroy();
        reject(
          new AppError(
            400,
            "TOO_MANY_ROWS",
            `This CSV has more than ${MAX_DATASET_ROWS.toLocaleString()} data rows, which exceeds what this app will parse. Please upload a smaller file.`
          )
        );
        return;
      }

      const rowObject: Record<string, unknown> = {};

      for (let i = 0; i < headers.length; i++) {
        const header = headers[i];
        if (header) {
          const rawVal = row[i];
          // Keep null if undefined or empty string
          if (rawVal === undefined || rawVal === "" || rawVal === null) {
            rowObject[header] = null;
          } else {
            rowObject[header] = rawVal;
          }
        }
      }

      if (sampleRows.length < maxSampleRows) {
        sampleRows.push(rowObject);
      }

      allRows.push(rowObject);
    });

    parser.on("end", () => {
      if (!isHeaderProcessed) {
        reject(
          new AppError(
            400,
            "EMPTY_FILE",
            "The CSV file is empty. Please upload a file containing header columns and data rows."
          )
        );
        return;
      }

      if (totalRows === 0) {
        reject(
          new AppError(
            400,
            "NO_DATA_ROWS",
            "The CSV file contains header columns but no data rows."
          )
        );
        return;
      }

      resolve({
        headers,
        totalRows,
        sampleRows,
        allRows,
      });
    });

    readStream.pipe(parser);
  });
}
