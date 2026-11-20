/** Small, DB-free AIContext fixtures shared by the guard/pipeline/mock tests. */
import type { AIContext, AIFieldSummary } from "../context.js";

export function makeFields(): AIFieldSummary[] {
  return [
    { name: "Sales", dataType: "number", semanticType: "currency", role: "measure" },
    { name: "Region", dataType: "string", semanticType: "categorical", role: "dimension" },
    { name: "Units", dataType: "number", semanticType: "numeric", role: "measure" },
  ];
}

export function makeContext(overrides: Partial<AIContext> = {}): AIContext {
  return {
    dashboardId: "dash_1",
    dashboardTitle: "Test Dashboard",
    pageId: "page_1",
    pageTitle: "Page 1",
    visuals: [],
    otherPages: [],
    fields: makeFields(),
    datasets: [],
    theme: { name: "default", mode: "dark", primary: "#0284c7", chartPalette: [] },
    ...overrides,
  };
}
