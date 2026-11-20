/**
 * Minimal CSV serialization for the dataset export feature — re-download of
 * the full, already-parsed dataset (not the original uploaded file, which is
 * deleted after parsing; see upload.ts's cleanup). No new dependency: this is
 * the inverse of `csv-parse`'s reading, but small enough (quote a field only
 * when it contains a comma, quote, or newline; double any embedded quotes)
 * that pulling in `csv-stringify` for it isn't worth the extra dependency.
 */

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function rowsToCsv(headers: string[], rows: Record<string, unknown>[]): string {
  const lines = [headers.map(csvEscape).join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => csvEscape(row[h])).join(","));
  }
  return lines.join("\r\n");
}
