import type { ColumnProfile, FieldSemanticType } from "@ai-vis/types";

/**
 * Pure deterministic and statistical data profiler.
 * Analyzes tabular data row-by-row without LLMs or heuristic fabrication.
 * If type confidence is insufficient or types are mixed, marks the column as "unknown" with isAmbiguous = true.
 */

interface ColumnAccumulator {
  name: string;
  totalCount: number;
  nullCount: number;
  values: unknown[];
  uniqueValuesSet: Set<string>;
}

// Regex patterns for deterministic matching
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDENTIFIER_NAME_REGEX =
  /(?:^|[_\s-])(id|uuid|guid|key|code|sku|vin|isbn|ref|token|hash|number|num)(?:$|[_\s-])/i;
const CURRENCY_SYMBOL_REGEX = /^[\$€£¥₹₩₽]\s*[-+]?[0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]+)?$/;
const CURRENCY_POSTFIX_REGEX = /^[-+]?[0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]+)?\s*[\$€£¥₹₩₽]$/;
const CURRENCY_PAREN_REGEX = /^\(\s*[\$€£¥₹₩₽]?\s*[0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]+)?\s*\)$/;
const CURRENCY_NAME_REGEX =
  /(?:^|[_\s-])(price|cost|revenue|salary|amount|budget|spend|fee|total|balance|earnings|profit|loss|fare|payment)(?:$|[_\s-])/i;
const PERCENTAGE_STRING_REGEX = /^[-+]?[0-9]+(?:\.[0-9]+)?\s*%$/;
const PERCENTAGE_NAME_REGEX = /(?:^|[_\s-])(pct|percent|percentage|rate|ratio|margin|share)(?:$|[_\s-])/i;
const STRICT_ISO_DATE_REGEX =
  /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
const COMMON_DATE_REGEX =
  /^(?:\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}|\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2})$/;
const STRICT_NUMBER_REGEX = /^[-+]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?(?:[eE][-+]?\d+)?$/;

function isNullOrEmpty(val: unknown): boolean {
  if (val === null || val === undefined) return true;
  if (typeof val === "string" && val.trim() === "") return true;
  return false;
}

function parseNumericValue(val: unknown): number | null {
  if (typeof val === "number" && !isNaN(val)) return val;
  if (typeof val !== "string") return null;

  const trimmed = val.trim();
  if (!STRICT_NUMBER_REGEX.test(trimmed)) return null;

  const normalized = trimmed.replace(/,/g, "");
  const num = parseFloat(normalized);
  return isNaN(num) ? null : num;
}

function parseCurrencyValue(val: unknown): number | null {
  if (typeof val === "number" && !isNaN(val)) return val;
  if (typeof val !== "string") return null;

  const trimmed = val.trim();
  const isParenNegative = CURRENCY_PAREN_REGEX.test(trimmed);
  const cleanStr = trimmed.replace(/[\$€£¥₹₩₽,\s\(\)]/g, "");
  const num = parseFloat(cleanStr);
  if (isNaN(num)) return null;
  return isParenNegative ? -Math.abs(num) : num;
}

function parsePercentageValue(val: unknown): number | null {
  if (typeof val === "number" && !isNaN(val)) return val;
  if (typeof val !== "string") return null;

  const trimmed = val.trim();
  if (PERCENTAGE_STRING_REGEX.test(trimmed)) {
    const cleanStr = trimmed.replace(/[%,\s]/g, "");
    const num = parseFloat(cleanStr);
    return isNaN(num) ? null : num;
  }
  return null;
}

function parseDateValue(val: unknown): Date | null {
  if (val instanceof Date && !isNaN(val.getTime())) {
    return val;
  }
  if (typeof val !== "string") return null;

  const trimmed = val.trim();
  // Must match date pattern to avoid Date.parse parsing arbitrary numbers or sentences
  if (!STRICT_ISO_DATE_REGEX.test(trimmed) && !COMMON_DATE_REGEX.test(trimmed)) {
    return null;
  }

  const parsed = Date.parse(trimmed);
  if (isNaN(parsed)) return null;

  const d = new Date(parsed);
  const year = d.getFullYear();
  // Filter out extreme unrealistic years
  if (year < 1800 || year > 2150) return null;

  return d;
}

function isBooleanValue(val: unknown): boolean {
  if (typeof val === "boolean") return true;
  if (typeof val === "string") {
    const lower = val.trim().toLowerCase();
    return lower === "true" || lower === "false" || lower === "yes" || lower === "no";
  }
  return false;
}

/**
 * Profiles an ingested dataset deterministically.
 */
export function profileDataset(
  headers: string[],
  rows: Record<string, unknown>[],
  totalRowCount: number
): ColumnProfile[] {
  const accumulators: Map<string, ColumnAccumulator> = new Map();

  for (const header of headers) {
    accumulators.set(header, {
      name: header,
      totalCount: totalRowCount,
      nullCount: 0,
      values: [],
      uniqueValuesSet: new Set(),
    });
  }

  // Accumulate column values
  for (const row of rows) {
    for (const header of headers) {
      const acc = accumulators.get(header)!;
      const val = row[header];

      if (isNullOrEmpty(val)) {
        acc.nullCount++;
      } else {
        acc.values.push(val);
        acc.uniqueValuesSet.add(String(val).trim());
      }
    }
  }

  const profiles: ColumnProfile[] = [];

  for (const header of headers) {
    const acc = accumulators.get(header)!;
    const nonNullCount = acc.values.length;
    const uniqueCount = acc.uniqueValuesSet.size;
    const nullPercentage =
      totalRowCount > 0 ? Number(((acc.nullCount / totalRowCount) * 100).toFixed(2)) : 0;
    const cardinalityRatio =
      nonNullCount > 0 ? Number((uniqueCount / nonNullCount).toFixed(4)) : 0;

    // Collect distinct representative sample values (up to 8)
    const sampleValues: (string | number | boolean | null)[] = [];
    for (const val of acc.uniqueValuesSet) {
      if (sampleValues.length >= 8) break;
      sampleValues.push(val);
    }

    // Edge case: all rows are null/empty
    if (nonNullCount === 0) {
      profiles.push({
        name: header,
        dataType: "unknown",
        semanticType: "unknown",
        totalCount: totalRowCount,
        nullCount: acc.nullCount,
        nullPercentage,
        uniqueCount: 0,
        cardinalityRatio: 0,
        min: null,
        max: null,
        mean: null,
        sampleValues: [],
        isAmbiguous: true,
      });
      continue;
    }

    // Type vote counters
    let booleanCount = 0;
    let numericCount = 0;
    let currencyCount = 0;
    let percentageCount = 0;
    let dateCount = 0;
    let uuidCount = 0;

    const parsedNumbers: number[] = [];
    const parsedCurrencies: number[] = [];
    const parsedPercentages: number[] = [];
    const parsedDates: Date[] = [];

    for (const v of acc.values) {
      if (isBooleanValue(v)) {
        booleanCount++;
      }

      const numVal = parseNumericValue(v);
      if (numVal !== null) {
        numericCount++;
        parsedNumbers.push(numVal);
      }

      const curVal = parseCurrencyValue(v);
      if (
        curVal !== null &&
        typeof v === "string" &&
        (CURRENCY_SYMBOL_REGEX.test(v) ||
          CURRENCY_POSTFIX_REGEX.test(v) ||
          CURRENCY_PAREN_REGEX.test(v))
      ) {
        currencyCount++;
        parsedCurrencies.push(curVal);
      }

      const pctVal = parsePercentageValue(v);
      if (pctVal !== null) {
        percentageCount++;
        parsedPercentages.push(pctVal);
      }

      const dateVal = parseDateValue(v);
      if (dateVal !== null) {
        dateCount++;
        parsedDates.push(dateVal);
      }

      if (typeof v === "string" && UUID_REGEX.test(v.trim())) {
        uuidCount++;
      }
    }

    // Ratios of matches among non-null values
    const numRatio = numericCount / nonNullCount;
    const curRatio = currencyCount / nonNullCount;
    const pctRatio = percentageCount / nonNullCount;
    const dateRatio = dateCount / nonNullCount;
    const boolRatio = booleanCount / nonNullCount;
    const uuidRatio = uuidCount / nonNullCount;

    let detectedDataType: "number" | "string" | "boolean" | "date" | "unknown" = "string";
    let detectedSemanticType: FieldSemanticType = "unknown";
    let isAmbiguous = false;
    let minVal: number | string | null = null;
    let maxVal: number | string | null = null;
    let meanVal: number | null = null;

    // Deterministic hierarchy rules
    // 1. Explicit Currency
    if (curRatio >= 0.85 || (CURRENCY_NAME_REGEX.test(header) && numRatio >= 0.85)) {
      detectedDataType = "number";
      detectedSemanticType = "currency";
      const nums = curRatio >= 0.85 ? parsedCurrencies : parsedNumbers;
      if (nums.length > 0) {
        minVal = Math.min(...nums);
        maxVal = Math.max(...nums);
        meanVal = Number((nums.reduce((sum, n) => sum + n, 0) / nums.length).toFixed(2));
      }
    }
    // 2. Explicit Percentage
    else if (pctRatio >= 0.85 || (PERCENTAGE_NAME_REGEX.test(header) && numRatio >= 0.85)) {
      detectedDataType = "number";
      detectedSemanticType = "percentage";
      const nums = pctRatio >= 0.85 ? parsedPercentages : parsedNumbers;
      if (nums.length > 0) {
        minVal = Math.min(...nums);
        maxVal = Math.max(...nums);
        meanVal = Number((nums.reduce((sum, n) => sum + n, 0) / nums.length).toFixed(2));
      }
    }
    // 3. Date
    else if (dateRatio >= 0.85) {
      detectedDataType = "date";
      detectedSemanticType = "date";
      if (parsedDates.length > 0) {
        const timestamps = parsedDates.map((d) => d.getTime());
        minVal = new Date(Math.min(...timestamps)).toISOString();
        maxVal = new Date(Math.max(...timestamps)).toISOString();
      }
    }
    // 4. Identifier (UUID, specific ID header name + high cardinality, or 100% unique sequence)
    else if (
      uuidRatio >= 0.85 ||
      (IDENTIFIER_NAME_REGEX.test(header) && (cardinalityRatio >= 0.9 || numRatio >= 0.9)) ||
      (cardinalityRatio === 1.0 && nonNullCount > 10 && !CURRENCY_NAME_REGEX.test(header))
    ) {
      detectedDataType = numRatio >= 0.95 ? "number" : "string";
      detectedSemanticType = "identifier";
      if (numRatio >= 0.95 && parsedNumbers.length > 0) {
        minVal = Math.min(...parsedNumbers);
        maxVal = Math.max(...parsedNumbers);
      }
    }
    // 5. Pure Boolean
    else if (boolRatio >= 0.95 && uniqueCount <= 2) {
      detectedDataType = "boolean";
      detectedSemanticType = "categorical";
    }
    // 6. Generic Numeric (Continuous or Discrete numbers)
    else if (numRatio >= 0.85) {
      detectedDataType = "number";
      // If integer with low cardinality, may be categorical (e.g., status codes 1, 2, 3)
      if (uniqueCount <= 10 && cardinalityRatio < 0.05 && totalRowCount > 20) {
        detectedSemanticType = "categorical";
      } else {
        detectedSemanticType = "numeric";
      }

      if (parsedNumbers.length > 0) {
        minVal = Math.min(...parsedNumbers);
        maxVal = Math.max(...parsedNumbers);
        meanVal = Number(
          (parsedNumbers.reduce((sum, n) => sum + n, 0) / parsedNumbers.length).toFixed(2)
        );
      }
    }
    // 7. Categorical Strings (Repeated discrete values)
    else if (
      (uniqueCount <= 30 && cardinalityRatio <= 0.25) ||
      (uniqueCount <= 100 && cardinalityRatio <= 0.1)
    ) {
      detectedDataType = "string";
      detectedSemanticType = "categorical";
    }
    // 8. Free-form text or high cardinality strings without identifier pattern
    else if (cardinalityRatio > 0.4 && numRatio < 0.2 && dateRatio < 0.2) {
      detectedDataType = "string";
      detectedSemanticType = "categorical";
    }
    // Ambiguous: mixed incompatible types or low dominant pattern confidence
    else {
      detectedDataType = "unknown";
      detectedSemanticType = "unknown";
      isAmbiguous = true;
    }

    profiles.push({
      name: header,
      dataType: detectedDataType,
      semanticType: detectedSemanticType,
      totalCount: totalRowCount,
      nullCount: acc.nullCount,
      nullPercentage,
      uniqueCount,
      cardinalityRatio,
      min: minVal,
      max: maxVal,
      mean: meanVal,
      sampleValues,
      isAmbiguous,
    });
  }

  return profiles;
}
