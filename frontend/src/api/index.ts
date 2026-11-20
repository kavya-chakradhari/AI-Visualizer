import type { HealthResponse } from "@ai-vis/types";
import { uploadDataset, fetchDataset, listDatasets } from "./datasets.js";

const BASE_URL = import.meta.env.VITE_API_URL || "/api";

export async function fetchHealth(): Promise<HealthResponse> {
  const response = await fetch(`${BASE_URL}/health`);
  if (!response.ok) {
    throw new Error(`Health check failed with status: ${response.status}`);
  }
  return response.json();
}

export * from "./datasets.js";
export * from "./dashboards.js";
export * from "./ai.js";
import * as dashboards from "./dashboards.js";
import * as ai from "./ai.js";

export const apiClient = {
  getHealth: fetchHealth,
  uploadDataset,
  fetchDataset,
  listDatasets,
  ...dashboards,
  ...ai,
};

export default apiClient;

