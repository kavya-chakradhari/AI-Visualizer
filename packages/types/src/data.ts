export type FieldSemanticType =
  | "numeric"
  | "categorical"
  | "date"
  | "identifier"
  | "percentage"
  | "currency"
  | "unknown";

export interface ColumnProfile {
  name: string;
  dataType: "number" | "string" | "boolean" | "date" | "unknown";
  semanticType: FieldSemanticType;
  totalCount: number;
  nullCount: number;
  nullPercentage: number;
  uniqueCount: number;
  cardinalityRatio: number;
  min?: number | string | null;
  max?: number | string | null;
  mean?: number | null;
  sampleValues: (string | number | boolean | null)[];
  isAmbiguous?: boolean;
}

export interface Dataset {
  id: string;
  name: string;
  description?: string;
  rowCount: number;
  columnCount: number;
  schema: ColumnProfile[];
  sampleRows?: Record<string, unknown>[];
  storagePath?: string;
  sourceFileName?: string;
  sourceFileType?: string;
  fileSizeBytes?: number;
  createdAt: string;
  updatedAt: string;
  createdById?: string;
  // Live Data Source Metadata
  sourceType?: DatasetSourceType;
  sourceConfig?: ApiSourceConfig | DatabaseSourceConfig;
  lastSyncedAt?: string;
  refreshIntervalSeconds?: number;
}

export type DatasetSourceType = "file" | "api" | "database" | "bigquery";

export interface ApiSourceConfig {
  url: string;
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
  dataPath?: string; // Dot notation or key name to extract array, e.g. "data" or "items"
  refreshIntervalSeconds?: number;
}

export interface DatabaseSourceConfig {
  type: "postgres" | "mysql" | "sqlite" | "bigquery";
  connectionString?: string;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  ssl?: boolean;
  // BigQuery specific
  projectId?: string;
  credentialsJson?: string;
  // SQL Query
  query: string;
  refreshIntervalSeconds?: number;
}

export interface DatasetUploadResponse {
  dataset: Dataset;
  sampleRows: Record<string, unknown>[];
}

export interface ApiTestResponse {
  valid: boolean;
  message?: string;
  totalRowsDetected?: number;
  sampleRows: Record<string, unknown>[];
  detectedColumns: string[];
}

export interface DatabaseTestResponse {
  valid: boolean;
  message?: string;
  rowCount?: number;
  sampleRows: Record<string, unknown>[];
  detectedColumns: string[];
}

export interface DatasetSyncResponse {
  dataset: Dataset;
  sampleRows: Record<string, unknown>[];
  refreshedAt: string;
  rowsCount: number;
}
