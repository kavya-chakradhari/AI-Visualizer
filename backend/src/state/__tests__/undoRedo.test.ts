/**
 * Undo/redo tests against the real dashboardEngine + database, since the
 * behavior under test — batch-level undo/redo, the redo stack, and the
 * command history it's all built on — is precisely the persistence layer
 * itself, not something a fake in-memory store can stand in for.
 *
 * Covers the acceptance test verbatim: create 3 charts via mixed manual + AI
 * actions, undo twice, confirm state matches exactly, redo once, confirm
 * state matches, then apply a new command and confirm the old redo path is
 * discarded correctly — plus the edge cases called out in the spec.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import prisma from "../../db/client.js";
import { dashboardEngine } from "../index.js";
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
    totalCount: 20,
    nullCount: 0,
    nullPercentage: 0,
    uniqueCount: dataType === "number" ? 20 : 4,
    cardinalityRatio: dataType === "number" ? 1 : 0.2,
    sampleValues: [],
  };
}

const SCHEMA: ColumnProfile[] = [
  column("Sales", "number", "currency"),
  column("Region", "string", "categorical"),
];

async function makeDashboard(title: string) {
  const dataset = await prisma.dataset.create({
    data: {
      id: randomUUID(),
      name: `${title} Dataset`,
      rowCount: 20,
      columnCount: SCHEMA.length,
      schemaJson: JSON.stringify(SCHEMA),
    },
  });
  const state = await dashboardEngine.createDashboard(title, undefined, dataset.id);
  return { datasetId: dataset.id, dashboardId: state.dashboard.id, pageId: state.dashboard.pages[0]!.id };
}

async function cleanup(dashboardId: string, datasetId: string) {
  await prisma.dashboard.delete({ where: { id: dashboardId } }).catch(() => {});
  await prisma.dataset.delete({ where: { id: datasetId } }).catch(() => {});
  dashboardEngine.invalidate(dashboardId);
}

async function visualTitles(dashboardId: string, pageId: string): Promise<string[]> {
  dashboardEngine.invalidate(dashboardId);
  const state = await dashboardEngine.loadState(dashboardId);
  return state!.dashboard.pages.find((p) => p.id === pageId)!.visuals.map((v) => v.title);
}

// ─────────────────────────────────────────────

describe("undo/redo — edge cases", () => {
  let dashboardId: string;
  let datasetId: string;

  before(async () => {
    ({ dashboardId, datasetId } = await makeDashboard("Undo Edge Cases"));
  });
  after(async () => cleanup(dashboardId, datasetId));

  it("undo on an empty log is a no-op with a clear message, not a crash", async () => {
    const result = await dashboardEngine.undo(dashboardId);
    assert.equal(result.success, false);
    assert.equal(result.errorCode, "NOTHING_TO_UNDO");
    assert.match(result.errorMessage ?? "", /no commands available to undo/i);
    // Dashboard is returned unchanged, not some empty/broken state.
    assert.equal(result.dashboard.dashboard.id, dashboardId);
  });

  it("redo on an empty log is a no-op with a clear message, not a crash", async () => {
    const result = await dashboardEngine.redo(dashboardId);
    assert.equal(result.success, false);
    assert.equal(result.errorCode, "NOTHING_TO_REDO");
    assert.match(result.errorMessage ?? "", /no commands available to redo/i);
  });

  it("undo/redo on a dashboard that doesn't exist reports NOT_FOUND, never throws", async () => {
    const undoResult = await dashboardEngine.undo("no-such-dashboard");
    assert.equal(undoResult.success, false);
    assert.equal(undoResult.errorCode, "DASHBOARD_NOT_FOUND");

    const redoResult = await dashboardEngine.redo("no-such-dashboard");
    assert.equal(redoResult.success, false);
    assert.equal(redoResult.errorCode, "DASHBOARD_NOT_FOUND");
  });
});

describe("undo/redo — a multi-step AI batch undoes as ONE atomic step", () => {
  let dashboardId: string;
  let datasetId: string;
  let pageId: string;

  before(async () => {
    ({ dashboardId, datasetId, pageId } = await makeDashboard("Batch Undo"));
  });
  after(async () => cleanup(dashboardId, datasetId));

  it("creates 3 charts in one AI batch, then undoes all 3 together", async () => {
    const batch = await dashboardEngine.executeBatch(
      dashboardId,
      [
        { type: "create_chart", payload: { pageId, kind: "bar", title: "Chart A" }, origin: "ai" },
        { type: "create_chart", payload: { pageId, kind: "line", title: "Chart B" }, origin: "ai" },
        { type: "create_chart", payload: { pageId, kind: "pie", title: "Chart C" }, origin: "ai" },
      ],
      undefined
    );
    assert.ok(batch.success);
    assert.equal(await visualTitles(dashboardId, pageId).then((t) => t.length), 3);

    const undoResult = await dashboardEngine.undo(dashboardId);
    assert.equal(undoResult.success, true);

    const titlesAfterUndo = await visualTitles(dashboardId, pageId);
    assert.deepEqual(
      titlesAfterUndo,
      [],
      "one undo must remove all 3 charts from the AI batch, not just the last one"
    );
  });

  it("a single undo does not step through the batch's sub-commands one at a time", async () => {
    // Redo to restore the 3-chart batch, then confirm a single further undo
    // (of a subsequent single manual command) doesn't touch the batch at all.
    const redoResult = await dashboardEngine.redo(dashboardId);
    assert.equal(redoResult.success, true);
    assert.equal(await visualTitles(dashboardId, pageId).then((t) => t.length), 3);

    const manual = await dashboardEngine.applyAndPersist(dashboardId, {
      type: "CREATE_VISUAL",
      payload: { pageId, kind: "kpi", title: "Chart D" } as never,
      origin: "user",
    });
    assert.ok(manual.success);
    assert.equal(await visualTitles(dashboardId, pageId).then((t) => t.length), 4);

    // Undo the single manual command — the 3-chart AI batch must remain untouched.
    const undoManual = await dashboardEngine.undo(dashboardId);
    assert.equal(undoManual.success, true);
    const titles = await visualTitles(dashboardId, pageId);
    assert.deepEqual(titles.sort(), ["Chart A", "Chart B", "Chart C"]);
  });
});

describe("undo/redo — history reflects batch source and a readable summary", () => {
  let dashboardId: string;
  let datasetId: string;
  let pageId: string;

  before(async () => {
    ({ dashboardId, datasetId, pageId } = await makeDashboard("History Labels"));
  });
  after(async () => cleanup(dashboardId, datasetId));

  it("labels a manual single-chart creation and an AI batch distinctly", async () => {
    const manual = await dashboardEngine.applyAndPersist(dashboardId, {
      type: "CREATE_VISUAL",
      payload: { pageId, kind: "bar", title: "Sales Chart" } as never,
      origin: "user",
    });
    assert.ok(manual.success);

    const ai = await dashboardEngine.executeBatch(
      dashboardId,
      [
        { type: "create_chart", payload: { pageId, kind: "line", title: "Trend" }, origin: "ai" },
        { type: "create_chart", payload: { pageId, kind: "kpi", title: "Total" }, origin: "ai" },
      ],
      undefined
    );
    assert.ok(ai.success);

    const history = await dashboardEngine.getCommandHistory(dashboardId);
    // Newest first.
    assert.equal(history[0]!.source, "ai");
    assert.equal(history[0]!.commands.length, 2);
    assert.match(history[0]!.summary, /2 changes/);

    assert.equal(history[1]!.source, "manual");
    assert.equal(history[1]!.commands.length, 1);
    assert.match(history[1]!.summary, /Created "Sales Chart" chart/);
  });

  it("computes a before/after diff for a single-visual command", async () => {
    const history = await dashboardEngine.getCommandHistory(dashboardId);
    const manualBatch = history.find((h) => h.source === "manual")!;

    const diff = await dashboardEngine.getBatchDiff(dashboardId, manualBatch.id);
    assert.ok(diff);
    assert.equal(diff.visualChanges.length, 1);
    assert.equal(diff.visualChanges[0]!.before, null, "the chart didn't exist beforehand");
    assert.equal(diff.visualChanges[0]!.after?.title, "Sales Chart");
  });

  it("returns null for a batch id that doesn't belong to this dashboard", async () => {
    const diff = await dashboardEngine.getBatchDiff(dashboardId, "not-a-real-batch-id");
    assert.equal(diff, null);
  });
});

// ─────────────────────────────────────────────
// The literal acceptance test
// ─────────────────────────────────────────────

describe("Acceptance: mixed manual+AI creates, undo x2, redo x1, new command discards redo", () => {
  let dashboardId: string;
  let datasetId: string;
  let pageId: string;

  before(async () => {
    ({ dashboardId, datasetId, pageId } = await makeDashboard("Acceptance Undo Redo"));
  });
  after(async () => cleanup(dashboardId, datasetId));

  it("walks the full scenario end to end", async () => {
    // ── 1. Create 3 charts via mixed manual + AI actions ──
    const manual1 = await dashboardEngine.applyAndPersist(dashboardId, {
      type: "CREATE_VISUAL",
      payload: { pageId, kind: "bar", title: "Sales by Region" } as never,
      origin: "user",
    });
    assert.ok(manual1.success);

    const ai = await dashboardEngine.executeBatch(
      dashboardId,
      [{ type: "create_chart", payload: { pageId, kind: "kpi", title: "Total Sales" }, origin: "ai" }],
      undefined
    );
    assert.ok(ai.success);

    const manual2 = await dashboardEngine.applyAndPersist(dashboardId, {
      type: "CREATE_VISUAL",
      payload: { pageId, kind: "line", title: "Sales Trend" } as never,
      origin: "user",
    });
    assert.ok(manual2.success);

    const afterThreeCreates = await visualTitles(dashboardId, pageId);
    assert.deepEqual(afterThreeCreates.sort(), ["Sales Trend", "Sales by Region", "Total Sales"].sort());

    // ── 2. Undo twice ──
    const undo1 = await dashboardEngine.undo(dashboardId);
    assert.ok(undo1.success);
    assert.deepEqual(await visualTitles(dashboardId, pageId), ["Sales by Region", "Total Sales"]);

    const undo2 = await dashboardEngine.undo(dashboardId);
    assert.ok(undo2.success);
    const stateAfterTwoUndos = undo2.dashboard;
    assert.deepEqual(await visualTitles(dashboardId, pageId), ["Sales by Region"]);

    // ── 3. Confirm state matches exactly (byte-identical to right after the first create) ──
    const expectedAfterTwoUndos = manual1.dashboard;
    assert.deepEqual(
      stateAfterTwoUndos.dashboard.pages[0]!.visuals,
      expectedAfterTwoUndos.dashboard.pages[0]!.visuals,
      "state after 2 undos must match the state right after the first create, exactly"
    );

    // ── 4. Redo once ──
    const redo1 = await dashboardEngine.redo(dashboardId);
    assert.ok(redo1.success);
    assert.deepEqual(await visualTitles(dashboardId, pageId), ["Sales by Region", "Total Sales"]);

    // ── 5. Confirm state matches (the AI-created KPI is back, byte-identical to right after it was created) ──
    assert.deepEqual(
      redo1.dashboard.dashboard.pages[0]!.visuals,
      ai.success ? ai.dashboard.dashboard.pages[0]!.visuals : null,
      "state after 1 redo must match the state right after the AI batch, exactly"
    );

    // ── 6. Apply a new command — the old redo path (Sales Trend) must be discarded ──
    const newCommand = await dashboardEngine.applyAndPersist(dashboardId, {
      type: "CREATE_VISUAL",
      payload: { pageId, kind: "table", title: "Detail Table" } as never,
      origin: "user",
    });
    assert.ok(newCommand.success);
    assert.deepEqual(
      (await visualTitles(dashboardId, pageId)).sort(),
      ["Detail Table", "Sales by Region", "Total Sales"].sort()
    );

    const redoAfterNewCommand = await dashboardEngine.redo(dashboardId);
    assert.equal(
      redoAfterNewCommand.success,
      false,
      "the discarded redo path ('Sales Trend') must not be redoable after a new command"
    );
    assert.equal(redoAfterNewCommand.errorCode, "NOTHING_TO_REDO");

    // "Sales Trend" must never come back, no matter how many more redos are attempted.
    const titlesFinal = await visualTitles(dashboardId, pageId);
    assert.ok(!titlesFinal.includes("Sales Trend"));
  });
});
