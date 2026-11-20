import type { ApiSourceConfig, ApiTestResponse } from "@ai-vis/types";

/**
 * Traverses an object using dot-notation (e.g. "data.items" or "results")
 */
function getValueByPath(obj: unknown, path: string): unknown {
  if (!path || path.trim() === "" || path.trim() === ".") return obj;
  const parts = path.split(".").map((p) => p.trim()).filter(Boolean);
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/**
 * Automatically detects the main tabular array in an arbitrary JSON structure
 */
function detectArrayInData(json: unknown): Record<string, unknown>[] {
  if (Array.isArray(json)) {
    return json.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null);
  }

  if (typeof json === "object" && json !== null) {
    const commonKeys = ["data", "items", "results", "records", "rows", "values", "entries", "list", "dataset"];
    for (const key of commonKeys) {
      const candidate = (json as Record<string, unknown>)[key];
      if (Array.isArray(candidate) && candidate.length > 0) {
        return candidate.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null);
      }
    }

    // Look for any array of objects inside the root keys
    for (const key of Object.keys(json)) {
      const candidate = (json as Record<string, unknown>)[key];
      if (Array.isArray(candidate) && candidate.length > 0 && typeof candidate[0] === "object") {
        return candidate.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null);
      }
    }

    // If it's a single flat object, convert into a single row
    return [json as Record<string, unknown>];
  }

  return [];
}

/**
 * Normalizes a record for tabular visualization by converting nested objects to strings
 */
function normalizeRecord(raw: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(raw)) {
    if (val === null || val === undefined) {
      result[key] = null;
    } else if (typeof val === "object") {
      if (val instanceof Date) {
        result[key] = val.toISOString();
      } else {
        result[key] = JSON.stringify(val);
      }
    } else {
      result[key] = val;
    }
  }
  return result;
}

/**
 * Performs HTTP request and extracts tabular rows from the API endpoint
 */
export async function executeApiRequest(config: ApiSourceConfig): Promise<{
  rows: Record<string, unknown>[];
  headers: string[];
  totalRows: number;
}> {
  if (!config.url || !config.url.startsWith("http")) {
    throw new Error("Invalid API URL. Must start with http:// or https://");
  }

  const method = config.method || "GET";
  const headers: Record<string, string> = {
    Accept: "application/json, text/plain, */*",
    ...(config.headers || {}),
  };

  const options: RequestInit = {
    method,
    headers,
    signal: AbortSignal.timeout(15000), // 15-second timeout
  };

  if (method === "POST" && config.body) {
    options.body = config.body;
    if (!headers["Content-Type"]) {
      headers["Content-Type"] = "application/json";
    }
  }

  const response = await fetch(config.url, options);

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(
      `API request failed with HTTP ${response.status} (${response.statusText}): ${errorBody.slice(0, 200)}`
    );
  }

  const contentType = response.headers.get("content-type") || "";
  let json: unknown;

  if (contentType.includes("application/json") || contentType.includes("application/octet-stream") || contentType === "") {
    json = await response.json();
  } else {
    // Attempt parsing as JSON anyway, or fallback to text error
    const text = await response.text();
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`API response is not valid JSON (received content-type: ${contentType})`);
    }
  }

  // Extract array
  let targetData: unknown = json;
  if (config.dataPath && config.dataPath.trim()) {
    targetData = getValueByPath(json, config.dataPath.trim());
  }

  const rawRows = detectArrayInData(targetData);

  if (!rawRows || rawRows.length === 0) {
    throw new Error(
      `No tabular records found in API response. ${
        config.dataPath ? `Checked path: '${config.dataPath}'. ` : ""
      }Please ensure the API returns a JSON array or specify the correct data path.`
    );
  }

  // Normalize rows
  const normalizedRows = rawRows.map(normalizeRecord);

  // Derive unique headers across all rows
  const headerSet = new Set<string>();
  for (const row of normalizedRows) {
    for (const key of Object.keys(row)) {
      headerSet.add(key);
    }
  }

  const headersList = Array.from(headerSet);

  return {
    rows: normalizedRows,
    headers: headersList,
    totalRows: normalizedRows.length,
  };
}

/**
 * Tests an API endpoint and returns a quick preview without saving
 */
export async function testApiConnection(config: ApiSourceConfig): Promise<ApiTestResponse> {
  try {
    const { rows, headers, totalRows } = await executeApiRequest(config);
    return {
      valid: true,
      message: `Successfully connected! Retrieved ${totalRows} records with ${headers.length} columns.`,
      totalRowsDetected: totalRows,
      sampleRows: rows.slice(0, 10),
      detectedColumns: headers,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to connect to API endpoint.";
    return {
      valid: false,
      message: msg,
      sampleRows: [],
      detectedColumns: [],
    };
  }
}
