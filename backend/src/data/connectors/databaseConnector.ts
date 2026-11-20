import type { DatabaseSourceConfig, DatabaseTestResponse } from "@ai-vis/types";
import prisma from "../../db/client.js";

/**
 * Validates that a user-provided SQL query is strictly read-only
 */
export function validateReadOnlySqlQuery(query: string): { valid: boolean; reason?: string } {
  if (!query || typeof query !== "string") {
    return { valid: false, reason: "Query string cannot be empty." };
  }

  // Strip SQL comments (-- comment and /* comment */)
  const cleanSql = query
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/--.*$/gm, "")
    .trim();

  if (!cleanSql) {
    return { valid: false, reason: "Query is empty after removing comments." };
  }

  // Must begin with SELECT or WITH
  const firstWord = cleanSql.split(/\s+/)[0]?.toUpperCase();
  if (firstWord !== "SELECT" && firstWord !== "WITH") {
    return {
      valid: false,
      reason: `Only read-only queries (starting with SELECT or WITH) are allowed. Detected: ${firstWord}`,
    };
  }

  // Dangerous keywords regex (word boundaries)
  const forbiddenKeywordsRegex =
    /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|REPLACE|GRANT|REVOKE|EXEC|EXECUTE|MERGE)\b/i;

  const forbiddenMatch = cleanSql.match(forbiddenKeywordsRegex);
  if (forbiddenMatch) {
    return {
      valid: false,
      reason: `Query contains forbidden destructive keyword '${forbiddenMatch[0]}'. Only read-only queries are permitted.`,
    };
  }

  return { valid: true };
}

/**
 * Ensures demo analytics tables exist in the local SQLite database for instant live testing
 */
let demoTablesInitialized = false;
export async function ensureDemoTablesExist(): Promise<void> {
  if (demoTablesInitialized) return;

  try {
    // 1. Check if demo table exists
    const tableCheck = await prisma.$queryRawUnsafe<unknown[]>(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='live_enterprise_orders'`
    );

    if (tableCheck.length === 0) {
      // Create table
      await prisma.$executeRawUnsafe(`
        CREATE TABLE live_enterprise_orders (
          order_id TEXT PRIMARY KEY,
          order_date TEXT,
          customer_region TEXT,
          product_category TEXT,
          sales_amount REAL,
          units_sold INTEGER,
          profit_margin REAL,
          status TEXT
        );
      `);

      // Seed 25 realistic records with dynamic timestamps so they look live
      const now = Date.now();
      const regions = ["North America", "Europe", "Asia-Pacific", "Latin America"];
      const categories = ["Enterprise Software", "Cloud Infrastructure", "Cybersecurity", "Analytics Engine"];
      const statuses = ["Completed", "Processing", "Shipped"];

      for (let i = 1; i <= 30; i++) {
        const orderId = `ORD-2026-${1000 + i}`;
        const daysAgo = Math.floor(Math.random() * 14);
        const orderDate = new Date(now - daysAgo * 86400000).toISOString().split("T")[0];
        const region = regions[i % regions.length];
        const category = categories[i % categories.length];
        const sales = Math.round((2500 + Math.random() * 15000) * 100) / 100;
        const units = Math.floor(Math.random() * 50) + 5;
        const margin = Math.round((0.18 + Math.random() * 0.42) * 100) / 100;
        const status = statuses[i % statuses.length];

        await prisma.$executeRawUnsafe(
          `INSERT INTO live_enterprise_orders VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          orderId,
          orderDate,
          region,
          category,
          sales,
          units,
          margin,
          status
        );
      }
    }
    demoTablesInitialized = true;
  } catch (err) {
    console.warn("Could not initialize demo SQLite tables:", err);
  }
}

/**
 * Executes a query against BigQuery via Google Cloud BigQuery REST API
 */
async function executeBigQueryRest(config: DatabaseSourceConfig): Promise<Record<string, unknown>[]> {
  if (!config.projectId) {
    throw new Error("Google Cloud Project ID is required for BigQuery connection.");
  }

  // Parse credentials if provided
  let token = "";
  if (config.credentialsJson) {
    try {
      const creds = JSON.parse(config.credentialsJson);
      if (creds.access_token) {
        token = creds.access_token;
      }
    } catch {
      // not JSON token
    }
  }

  if (!token && config.password) {
    token = config.password; // user may pass OAuth bearer token or API key
  }

  const url = `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(
    config.projectId
  )}/queries`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      query: config.query,
      useLegacySql: false,
      maxResults: 5000,
    }),
    signal: AbortSignal.timeout(20000),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`BigQuery API error (${res.status}): ${errText.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    schema?: { fields?: Array<{ name: string; type: string }> };
    rows?: Array<{ f?: Array<{ v: unknown }> }>;
    totalRows?: string;
  };

  const fields = data.schema?.fields || [];
  const rawRows = data.rows || [];

  return rawRows.map((r) => {
    const rowObj: Record<string, unknown> = {};
    fields.forEach((f, idx) => {
      rowObj[f.name] = r.f?.[idx]?.v ?? null;
    });
    return rowObj;
  });
}

/**
 * Normalizes SQL row objects (e.g. converting BigInt to numbers/strings, Date to ISO strings)
 */
function normalizeSqlRows(rawRows: unknown[]): Record<string, unknown>[] {
  return rawRows.map((item) => {
    if (typeof item !== "object" || item === null) return {};
    const row = item as Record<string, unknown>;
    const normalized: Record<string, unknown> = {};

    for (const [key, val] of Object.entries(row)) {
      if (val === null || val === undefined) {
        normalized[key] = null;
      } else if (typeof val === "bigint") {
        normalized[key] = Number(val);
      } else if (val instanceof Date) {
        normalized[key] = val.toISOString();
      } else if (typeof val === "object") {
        normalized[key] = JSON.stringify(val);
      } else {
        normalized[key] = val;
      }
    }
    return normalized;
  });
}

/**
 * Main query dispatcher for databases (PostgreSQL, MySQL, SQLite, BigQuery)
 */
export async function executeDatabaseQuery(config: DatabaseSourceConfig): Promise<{
  rows: Record<string, unknown>[];
  headers: string[];
  totalRows: number;
}> {
  // 1. Safety check
  const validation = validateReadOnlySqlQuery(config.query);
  if (!validation.valid) {
    throw new Error(validation.reason || "Invalid SQL query.");
  }

  let rawRows: unknown[] = [];

  // 2. Dispatch by database type
  if (config.type === "sqlite") {
    // Built-in SQLite engine (Prisma connection)
    await ensureDemoTablesExist();
    rawRows = await prisma.$queryRawUnsafe<unknown[]>(config.query);
  } else if (config.type === "postgres") {
    // Dynamic import of pg
    try {
      // @ts-expect-error dynamic import
      const pgModule = await import("pg");
      const Client = pgModule.default?.Client || pgModule.Client;
      const client = new Client(
        config.connectionString
          ? { connectionString: config.connectionString, ssl: config.ssl ? { rejectUnauthorized: false } : false }
          : {
              host: config.host,
              port: config.port || 5432,
              database: config.database,
              user: config.user,
              password: config.password,
              ssl: config.ssl ? { rejectUnauthorized: false } : false,
            }
      );
      await client.connect();
      try {
        const res = await client.query(config.query);
        rawRows = res.rows;
      } finally {
        await client.end().catch(() => {});
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("Cannot find package 'pg'") || msg.includes("Cannot find module 'pg'")) {
        throw new Error(
          "PostgreSQL driver is not installed in this environment. You can test live database queries using the built-in 'SQLite / Demo Analytics' database or BigQuery REST connector."
        );
      }
      throw err;
    }
  } else if (config.type === "mysql") {
    // Dynamic import of mysql2/promise
    try {
      // @ts-expect-error dynamic import
      const mysqlModule = await import("mysql2/promise");
      const mysql = mysqlModule.default || mysqlModule;
      const connection = await mysql.createConnection(
        config.connectionString || {
          host: config.host,
          port: config.port || 3306,
          database: config.database,
          user: config.user,
          password: config.password,
          ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
        }
      );
      try {
        const [rows] = await connection.query(config.query);
        rawRows = Array.isArray(rows) ? (rows as unknown[]) : [];
      } finally {
        await connection.end().catch(() => {});
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("Cannot find package 'mysql2'") || msg.includes("Cannot find module 'mysql2'")) {
        throw new Error(
          "MySQL driver is not installed in this environment. You can test live database queries using the built-in 'SQLite / Demo Analytics' database or BigQuery REST connector."
        );
      }
      throw err;
    }
  } else if (config.type === "bigquery") {
    rawRows = await executeBigQueryRest(config);
  } else {
    throw new Error(`Unsupported database type: '${config.type}'`);
  }

  const rows = normalizeSqlRows(rawRows);
  const headerSet = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      headerSet.add(key);
    }
  }

  const headers = Array.from(headerSet);

  return {
    rows,
    headers,
    totalRows: rows.length,
  };
}

/**
 * Tests database connectivity and previews query execution
 */
export async function testDatabaseConnection(config: DatabaseSourceConfig): Promise<DatabaseTestResponse> {
  try {
    const { rows, headers, totalRows } = await executeDatabaseQuery(config);
    return {
      valid: true,
      message: `Successfully connected to ${config.type.toUpperCase()}! Query returned ${totalRows} rows and ${headers.length} columns.`,
      rowCount: totalRows,
      sampleRows: rows.slice(0, 10),
      detectedColumns: headers,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to execute database query.";
    return {
      valid: false,
      message: msg,
      sampleRows: [],
      detectedColumns: [],
    };
  }
}
