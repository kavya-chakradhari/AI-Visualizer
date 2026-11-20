import ExcelJS from "exceljs";
import unzipper from "unzipper";
import { AppError } from "../../middleware/error-handler.js";
import type { ParsedDatasetResult } from "./csvParser.js";
import { MAX_DATASET_ROWS } from "./csvParser.js";

/**
 * Cap on total decompressed bytes across an .xlsx's ZIP entries — this is the
 * zip-bomb guard. An .xlsx is a ZIP archive of XML parts; a small compressed
 * file can claim to decompress to gigabytes. `unzipper`'s central-directory
 * reader exposes each entry's `uncompressedSize` WITHOUT decompressing
 * anything, so this check runs before `ExcelJS.Workbook.xlsx.readFile()` —
 * which decompresses and loads the whole workbook into memory — ever touches
 * the file.
 */
const MAX_XLSX_DECOMPRESSED_BYTES = process.env.MAX_XLSX_DECOMPRESSED_BYTES
  ? parseInt(process.env.MAX_XLSX_DECOMPRESSED_BYTES, 10)
  : 200 * 1024 * 1024; // 200 MB — generous for any legitimate dataset this app targets.

async function assertSafeDecompressedSize(filePath: string): Promise<void> {
  const directory = await unzipper.Open.file(filePath);
  let totalUncompressed = 0;
  for (const entry of directory.files) {
    totalUncompressed += entry.uncompressedSize;
    if (totalUncompressed > MAX_XLSX_DECOMPRESSED_BYTES) {
      throw new AppError(
        400,
        "XLSX_DECOMPRESSED_TOO_LARGE",
        `This spreadsheet would decompress to more than ${Math.round(
          MAX_XLSX_DECOMPRESSED_BYTES / (1024 * 1024)
        )}MB, which exceeds what this app will parse. Please upload a smaller file.`
      );
    }
  }
}

/**
 * Stream parses an Excel (.xlsx) file using ExcelJS.
 */
export async function parseExcelStream(
  filePath: string,
  maxSampleRows = 50
): Promise<ParsedDatasetResult> {
  await assertSafeDecompressedSize(filePath);

  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.readFile(filePath);
  } catch (err: unknown) {
    if (err instanceof AppError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    throw new AppError(400, "EXCEL_PARSE_ERROR", `Failed to read Excel workbook: ${msg}`);
  }

  const worksheet = workbook.worksheets[0];
  if (!worksheet || worksheet.rowCount === 0) {
    throw new AppError(
      400,
      "EMPTY_EXCEL_SHEET",
      "The Excel file contains no worksheets or the first sheet is empty."
    );
  }

  let headers: string[] = [];
  const sampleRows: Record<string, unknown>[] = [];
  const allRows: Record<string, unknown>[] = [];
  let totalRows = 0;

  worksheet.eachRow((row, rowNumber) => {
    // ExcelJS row.values is 1-indexed (index 0 is undefined)
    const rawValues = Array.isArray(row.values) ? row.values.slice(1) : [];

    if (rowNumber === 1) {
      if (rawValues.length === 0) {
        throw new AppError(
          400,
          "EMPTY_EXCEL_HEADER",
          "The first row of the Excel sheet contains no header values."
        );
      }

      const seen = new Set<string>();
      headers = rawValues.map((val, idx) => {
        const text = val !== null && val !== undefined ? String(val).trim() : "";
        if (!text) {
          throw new AppError(
            400,
            "EMPTY_COLUMN_HEADER",
            `Column header at index ${idx + 1} is empty or whitespace.`
          );
        }
        if (seen.has(text)) {
          throw new AppError(
            400,
            "DUPLICATE_COLUMN_NAME",
            `Duplicate column name detected in Excel file: '${text}'. Each column header must be unique.`
          );
        }
        seen.add(text);
        return text;
      });
      return;
    }

    // Data row
    totalRows++;

    if (totalRows > MAX_DATASET_ROWS) {
      throw new AppError(
        400,
        "TOO_MANY_ROWS",
        `This spreadsheet has more than ${MAX_DATASET_ROWS.toLocaleString()} data rows, which exceeds what this app will parse. Please upload a smaller file.`
      );
    }

    const rowObject: Record<string, unknown> = {};

    for (let i = 0; i < headers.length; i++) {
      const header = headers[i];
      if (header) {
        let cellVal: unknown = rawValues[i];

        // Format Date objects to ISO strings
        if (cellVal instanceof Date) {
          cellVal = cellVal.toISOString();
        } else if (cellVal && typeof cellVal === "object" && "result" in cellVal) {
          // Excel formula cell
          cellVal = (cellVal as { result: unknown }).result;
        }

        if (cellVal === undefined || cellVal === "" || cellVal === null) {
          rowObject[header] = null;
        } else {
          rowObject[header] = cellVal;
        }
      }
    }

    if (sampleRows.length < maxSampleRows) {
      sampleRows.push(rowObject);
    }
    allRows.push(rowObject);
  });

  if (headers.length === 0) {
    throw new AppError(
      400,
      "EMPTY_EXCEL_HEADER",
      "No valid header row found in the Excel spreadsheet."
    );
  }

  if (totalRows === 0) {
    throw new AppError(
      400,
      "NO_DATA_ROWS",
      "The Excel worksheet contains a header row but no data rows."
    );
  }

  return {
    headers,
    totalRows,
    sampleRows,
    allRows,
  };
}
