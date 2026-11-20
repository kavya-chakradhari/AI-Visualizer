/**
 * Acceptance test (end-to-end, real dashboardEngine + database):
 *
 *   "Create a revenue KPI" -> "Make it blue" -> "Move it to the top" ->
 *   "Delete it"
 *
 * All four turns must refer to the same visual, resolved purely from
 * conversation context (no selectedVisualId is ever passed) — and the final
 * delete must produce a confirmation card, not execute silently.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import prisma from "../../db/client.js";
import { dashboardEngine } from "../../state/index.js";
import { processAIMessage, confirmAICommands } from "../service.js";
import { MockProvider } from "../providers/mock.js";
import { clearSession } from "../session.js";
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
    totalCount: 50,
    nullCount: 0,
    nullPercentage: 0,
    uniqueCount: dataType === "number" ? 50 : 5,
    cardinalityRatio: dataType === "number" ? 1 : 0.1,
    sampleValues: [],
  };
}

const SCHEMA: ColumnProfile[] = [
  column("Revenue", "number", "currency"),
  column("Region", "string", "categorical"),
];

let datasetId: string;
let dashboardId: string;
let pageId: string;

before(async () => {
  const dataset = await prisma.dataset.create({
    data: {
      id: randomUUID(),
      name: "Acceptance Test Dataset",
      rowCount: 50,
      columnCount: SCHEMA.length,
      schemaJson: JSON.stringify(SCHEMA),
    },
  });
  datasetId = dataset.id;

  const state = await dashboardEngine.createDashboard("Acceptance Test Dashboard", undefined, datasetId);
  dashboardId = state.dashboard.id;
  pageId = state.dashboard.pages[0]!.id;
});

after(async () => {
  await prisma.dashboard.delete({ where: { id: dashboardId } }).catch(() => {});
  await prisma.dataset.delete({ where: { id: datasetId } }).catch(() => {});
  dashboardEngine.invalidate(dashboardId);
  clearSession(dashboardId);
});

async function loadVisuals() {
  dashboardEngine.invalidate(dashboardId);
  const state = await dashboardEngine.loadState(dashboardId);
  return state!.dashboard.pages.find((p) => p.id === pageId)!.visuals;
}

describe("Acceptance: create -> color -> move -> delete, all referring to the same visual", () => {
  let visualId: string;

  it('1. "Create a revenue KPI" creates exactly one KPI visual', async () => {
    const result = await processAIMessage(dashboardId, "Create a revenue KPI", {
      provider: new MockProvider(),
    });

    assert.equal(result.success, true);
    assert.ok(result.success && result.executed);
    assert.equal(result.ai.clarification_needed, false);
    assert.equal(result.ai.requires_confirmation, false);

    const visuals = await loadVisuals();
    assert.equal(visuals.length, 1);
    assert.equal(visuals[0]!.kind, "kpi");
    assert.equal(visuals[0]!.encoding.measures?.[0]?.field, "Revenue");
    visualId = visuals[0]!.id;
  });

  it('2. "Make it blue" resolves "it" to that same KPI and updates its color, no selection needed', async () => {
    const result = await processAIMessage(dashboardId, "Make it blue", {
      provider: new MockProvider(),
      // Deliberately no selectedVisualId — resolution must come from session history.
    });

    assert.equal(result.success, true);
    assert.ok(result.success && result.executed, "a single-visual color change must execute immediately");
    assert.equal(result.ai.requires_confirmation, false);

    const visuals = await loadVisuals();
    assert.equal(visuals.length, 1, "no new visual should have been created");
    assert.equal(visuals[0]!.id, visualId, "must be the same visual as turn 1");
    assert.equal(visuals[0]!.style.colors?.[0], "#3b82f6");
  });

  it('3. "Move it to the top" resolves to the same visual and repositions it', async () => {
    // Move it away from the top first (bypassing the AI layer, like a manual
    // drag would) so "move it to the top" has something real to prove.
    const nudged = await dashboardEngine.executeBatch(dashboardId, [
      { type: "move_visual", payload: { pageId, visualId, x: 2, y: 3 } },
    ]);
    assert.ok(nudged.success);

    const result = await processAIMessage(dashboardId, "Move it to the top", {
      provider: new MockProvider(),
    });

    assert.equal(result.success, true);
    assert.ok(result.success && result.executed, "a single-visual move must execute immediately");
    assert.equal(result.ai.requires_confirmation, false);

    const visuals = await loadVisuals();
    assert.equal(visuals.length, 1);
    assert.equal(visuals[0]!.id, visualId, "must still be the same visual");
    assert.equal(visuals[0]!.layout.y, 0);
  });

  it('4. "Delete it" resolves to the same visual but requires confirmation instead of executing', async () => {
    const result = await processAIMessage(dashboardId, "Delete it", {
      provider: new MockProvider(),
    });

    assert.equal(result.success, true);
    assert.ok(result.success && !result.executed, "delete must NOT execute silently");
    assert.equal(result.success && result.requiresConfirmation, true);
    assert.equal(result.ai.commands.length, 1);
    assert.equal(result.ai.commands[0]!.type, "delete_visual");
    assert.equal((result.ai.commands[0]!.payload as { visualId: string }).visualId, visualId);

    // Nothing was actually deleted yet.
    const visuals = await loadVisuals();
    assert.equal(visuals.length, 1);
    assert.equal(visuals[0]!.id, visualId);
  });

  it("5. approving the confirmation card via /ai/confirm actually deletes it", async () => {
    const pending = await processAIMessage(dashboardId, "Delete it", { provider: new MockProvider() });
    assert.ok(pending.success && !pending.executed);

    const confirmed = await confirmAICommands(
      dashboardId,
      pending.success ? pending.ai.commands : [],
      "Delete it"
    );

    assert.equal(confirmed.success, true);
    assert.ok(confirmed.success && confirmed.executed);

    const visuals = await loadVisuals();
    assert.equal(visuals.length, 0, "the visual should now be gone");
  });
});
