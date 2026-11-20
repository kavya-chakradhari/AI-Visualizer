import type { HealthResponse } from "@ai-vis/types";
import { BASE_URL } from "./config.js";
import { uploadDataset, fetchDataset, listDatasets } from "./datasets.js";

export { BASE_URL } from "./config.js";

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

