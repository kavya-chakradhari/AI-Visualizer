/**
 * End-to-end tests for the AI layer, exercising the real dashboardEngine +
 * database so command execution genuinely goes through the same
 * schema -> semantic -> scope -> transaction pipeline manual commands use.
 *
 * Required test cases:
 *   1. "Create a bar chart of Sales by Region" -> valid create_chart command, executes.
 *   2. "Create a revenue chart" with no Revenue field -> clarification_needed
 *      with suggested fields, nothing created.
 *   3. Malformed/unexpected LLM output -> handled without crashing.
 * Plus defense-in-depth coverage for the guard and confirmation forcing.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import prisma from "../../db/client.js";
import { dashboardEngine } from "../../state/index.js";
import { processAIMessage } from "../service.js";
import { MockProvider } from "../providers/mock.js";
import { AIProtocolError } from "../pipeline.js";
import type { LLMProvider, GenerateCommandsInput } from "../provider.js";
import type { AIResponse } from "../contract.js";
import type { ColumnProfile } from "@ai-vis/types";

function column(
  name: string,
  dataType: ColumnProfile["dataType"],
  semanticType: ColumnProfile["semanticType"]
): ColumnProfile {
  return {
    name,
    dataType,
    semanticType,
    totalCount: 100,
    nullCount: 0,
    nullPercentage: 0,
    uniqueCount: dataType === "number" ? 100 : 4,
    cardinalityRatio: dataType === "number" ? 1 : 0.04,
    sampleValues: [],
  };
}

const SCHEMA: ColumnProfile[] = [
  column("Sales", "number", "currency"),
  column("Region", "string", "categorical"),
];

let datasetId: string;
let dashboardId: string;
let pageId: string;

before(async () => {
  const dataset = await prisma.dataset.create({
    data: {
      id: randomUUID(),
      name: "AI Test Dataset",
      rowCount: 100,
      columnCount: SCHEMA.length,
      schemaJson: JSON.stringify(SCHEMA),
    },
  });
  datasetId = dataset.id;

  const state = await dashboardEngine.createDashboard("AI Test Dashboard", undefined, datasetId);
  dashboardId = state.dashboard.id;
  pageId = state.dashboard.pages[0]!.id;
});

after(async () => {
  await prisma.dashboard.delete({ where: { id: dashboardId } }).catch(() => {});
  await prisma.dataset.delete({ where: { id: datasetId } }).catch(() => {});
  dashboardEngine.invalidate(dashboardId);
});

async function currentVisualCount(): Promise<number> {
  dashboardEngine.invalidate(dashboardId);
  const state = await dashboardEngine.loadState(dashboardId);
  return state!.dashboard.pages.find((p) => p.id === pageId)!.visuals.length;
}

describe("AI layer — natural language to commands (required test cases)", () => {
  it("1. 'Create a bar chart of Sales by Region' -> valid create_chart command, executes", async () => {
    const before = await currentVisualCount();

    const result = await processAIMessage(dashboardId, "Create a bar chart of Sales by Region", {
      provider: new MockProvider(),
    });

    assert.equal(result.success, true);
    assert.ok(result.success && result.executed, "the command should have executed, not just been proposed");
    assert.equal(result.ai.clarification_needed, false);
    assert.equal(result.ai.commands.length, 1);
    assert.equal(result.ai.commands[0]!.type, "create_chart");

    const page = result.dashboard.dashboard.pages.find((p) => p.id === pageId)!;
    assert.equal(page.visuals.length, before + 1);
    const created = page.visuals.at(-1)!;
    assert.equal(created.kind, "bar");
    assert.equal(created.encoding.xField, "Region");
    assert.deepEqual(created.encoding.measures, [{ field: "Sales", aggregation: "sum" }]);
  });

  it("2. 'Create a revenue chart' when no Revenue field exists -> clarification_needed with suggested fields, nothing created", async () => {
    const before = await currentVisualCount();

    const result = await processAIMessage(dashboardId, "Create a revenue chart", {
      provider: new MockProvider(),
    });

    assert.equal(result.success, true);
    assert.ok(result.success && !result.executed, "nothing should execute when the field is unknown");
    assert.equal(result.ai.clarification_needed, true);
    assert.equal(result.ai.commands.length, 0);
    assert.match(result.ai.message, /Sales/, "should suggest the real 'Sales' field");

    assert.equal(await currentVisualCount(), before, "nothing should have been created");
  });

  it("3. malformed/unexpected LLM output is handled without crashing, user sees a clear error", async () => {
    const before = await currentVisualCount();

    const brokenProvider: LLMProvider = {
      name: "broken",
      generateCommands: async () => {
        throw new AIProtocolError("simulated: model never returned parseable JSON", [
          "not json at all",
          "still not json",
        ]);
      },
    };

    const result = await processAIMessage(dashboardId, "do something", { provider: brokenProvider });

    assert.equal(result.success, false);
    assert.ok(!result.success && result.stage === "ai_protocol");
    assert.ok(
      !result.success && /could ?n'?t be understood|could not be understood/i.test(result.message)
    );

    assert.equal(await currentVisualCount(), before, "a malformed response must never create anything");
  });
});

describe("AI layer — defense in depth", () => {
  it("catches a hallucinated field even when the provider itself never flags it", async () => {
    const before = await currentVisualCount();

    // Simulates a model that ignores the "never invent a field" instruction
    // and confidently claims everything is fine.
    const hallucinating: LLMProvider = {
      name: "hallucinating",
      generateCommands: async (input: GenerateCommandsInput): Promise<AIResponse> => ({
        intent: "create_visual",
        commands: [
          {
            type: "create_chart",
            payload: {
              pageId: input.context.pageId,
              kind: "bar",
              title: "Revenue by Region",
              encoding: { xField: "Region", measures: [{ field: "Revenue", aggregation: "sum" }] },
            },
          },
        ],
        requires_confirmation: false,
        clarification_needed: false,
        message: "Created a bar chart of Revenue by Region.",
      }),
    };

    const result = await processAIMessage(dashboardId, "chart revenue by region please", {
      provider: hallucinating,
    });

    assert.equal(result.success, true);
    assert.ok(result.success && !result.executed, "a hallucinated field must never execute");
    assert.equal(result.ai.clarification_needed, true);
    assert.match(result.ai.message, /Revenue/);
    assert.equal(await currentVisualCount(), before);
  });

  it("forces confirmation before executing a destructive command, even if the model omits the flag", async () => {
    const created = await dashboardEngine.executeBatch(dashboardId, [
      { type: "create_chart", payload: { pageId, kind: "bar", title: "Disposable" } },
    ]);
    assert.ok(created.success);
    const visualId = created.success
      ? created.dashboard.dashboard.pages.find((p) => p.id === pageId)!.visuals.at(-1)!.id
      : "";
    const before = await currentVisualCount();

    const deleteProvider: LLMProvider = {
      name: "delete-provider",
      generateCommands: async () => ({
        intent: "delete_visual",
        commands: [{ type: "delete_visual", payload: { pageId, visualId } }],
        requires_confirmation: false, // the model forgot to flag it
        clarification_needed: false,
        message: "Deleting the chart.",
      }),
    };

    const result = await processAIMessage(dashboardId, "delete that chart", { provider: deleteProvider });

    assert.equal(result.success, true);
    assert.ok(result.success && !result.executed);
    assert.equal(result.success && result.requiresConfirmation, true);
    assert.equal(await currentVisualCount(), before, "the visual must not be deleted without confirmation");
  });

  it("propagates a genuine Validation Engine rejection instead of silently ignoring it", async () => {
    // The model proposes a real field but an out-of-bounds layout; the guard
    // has nothing to catch here — the Validation Engine itself must reject it.
    const overflowProvider: LLMProvider = {
      name: "overflow-provider",
      generateCommands: async (input: GenerateCommandsInput): Promise<AIResponse> => ({
        intent: "create_visual",
        commands: [
          {
            type: "create_chart",
            payload: {
              pageId: input.context.pageId,
              kind: "bar",
              title: "Too Wide",
              layout: { x: 10, y: 0, width: 6, height: 4 },
            },
          },
        ],
        requires_confirmation: false,
        clarification_needed: false,
        message: "Created the chart.",
      }),
    };

    const before = await currentVisualCount();
    const result = await processAIMessage(dashboardId, "make a wide chart", { provider: overflowProvider });

    assert.equal(result.success, false);
    assert.ok(!result.success && result.stage === "semantic");
    assert.equal(await currentVisualCount(), before);
  });
});
