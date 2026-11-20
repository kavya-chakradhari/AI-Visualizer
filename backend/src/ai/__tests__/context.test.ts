/**
 * Tests for context assembly — must stay compact (no raw dataset rows) and
 * classify fields correctly.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { createEmptyDashboardState } from "@ai-vis/types";
import type { ColumnProfile } from "@ai-vis/types";
import { buildAIContext, type DatasetSchemaMap } from "../context.js";

function schemaMap(schema: ColumnProfile[], id = "ds_1", name = "Dataset"): DatasetSchemaMap {
  return schema.length > 0 ? new Map([[id, { name, schema }]]) : new Map();
}

function col(
  name: string,
  dataType: ColumnProfile["dataType"],
  semanticType: ColumnProfile["semanticType"]
): ColumnProfile {
  return {
    name,
    dataType,
    semanticType,
    totalCount: 10,
    nullCount: 0,
    nullPercentage: 0,
    uniqueCount: 5,
    cardinalityRatio: 0.5,
    sampleValues: [],
  };
}

describe("buildAIContext", () => {
  it("classifies measures and dimensions by semantic type", () => {
    const state = createEmptyDashboardState("dash_1", "T");
    const schema = [col("Sales", "number", "currency"), col("Region", "string", "categorical")];
    const context = buildAIContext(state, schemaMap(schema));
    assert.deepEqual(
      context.fields.map((f) => f.role),
      ["measure", "dimension"]
    );
  });

  it("includes calculated measures alongside dataset columns", () => {
    const state = createEmptyDashboardState("dash_1", "T");
    state.dashboard.calculatedFields = [
      { name: "Margin", expression: "Sales * 0.3", dataType: "number" },
    ];
    const context = buildAIContext(state, schemaMap([]));
    const margin = context.fields.find((f) => f.name === "Margin");
    assert.ok(margin);
    assert.equal(margin!.calculated, true);
    assert.equal(margin!.role, "measure");
  });

  it("never includes raw dataset rows — only the compact field list", () => {
    const state = createEmptyDashboardState("dash_1", "T");
    const context = buildAIContext(state, schemaMap([col("Sales", "number", "currency")])) as unknown as Record<
      string,
      unknown
    >;
    assert.ok(!("sampleRows" in context));
    assert.ok(!("rows" in context));
  });

  it("lists visuals on the active page only", () => {
    const state = createEmptyDashboardState("dash_1", "T");
    const pageId = state.dashboard.pages[0]!.id;
    state.dashboard.pages[0]!.visuals.push({
      id: "v1",
      pageId,
      title: "Chart A",
      kind: "bar",
      layout: { x: 0, y: 0, width: 6, height: 4 },
      encoding: {},
      style: {},
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    } as never);

    const context = buildAIContext(state, schemaMap([]));
    assert.equal(context.visuals.length, 1);
    assert.equal(context.visuals[0]!.id, "v1");
  });

  it("includes the selected visual's encoding when a selectedVisualId is given", () => {
    const state = createEmptyDashboardState("dash_1", "T");
    const pageId = state.dashboard.pages[0]!.id;
    state.dashboard.pages[0]!.visuals.push({
      id: "v1",
      pageId,
      title: "Chart A",
      kind: "bar",
      layout: { x: 0, y: 0, width: 6, height: 4 },
      encoding: { xField: "Region" },
      style: {},
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    } as never);

    const context = buildAIContext(state, schemaMap([]), "v1");
    assert.equal(context.selectedVisual?.id, "v1");
    assert.equal(context.selectedVisual?.encoding.xField, "Region");
  });

  it("lists other pages excluding the active one", () => {
    const state = createEmptyDashboardState("dash_1", "T");
    state.dashboard.pages.push({
      id: "page_2",
      dashboardId: "dash_1",
      title: "Second",
      order: 1,
      layoutConfig: { columns: 12, rowHeight: 50, margin: [10, 10] },
      visuals: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    const context = buildAIContext(state, schemaMap([]));
    assert.equal(context.otherPages.length, 1);
    assert.equal(context.otherPages[0]!.id, "page_2");
  });
});
