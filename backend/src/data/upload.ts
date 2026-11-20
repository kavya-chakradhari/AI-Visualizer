import multer from "multer";
import path from "path";
import fs from "fs";
import { v4 as uuidv4 } from "uuid";
import type { Request, Response, NextFunction } from "express";
import { AppError } from "../middleware/error-handler.js";

const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB

// Store uploads in a temporary directory outside version control
export const UPLOAD_TEMP_DIR = path.resolve(process.cwd(), "tmp", "uploads");

if (!fs.existsSync(UPLOAD_TEMP_DIR)) {
  fs.mkdirSync(UPLOAD_TEMP_DIR, { recursive: true });
}

export function sanitizeFileName(originalName: string): string {
  // Strip any directory traversal and retain alphanumeric, dash, underscore, dot
  const base = path.basename(originalName);
  return base.replace(/[^a-zA-Z0-9._-]/g, "_");
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, UPLOAD_TEMP_DIR);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const safeExt = ext === ".csv" || ext === ".xlsx" ? ext : ".tmp";
    const uniqueName = `${uuidv4()}${safeExt}`;
    cb(null, uniqueName);
  },
});

const fileFilter: multer.Options["fileFilter"] = (_req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  const allowedExtensions = [".csv", ".xlsx"];
  const allowedMimeTypes = [
    "text/csv",
    "text/plain",
    "application/csv",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/zip",
    "application/octet-stream",
  ];

  if (!allowedExtensions.includes(ext)) {
    return cb(
      new AppError(
        400,
        "INVALID_FILE_EXTENSION",
        `Invalid file extension '${ext}'. Only .csv and .xlsx files are accepted.`
      )
    );
  }

  if (file.mimetype && !allowedMimeTypes.includes(file.mimetype)) {
    return cb(
      new AppError(
        400,
        "INVALID_MIME_TYPE",
        `Unsupported MIME type '${file.mimetype}'. Only .csv and .xlsx files are accepted.`
      )
    );
  }

  cb(null, true);
};

export const uploadMiddleware = multer({
  storage,
  limits: {
    fileSize: MAX_FILE_SIZE_BYTES,
    files: 1,
  },
  fileFilter,
});

// ─────────────────────────────────────────────
// Concurrent upload limiting
// ─────────────────────────────────────────────

const MAX_CONCURRENT_UPLOADS = process.env.MAX_CONCURRENT_UPLOADS
  ? parseInt(process.env.MAX_CONCURRENT_UPLOADS, 10)
  : 3;

let activeUploads = 0;

/**
 * Bounds how many uploads are parsed/profiled at once. This is a different
 * axis from the per-IP `uploadRateLimiter`: that stops one client hammering
 * the endpoint over time; this stops several *different* clients' uploads
 * all landing on the single Node event loop at the same moment — parsing an
 * .xlsx/.csv is synchronous CPU work that would otherwise stall every other
 * request while it runs. In-memory counter — fine for a single process (see
 * the README's scaling notes for the same caveat as rate limiting).
 */
export function concurrentUploadLimiter(_req: Request, res: Response, next: NextFunction): void {
  if (activeUploads >= MAX_CONCURRENT_UPLOADS) {
    next(
      new AppError(
        503,
        "TOO_MANY_CONCURRENT_UPLOADS",
        "The server is already processing the maximum number of concurrent uploads. Please try again shortly."
      )
    );
    return;
  }

  activeUploads++;
  let released = false;
  const release = (): void => {
    if (released) return;
    released = true;
    activeUploads = Math.max(0, activeUploads - 1);
  };
  res.once("finish", release);
  res.once("close", release);
  next();
}

/**
 * Validate actual file signature (magic bytes) to prevent extension spoofing.
 */
export async function validateFileSignature(
  filePath: string,
  extension: string
): Promise<{ valid: boolean; reason?: string }> {
  const buffer = Buffer.alloc(16);
  const fd = await fs.promises.open(filePath, "r");
  try {
    const { bytesRead } = await fd.read(buffer, 0, 16, 0);
    if (bytesRead === 0) {
      return { valid: false, reason: "The uploaded file is empty (0 bytes)." };
    }

    if (extension === ".xlsx") {
      // XLSX must start with ZIP signature: 50 4B 03 04 (PK\x03\x04)
      const isZip =
        buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04;
      if (!isZip) {
        return {
          valid: false,
          reason:
            "Invalid file signature for .xlsx spreadsheet. File does not match Excel OpenXML format.",
        };
      }
      return { valid: true };
    }

    if (extension === ".csv") {
      // CSV must NOT be binary or executable
      // Check for common binary signatures
      const isElf = buffer[0] === 0x7f && buffer[1] === 0x45 && buffer[2] === 0x4c && buffer[3] === 0x46;
      const isMzExe = buffer[0] === 0x4d && buffer[1] === 0x5a; // MZ
      const isZip = buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04;
      const isPdf = buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46;

      if (isElf || isMzExe || isZip || isPdf) {
        return {
          valid: false,
          reason:
            "File signature mismatch: File appears to be a binary archive or executable, not a valid plain-text CSV.",
        };
      }

      // Check for null bytes (indicates binary)
      for (let i = 0; i < bytesRead; i++) {
        if (buffer[i] === 0x00) {
          return {
            valid: false,
            reason:
              "Binary characters detected in CSV header. File must be plain UTF-8/ASCII text.",
          };
        }
      }

      return { valid: true };
    }

    return { valid: false, reason: `Unsupported extension: ${extension}` };
  } finally {
    await fd.close();
  }
}
