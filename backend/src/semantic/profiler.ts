import type { ColumnProfile, FieldSemanticType } from "@ai-vis/types";

const CURRENCY_REGEX = /^[$€£¥₹]\s*-?[\d,]+(\.\d+)?$|^-?[\d,]+(\.\d+)?\s*[$€£¥₹]$/;
const PERCENTAGE_REGEX = /^-?[\d,]+(\.\d+)?\s*%$/;
const DATE_REGEX =
  /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$|^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/;
const NUMERIC_REGEX = /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function cleanNumber(val: string | number): number {
  if (typeof val === "number") return val;
  const cleaned = val.replace(/[$€£¥₹,%]/g, "").trim();
  return parseFloat(cleaned);
}

/**
 * Pure deterministic statistical profiler.
 * Detects per-column: data type, null %, unique count, cardinality, min, max, mean, sample values.
 * Strictly assigns "unknown" if a column is ambiguous or mixed.
 */
export function profileDataset(
  headers: string[],
  rows: Record<string, unknown>[]
): ColumnProfile[] {
  const totalCount = rows.length;

  return headers.map((colName) => {
    let nullCount = 0;
    const nonNullValues: unknown[] = [];
    const uniqueSet = new Set<string>();

    for (let i = 0; i < totalCount; i++) {
      const val = rows[i]?.[colName];
      if (val === null || val === undefined || (typeof val === "string" && val.trim() === "")) {
        nullCount++;
      } else {
        nonNullValues.push(val);
        uniqueSet.add(typeof val === "object" ? JSON.stringify(val) : String(val));
      }
    }

    const nullPercentage =
      totalCount > 0 ? Number(((nullCount / totalCount) * 100).toFixed(2)) : 0;
    const uniqueCount = uniqueSet.size;
    const nonNullCount = nonNullValues.length;
    const cardinalityRatio =
      nonNullCount > 0 ? Number((uniqueCount / nonNullCount).toFixed(4)) : 0;

    // Pick up to 5 distinct non-null sample values
    const sampleValues: (string | number | boolean | null)[] = [];
    for (const val of nonNullValues) {
      if (sampleValues.length >= 5) break;
      const primitive =
        typeof val === "number" || typeof val === "boolean"
          ? val
          : String(val);
      if (!sampleValues.includes(primitive)) {
        sampleValues.push(primitive);
      }
    }

    // Completely empty column
    if (nonNullCount === 0) {
      return {
        name: colName,
        dataType: "unknown",
        semanticType: "unknown",
        totalCount,
        nullCount,
        nullPercentage,
        uniqueCount: 0,
        cardinalityRatio: 0,
        min: null,
        max: null,
        mean: null,
        sampleValues: [],
        isAmbiguous: true,
      };
    }

    // Count pattern matches across non-null values
    let currencyMatches = 0;
    let percentageMatches = 0;
    let dateMatches = 0;
    let numericMatches = 0;
    let booleanMatches = 0;

    for (const v of nonNullValues) {
      if (typeof v === "boolean" || v === "true" || v === "false") {
        booleanMatches++;
      }

      if (typeof v === "number") {
        numericMatches++;
      } else if (typeof v === "string") {
        const s = v.trim();
        if (CURRENCY_REGEX.test(s)) currencyMatches++;
        if (PERCENTAGE_REGEX.test(s)) percentageMatches++;
        if (NUMERIC_REGEX.test(s.replace(/,/g, ""))) numericMatches++;

        if (DATE_REGEX.test(s)) {
          const timestamp = Date.parse(s);
          if (!isNaN(timestamp)) {
            const year = new Date(timestamp).getFullYear();
            if (year >= 1900 && year <= 2100) {
              dateMatches++;
            }
          }
        }
      }
    }

    const currencyRatio = currencyMatches / nonNullCount;
    const percentageRatio = percentageMatches / nonNullCount;
    const dateRatio = dateMatches / nonNullCount;
    const numericRatio = numericMatches / nonNullCount;
    const booleanRatio = booleanMatches / nonNullCount;

    const lowerCol = colName.toLowerCase();
    const hasIdName =
      lowerCol === "id" ||
      lowerCol.endsWith("_id") ||
      lowerCol.endsWith("id") ||
      lowerCol.endsWith("code") ||
      lowerCol.endsWith("key") ||
      lowerCol.endsWith("uuid");

    // 1. Currency
    if (currencyRatio >= 0.85) {
      const numbers = nonNullValues.map((v) => cleanNumber(String(v))).filter((n) => !isNaN(n));
      const min = numbers.length > 0 ? Math.min(...numbers) : null;
      const max = numbers.length > 0 ? Math.max(...numbers) : null;
      const mean =
        numbers.length > 0
          ? Number((numbers.reduce((a, b) => a + b, 0) / numbers.length).toFixed(2))
          : null;

      return {
        name: colName,
        dataType: "number",
        semanticType: "currency",
        totalCount,
        nullCount,
        nullPercentage,
        uniqueCount,
        cardinalityRatio,
        min,
        max,
        mean,
        sampleValues,
      };
    }

    // 2. Percentage
    if (percentageRatio >= 0.85) {
      const numbers = nonNullValues.map((v) => cleanNumber(String(v))).filter((n) => !isNaN(n));
      const min = numbers.length > 0 ? Math.min(...numbers) : null;
      const max = numbers.length > 0 ? Math.max(...numbers) : null;
      const mean =
        numbers.length > 0
          ? Number((numbers.reduce((a, b) => a + b, 0) / numbers.length).toFixed(2))
          : null;

      return {
        name: colName,
        dataType: "number",
        semanticType: "percentage",
        totalCount,
        nullCount,
        nullPercentage,
        uniqueCount,
        cardinalityRatio,
        min,
        max,
        mean,
        sampleValues,
      };
    }

    // 3. Date
    if (dateRatio >= 0.85) {
      const timestamps = nonNullValues
        .map((v) => Date.parse(String(v)))
        .filter((t) => !isNaN(t));
      const min = timestamps.length > 0 ? new Date(Math.min(...timestamps)).toISOString() : null;
      const max = timestamps.length > 0 ? new Date(Math.max(...timestamps)).toISOString() : null;

      return {
        name: colName,
        dataType: "date",
        semanticType: "date",
        totalCount,
        nullCount,
        nullPercentage,
        uniqueCount,
        cardinalityRatio,
        min,
        max,
        mean: null,
        sampleValues,
      };
    }

    // 4. Numeric
    if (numericRatio >= 0.85) {
      const numbers = nonNullValues.map((v) => cleanNumber(v as string | number)).filter((n) => !isNaN(n));
      const min = numbers.length > 0 ? Math.min(...numbers) : null;
      const max = numbers.length > 0 ? Math.max(...numbers) : null;
      const mean =
        numbers.length > 0
          ? Number((numbers.reduce((a, b) => a + b, 0) / numbers.length).toFixed(2))
          : null;

      // Check if numeric column is actually an identifier (e.g. customer_id, 100% unique sequence)
      if (hasIdName && cardinalityRatio > 0.9) {
        return {
          name: colName,
          dataType: "number",
          semanticType: "identifier",
          totalCount,
          nullCount,
          nullPercentage,
          uniqueCount,
          cardinalityRatio,
          min,
          max,
          mean,
          sampleValues,
        };
      }

      return {
        name: colName,
        dataType: "number",
        semanticType: "numeric",
        totalCount,
        nullCount,
        nullPercentage,
        uniqueCount,
        cardinalityRatio,
        min,
        max,
        mean,
        sampleValues,
      };
    }

    // 5. Boolean
    if (booleanRatio >= 0.9) {
      return {
        name: colName,
        dataType: "boolean",
        semanticType: "categorical",
        totalCount,
        nullCount,
        nullPercentage,
        uniqueCount,
        cardinalityRatio,
        min: null,
        max: null,
        mean: null,
        sampleValues,
      };
    }

    // 6. String Identifier (e.g. UUID, order_id, product_code)
    const isUuid = nonNullValues.every((v) => UUID_REGEX.test(String(v)));
    if (isUuid || (hasIdName && cardinalityRatio >= 0.8)) {
      return {
        name: colName,
        dataType: "string",
        semanticType: "identifier",
        totalCount,
        nullCount,
        nullPercentage,
        uniqueCount,
        cardinalityRatio,
        min: null,
        max: null,
        mean: null,
        sampleValues,
      };
    }

    // 7. Categorical (low-cardinality discrete categories: status, region, category, gender, etc.)
    if (uniqueCount <= 60 || cardinalityRatio <= 0.25) {
      return {
        name: colName,
        dataType: "string",
        semanticType: "categorical",
        totalCount,
        nullCount,
        nullPercentage,
        uniqueCount,
        cardinalityRatio,
        min: null,
        max: null,
        mean: null,
        sampleValues,
      };
    }

    // 8. Text vs Unknown
    // If cardinality is moderate or high and not clearly an ID or category, mark unknown to avoid guessing silently
    let semanticType: FieldSemanticType = "unknown";
    const isAmbiguous = true;

    return {
      name: colName,
      dataType: "string",
      semanticType,
      totalCount,
      nullCount,
      nullPercentage,
      uniqueCount,
      cardinalityRatio,
      min: null,
      max: null,
      mean: null,
      sampleValues,
      isAmbiguous,
    };
  });
}
