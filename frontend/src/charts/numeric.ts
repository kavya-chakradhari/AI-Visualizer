/**
 * Coerces a raw cell value (as it comes straight off the parsed CSV/XLSX —
 * never pre-normalized, see backend/src/data/parsers) into a number for
 * chart aggregation.
 *
 * The backend profiler (backend/src/data/profiler.ts) already recognizes
 * currency ("$1,200", "1,200 €", "(500)"), percentage ("15%"), and
 * thousand-separated numbers ("1,234.56") deterministically — but until now
 * the frontend's own aggregation used a bare `parseFloat`, which returns NaN
 * on every one of those and silently zeroes the series. This mirrors the
 * same parsing rules so a chart built against real, messily-formatted raw
 * data works without the user having to pre-clean their file.
 */
const CURRENCY_OR_PERCENT_CHARS = /[%$€£¥₹₩₽,\s]/g;
const PAREN_NEGATIVE = /^\(.*\)$/;

export function coerceNumeric(val: unknown): number | null {
  if (typeof val === "number") {
    return isNaN(val) ? null : val;
  }
  if (typeof val === "boolean") {
    return val ? 1 : 0;
  }
  if (typeof val !== "string") return null;

  const trimmed = val.trim();
  if (trimmed === "") return null;

  // Plain number first (fast path, also handles scientific notation).
  const direct = Number(trimmed);
  if (!isNaN(direct) && trimmed !== "") return direct;

  const isParenNegative = PAREN_NEGATIVE.test(trimmed);
  const stripped = trimmed.replace(PAREN_NEGATIVE, (m) => m.slice(1, -1));
  const cleaned = stripped.replace(CURRENCY_OR_PERCENT_CHARS, "");
  if (cleaned === "" || cleaned === "-" || cleaned === "+") return null;

  const num = Number(cleaned);
  if (isNaN(num)) return null;
  return isParenNegative ? -Math.abs(num) : num;
}
