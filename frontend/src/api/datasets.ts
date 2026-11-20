import type {
  ApiResponse,
  ApiErrorResponse,
  Dataset,
  DatasetUploadResponse,
} from "@ai-vis/types";
import { readApiError } from "./errors.js";
import { BASE_URL } from "./config.js";

/**
 * Uploads a .csv or .xlsx file to the backend data ingestion pipeline.
 * Tracks upload progress via XMLHttpRequest.
 */
export async function uploadDataset(
  file: File,
  name?: string,
  onProgress?: (percent: number) => void
): Promise<DatasetUploadResponse> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const formData = new FormData();
    formData.append("file", file);
    if (name) {
      formData.append("name", name);
    }

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        const percent = Math.round((event.loaded / event.total) * 100);
        onProgress(percent);
      }
    };

    xhr.onload = () => {
      try {
        const json = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300) {
          const apiRes = json as ApiResponse<DatasetUploadResponse>;
          resolve(apiRes.data);
        } else {
          const errRes = json as ApiErrorResponse;
          const msg =
            errRes.error?.message || `Upload failed with HTTP status ${xhr.status}`;
          const err = new Error(msg);
          (err as unknown as { code: string }).code =
            errRes.error?.code || "UPLOAD_FAILED";
          reject(err);
        }
      } catch {
        reject(
          new Error(
            `Failed to parse server response. Server returned HTTP ${xhr.status}: ${xhr.statusText}`
          )
        );
      }
    };

    xhr.onerror = () => {
      reject(
        new Error(
          "Network error: Unable to reach the ingestion server. Please verify the backend is running."
        )
      );
    };

    xhr.open("POST", `${BASE_URL}/datasets/upload`, true);
    xhr.send(formData);
  });
}

/**
 * Fetches dataset metadata and first 50 sample rows.
 */
export async function fetchDataset(id: string): Promise<Dataset> {
  const res = await fetch(`${BASE_URL}/datasets/${id}`);
  if (!res.ok) {
    const errorJson = (await res.json().catch(() => null)) as ApiErrorResponse | null;
    throw new Error(errorJson?.error?.message || `Failed to fetch dataset (${res.status})`);
  }
  const body = (await res.json()) as ApiResponse<Dataset>;
  return body.data;
}

/**
 * Fetches all uploaded datasets.
 */
export async function listDatasets(): Promise<Dataset[]> {
  const res = await fetch(`${BASE_URL}/datasets`);
  if (!res.ok) {
    throw new Error(`Failed to list datasets (${res.status})`);
  }
  const body = (await res.json()) as ApiResponse<Dataset[]>;
  return body.data;
}

/**
 * Permanently deletes a dataset — both its SQLite metadata and its on-disk
 * parsed rows, on the server.
 */
export async function deleteDataset(id: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/datasets/${id}`, { method: "DELETE" });
  if (!res.ok) {
    throw await readApiError(res, `Failed to delete dataset (${res.status})`);
  }
}

/**
 * Re-downloads the full parsed dataset as a CSV file — the MVP's "raw
 * dataset" export. Fetches the file as a blob first (rather than a plain
 * navigation to the URL) so a server error renders as a normal thrown
 * `ApiError` instead of dumping JSON into the browser tab.
 */
export async function exportDatasetCsv(datasetId: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/datasets/${datasetId}/export/csv`);
  if (!res.ok) {
    throw await readApiError(res, `Failed to export dataset (${res.status})`);
  }

  const blob = await res.blob();
  const disposition = res.headers.get("content-disposition") || "";
  const filename = /filename="([^"]+)"/.exec(disposition)?.[1] || "dataset.csv";

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/**
 * Tests an API endpoint source without saving
 */
export async function testApiSource(
  config: import("@ai-vis/types").ApiSourceConfig
): Promise<import("@ai-vis/types").ApiTestResponse> {
  const res = await fetch(`${BASE_URL}/datasets/api/test`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  });
  if (!res.ok) {
    throw await readApiError(res, `API test failed (${res.status})`);
  }
  const json = (await res.json()) as ApiResponse<import("@ai-vis/types").ApiTestResponse>;
  return json.data;
}

/**
 * Connects and ingests a live REST API dataset
 */
export async function connectApiDataset(
  name: string,
  config: import("@ai-vis/types").ApiSourceConfig,
  description?: string
): Promise<DatasetUploadResponse> {
  const res = await fetch(`${BASE_URL}/datasets/api`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, config, description }),
  });
  if (!res.ok) {
    throw await readApiError(res, `Failed to connect API dataset (${res.status})`);
  }
  const json = (await res.json()) as ApiResponse<DatasetUploadResponse>;
  return json.data;
}

/**
 * Tests a Database / BigQuery connection and SQL query without saving
 */
export async function testDatabaseSource(
  config: import("@ai-vis/types").DatabaseSourceConfig
): Promise<import("@ai-vis/types").DatabaseTestResponse> {
  const res = await fetch(`${BASE_URL}/datasets/database/test`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  });
  if (!res.ok) {
    throw await readApiError(res, `Database test failed (${res.status})`);
  }
  const json = (await res.json()) as ApiResponse<import("@ai-vis/types").DatabaseTestResponse>;
  return json.data;
}

/**
 * Connects and ingests a live Database / BigQuery dataset
 */
export async function connectDatabaseDataset(
  name: string,
  config: import("@ai-vis/types").DatabaseSourceConfig,
  description?: string
): Promise<DatasetUploadResponse> {
  const res = await fetch(`${BASE_URL}/datasets/database`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, config, description }),
  });
  if (!res.ok) {
    throw await readApiError(res, `Failed to connect database dataset (${res.status})`);
  }
  const json = (await res.json()) as ApiResponse<DatasetUploadResponse>;
  return json.data;
}

/**
 * Syncs / re-fetches the latest live data for a dataset
 */
export async function syncDataset(
  datasetId: string
): Promise<import("@ai-vis/types").DatasetSyncResponse> {
  const res = await fetch(`${BASE_URL}/datasets/${datasetId}/sync`, {
    method: "POST",
  });
  if (!res.ok) {
    throw await readApiError(res, `Failed to sync dataset (${res.status})`);
  }
  const json = (await res.json()) as ApiResponse<import("@ai-vis/types").DatasetSyncResponse>;
  return json.data;
}
