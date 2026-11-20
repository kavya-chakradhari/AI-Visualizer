/**
 * Unit tests for transactional command execution.
 *
 * The central guarantee under test: a batch is all-or-nothing. A failure at any
 * stage — schema, semantic, scope, execution, or the commit itself — must leave
 * the persisted dashboard byte-identical to how it started.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { executeCommandBatch } from "../transaction.js";
import type { BatchFailure, BatchSuccess } from "../transaction.js";
import {
  DASHBOARD_ID,
  DATASET_SCHEMA,
  PAGE_ID,
  VISUAL_ID,
  findVisual,
  makeFakeStore,
  makeState,
} from "./fixtures.js";

type Outcome = Awaited<ReturnType<typeof executeCommandBatch>>;

function expectSuccess(outcome: Outcome): BatchSuccess {
  assert.equal(
    outcome.success,
    true,
    `Expected success but got: ${JSON.stringify(outcome, null, 2)}`
  );
  return outcome as BatchSuccess;
}

function expectFailure(outcome: Outcome, stage?: BatchFailure["stage"]): BatchFailure {
  assert.equal(outcome.success, false, `Expected failure but got success`);
  const failure = outcome as BatchFailure;
  if (stage) {
    assert.equal(
      failure.stage,
      stage,
      `Expected stage '${stage}' but got '${failure.stage}': ${failure.message}`
    );
  }
  return failure;
}

const run = (store: ReturnType<typeof makeFakeStore>, commands: unknown[]) =>
  executeCommandBatch(DASHBOARD_ID, commands as never, {
    store,
    datasetSchema: DATASET_SCHEMA,
  });

// ─────────────────────────────────────────────

describe("transaction — successful execution", () => {
  it("applies a single valid command and commits it", async () => {
    const store = makeFakeStore();

    const result = expectSuccess(
      await run(store, [
        {
          type: "create_chart",
          payload: { pageId: PAGE_ID, kind: "line", title: "Revenue over Time" },
        },
      ])
    );

    assert.equal(result.executedCount, 1);
    assert.equal(store.commitAttempts, 1);
    assert.equal(store.persisted.dashboard.pages[0]!.visuals.length, 2);
    assert.equal(store.log.length, 1);
    assert.equal(store.log[0]!.type, "CREATE_VISUAL");
  });

  it("applies a multi-command batch in order, in one commit", async () => {
    const store = makeFakeStore();

    const result = expectSuccess(
      await run(store, [
        { type: "create_page", payload: { title: "Trends" } },
        { type: "rename_page", payload: { pageId: PAGE_ID, title: "Overview" } },
        {
          type: "change_chart_type",
          payload: { pageId: PAGE_ID, visualId: VISUAL_ID, kind: "area" },
        },
      ])
    );

    assert.equal(result.executedCount, 3);
    // One commit for the whole batch, not one per command.
    assert.equal(store.commitAttempts, 1);
    assert.equal(store.persisted.dashboard.pages.length, 2);
    assert.equal(store.persisted.dashboard.pages[0]!.title, "Overview");
    assert.equal(findVisual(store.persisted)!.kind, "area");
  });

  it("validates later commands against the state earlier ones produced", async () => {
    const store = makeFakeStore();
    const newPageId = "page_created_in_batch";

    expectSuccess(
      await run(store, [
        { type: "create_page", payload: { pageId: newPageId, title: "New" } },
        // This page does not exist until the command above runs.
        {
          type: "create_chart",
          payload: { pageId: newPageId, kind: "kpi", title: "Total Revenue" },
        },
      ])
    );

    const created = store.persisted.dashboard.pages.find((p) => p.id === newPageId);
    assert.ok(created, "the page created mid-batch should be persisted");
    assert.equal(created.visuals.length, 1);
  });

  it("assigns contiguous sequence numbers continuing the existing log", async () => {
    const initial = makeState();
    initial.commandLogLength = 7;
    const store = makeFakeStore(initial);

    const result = expectSuccess(
      await run(store, [
        { type: "rename_page", payload: { pageId: PAGE_ID, title: "A" } },
        { type: "rename_page", payload: { pageId: PAGE_ID, title: "B" } },
      ])
    );

    assert.deepEqual(
      result.applied.map((c) => c.sequenceNumber),
      [8, 9]
    );
  });

  it("stamps the schema version and origin on every persisted command", async () => {
    const store = makeFakeStore();

    const result = expectSuccess(
      await run(store, [
        {
          type: "update_dashboard_meta",
          payload: { title: "Q4 Review" },
          origin: "ai",
          prompt: "rename the dashboard to Q4 Review",
        },
      ])
    );

    const command = result.applied[0]!;
    assert.equal(command.origin, "ai");
    assert.equal(command.prompt, "rename the dashboard to Q4 Review");
    assert.equal(command.schemaVersion, 1);
  });

  it("flattens a nested BATCH_COMMANDS envelope into individual commands", async () => {
    const store = makeFakeStore();

    const result = expectSuccess(
      await run(store, [
        {
          type: "batch_commands",
          payload: {
            commands: [
              { type: "rename_page", payload: { pageId: PAGE_ID, title: "Flattened" } },
              { type: "create_page", payload: { title: "Second" } },
            ],
          },
        },
      ])
    );

    assert.equal(result.executedCount, 2, "nested commands should be counted individually");
    assert.equal(store.log.length, 2);
  });
});

// ─────────────────────────────────────────────
// Rollback
// ─────────────────────────────────────────────

describe("transaction — rollback on partial failure", () => {
  it("discards the whole batch when a later command fails validation", async () => {
    const store = makeFakeStore();
    const before = structuredClone(store.persisted);

    const failure = expectFailure(
      await run(store, [
        // 1: valid — renames the page.
        { type: "rename_page", payload: { pageId: PAGE_ID, title: "Renamed" } },
        // 2: valid — moves the chart.
        { type: "move_visual", payload: { pageId: PAGE_ID, visualId: VISUAL_ID, x: 3, y: 2 } },
        // 3: INVALID — this visual does not exist.
        { type: "delete_visual", payload: { pageId: PAGE_ID, visualId: "does_not_exist" } },
      ]),
      "semantic"
    );

    assert.equal(failure.commandIndex, 2, "should point at the offending command");
    assert.equal(failure.rolledBack, true);
    assert.equal(failure.discardedCount, 2, "the two applied commands were discarded");

    // Nothing was written at all.
    assert.equal(store.commitAttempts, 0, "commit must not be attempted for a failed batch");
    assert.equal(store.log.length, 0);
    assert.deepEqual(
      store.persisted,
      before,
      "persisted state must be byte-identical to the pre-batch snapshot"
    );

    // Specifically: the two commands that *did* succeed left no trace.
    assert.equal(store.persisted.dashboard.pages[0]!.title, "Page 1");
    assert.equal(findVisual(store.persisted)!.layout.x, 0);
  });

  it("discards the whole batch when a later command fails at the schema stage", async () => {
    const store = makeFakeStore();
    const before = structuredClone(store.persisted);

    const failure = expectFailure(
      await run(store, [
        { type: "rename_page", payload: { pageId: PAGE_ID, title: "Renamed" } },
        { type: "create_chart", payload: { pageId: PAGE_ID, kind: "hologram", title: "X" } },
      ]),
      "schema"
    );

    assert.equal(failure.commandIndex, 1);
    assert.deepEqual(store.persisted, before);
    assert.equal(store.commitAttempts, 0);
  });

  it("discards the whole batch when a later command fails at the scope stage", async () => {
    const store = makeFakeStore();
    const before = structuredClone(store.persisted);

    const failure = expectFailure(
      await run(store, [
        { type: "rename_page", payload: { pageId: PAGE_ID, title: "Renamed" } },
        // Page-scoped command wrongly targeting a single visual.
        {
          type: "add_filter",
          payload: {
            scope: "page",
            pageId: PAGE_ID,
            visualId: VISUAL_ID,
            filter: { field: "region", operator: "eq", value: "EMEA" },
          },
        },
      ]),
      "scope"
    );

    assert.equal(failure.commandIndex, 1);
    assert.deepEqual(store.persisted, before);
    assert.equal(store.commitAttempts, 0);
  });

  it("discards the whole batch when the reducer throws during execution", async () => {
    const store = makeFakeStore();
    const before = structuredClone(store.persisted);

    // Creating the measure succeeds; creating it a second time throws in the
    // reducer. (The duplicate is invisible to semantic validation of command 1,
    // which sees the pre-batch state.)
    const failure = expectFailure(
      await run(store, [
        { type: "create_measure", payload: { name: "margin", expression: "revenue * 0.3" } },
        { type: "create_measure", payload: { name: "margin", expression: "revenue * 0.4" } },
      ])
    );

    assert.equal(failure.commandIndex, 1);
    assert.equal(failure.rolledBack, true);
    assert.deepEqual(store.persisted, before);
    assert.equal(store.commitAttempts, 0);
    assert.equal(
      store.persisted.dashboard.calculatedFields?.length ?? 0,
      0,
      "the first measure must not survive the failed batch"
    );
  });

  it("leaves state untouched when the commit itself fails", async () => {
    const store = makeFakeStore(makeState(), { failCommit: true });
    const before = structuredClone(store.persisted);

    const failure = expectFailure(
      await run(store, [
        { type: "rename_page", payload: { pageId: PAGE_ID, title: "Renamed" } },
        { type: "create_page", payload: { title: "Second" } },
      ]),
      "persistence"
    );

    assert.equal(failure.rolledBack, true);
    assert.equal(failure.discardedCount, 2);
    assert.equal(store.commitAttempts, 1, "commit should have been attempted once");
    assert.equal(store.log.length, 0, "no commands should be logged");
    assert.deepEqual(store.persisted, before);

    // The caller is handed the pre-batch state to restore its cache from.
    assert.deepEqual(failure.dashboard, before);
  });

  it("rejects an empty batch without touching the store", async () => {
    const store = makeFakeStore();
    expectFailure(await run(store, []), "schema");
    assert.equal(store.commitAttempts, 0);
  });

  it("reports a missing dashboard rather than throwing", async () => {
    const store = makeFakeStore();
    // Override load to simulate a dashboard that does not exist.
    const missing = { ...store, load: async () => null };

    const failure = expectFailure(
      await executeCommandBatch("no_such_dashboard", [
        { type: "rename_page", payload: { pageId: PAGE_ID, title: "X" } },
      ], { store: missing }),
      "semantic"
    );
    assert.match(failure.message, /not found/i);
  });

  it("does not let a failed batch mutate the caller's input state", async () => {
    const initial = makeState();
    const store = makeFakeStore(initial);
    const snapshotOfInput = structuredClone(initial);

    expectFailure(
      await run(store, [
        { type: "rename_page", payload: { pageId: PAGE_ID, title: "Renamed" } },
        { type: "delete_visual", payload: { pageId: PAGE_ID, visualId: "ghost" } },
      ])
    );

    assert.deepEqual(initial, snapshotOfInput, "the input state must not be mutated");
  });
});

// ─────────────────────────────────────────────
// Reducer effects reached through the pipeline
// ─────────────────────────────────────────────

describe("transaction — command effects", () => {
  it("applies filters at the scope they declare", async () => {
    const store = makeFakeStore();

    expectSuccess(
      await run(store, [
        {
          type: "add_filter",
          payload: {
            scope: "dashboard",
            filter: { field: "region", operator: "eq", value: "EMEA" },
          },
        },
        {
          type: "add_filter",
          payload: {
            scope: "page",
            pageId: PAGE_ID,
            filter: { field: "category", operator: "in", value: ["A", "B"] },
          },
        },
        {
          type: "add_filter",
          payload: {
            scope: "visual",
            pageId: PAGE_ID,
            visualId: VISUAL_ID,
            filter: { field: "revenue", operator: "gt", value: 1000 },
          },
        },
      ])
    );

    const { dashboard } = store.persisted;
    assert.equal(dashboard.filters?.length, 1);
    assert.equal(dashboard.filters![0]!.field, "region");
    assert.equal(dashboard.pages[0]!.filters?.length, 1);
    assert.equal(dashboard.pages[0]!.filters![0]!.field, "category");
    assert.equal(findVisual(store.persisted)!.filters?.length, 1);
  });

  it("merges style at the visual scope without clobbering existing keys", async () => {
    const initial = makeState();
    initial.dashboard.pages[0]!.visuals[0]!.style = { opacity: 1, background: "#000000" };
    const store = makeFakeStore(initial);

    expectSuccess(
      await run(store, [
        {
          type: "update_style",
          payload: {
            scope: "visual",
            pageId: PAGE_ID,
            visualId: VISUAL_ID,
            style: { opacity: 0.5 },
          },
        },
      ])
    );

    const style = findVisual(store.persisted)!.style;
    assert.equal(style.opacity, 0.5, "the provided key should be updated");
    assert.equal(style.background, "#000000", "untouched keys should survive the merge");
  });

  it("replaces style wholesale when replace is set", async () => {
    const initial = makeState();
    initial.dashboard.pages[0]!.visuals[0]!.style = { opacity: 1, background: "#000000" };
    const store = makeFakeStore(initial);

    expectSuccess(
      await run(store, [
        {
          type: "update_style",
          payload: {
            scope: "visual",
            pageId: PAGE_ID,
            visualId: VISUAL_ID,
            style: { opacity: 0.5 },
            replace: true,
          },
        },
      ])
    );

    assert.deepEqual(findVisual(store.persisted)!.style, { opacity: 0.5 });
  });

  it("retargets a dimension and rewrites a measure", async () => {
    const store = makeFakeStore();

    expectSuccess(
      await run(store, [
        {
          type: "change_dimension",
          payload: { pageId: PAGE_ID, visualId: VISUAL_ID, slot: "x", field: "category" },
        },
        {
          type: "change_measure",
          payload: {
            pageId: PAGE_ID,
            visualId: VISUAL_ID,
            field: "units_sold",
            aggregation: "average",
          },
        },
      ])
    );

    const encoding = findVisual(store.persisted)!.encoding;
    assert.equal(encoding.xField, "category");
    assert.deepEqual(encoding.measures, [{ field: "units_sold", aggregation: "avg" }]);
  });

  it("changes the aggregation of every measure when no index is given", async () => {
    const initial = makeState();
    initial.dashboard.pages[0]!.visuals[0]!.encoding.measures = [
      { field: "revenue", aggregation: "sum" },
      { field: "units_sold", aggregation: "sum" },
    ];
    const store = makeFakeStore(initial);

    expectSuccess(
      await run(store, [
        {
          type: "change_aggregation",
          payload: { pageId: PAGE_ID, visualId: VISUAL_ID, aggregation: "max" },
        },
      ])
    );

    assert.deepEqual(
      findVisual(store.persisted)!.encoding.measures!.map((m) => m.aggregation),
      ["max", "max"]
    );
  });

  it("lets a batch attach a dataset and immediately create a chart against it", async () => {
    const store = makeFakeStore();

    const result = expectSuccess(
      await run(store, [
        { type: "attach_dataset", payload: { datasetId: "dataset_2" } },
        {
          type: "create_chart",
          payload: { pageId: PAGE_ID, kind: "bar", title: "New", datasetId: "dataset_2" },
        },
      ])
    );

    assert.deepEqual(result.dashboard.dashboard.datasetIds, ["dataset_1", "dataset_2"]);
    const created = result.dashboard.dashboard.pages[0]!.visuals.find((v) => v.title === "New");
    assert.equal(created?.datasetId, "dataset_2");
  });

  it("bumps the dashboard version once per applied command", async () => {
    const store = makeFakeStore();
    const startVersion = store.persisted.dashboard.version;

    const result = expectSuccess(
      await run(store, [
        { type: "rename_page", payload: { pageId: PAGE_ID, title: "A" } },
        { type: "rename_page", payload: { pageId: PAGE_ID, title: "B" } },
        { type: "rename_page", payload: { pageId: PAGE_ID, title: "C" } },
      ])
    );

    assert.equal(result.dashboard.dashboard.version, startVersion + 3);
  });
});
