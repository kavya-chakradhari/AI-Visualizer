/**
 * Scope-precision tests for update_style, run through the real batch
 * pipeline (schema -> semantic -> scope -> execution), exactly as a manual
 * edit or an AI command would be.
 *
 * The three levels are NOT "the same write, guarded by a check" — they are
 * genuinely different code paths in the reducer (see reducer.ts's
 * UPDATE_STYLE handler), which is what makes these guarantees hold by
 * construction:
 *   - visual: rewrites exactly one visual.
 *   - page: rewrites every visual CURRENTLY on one page — no other page's
 *     visuals are even read.
 *   - dashboard: rewrites dashboard.theme — no page or visual is read at all.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { executeCommandBatch } from "../transaction.js";
import { DASHBOARD_ID, DATASET_SCHEMA, makeFakeStore, makeState } from "./fixtures.js";
import type { DashboardState } from "@ai-vis/types";

const PAGE_A = "page_a";
const PAGE_B = "page_b";
const VISUAL_A1 = "visual_a1";
const VISUAL_A2 = "visual_a2";
const VISUAL_B1 = "visual_b1";
const VISUAL_B2 = "visual_b2";

/** A dashboard with 2 pages, 2 visuals each — nobody's original bar chart included. */
function makeMultiPageState(): DashboardState {
  const state = makeState({ visuals: [] });
  const ts = "2026-01-01T00:00:00.000Z";

  function visual(id: string, pageId: string, title: string) {
    return {
      id,
      pageId,
      title,
      kind: "bar" as const,
      type: "bar" as const,
      layout: { x: 0, y: 0, width: 6, height: 4, zIndex: 0 },
      encoding: { xField: "region", measures: [{ field: "revenue", aggregation: "sum" as const }] },
      style: {},
      filters: [],
      calculatedFields: [],
      createdAt: ts,
      updatedAt: ts,
    };
  }

  state.dashboard.pages = [
    {
      id: PAGE_A,
      dashboardId: DASHBOARD_ID,
      title: "Page A",
      order: 0,
      layoutConfig: { columns: 12, rowHeight: 50, margin: [10, 10] },
      visuals: [visual(VISUAL_A1, PAGE_A, "A1"), visual(VISUAL_A2, PAGE_A, "A2")],
      createdAt: ts,
      updatedAt: ts,
    },
    {
      id: PAGE_B,
      dashboardId: DASHBOARD_ID,
      title: "Page B",
      order: 1,
      layoutConfig: { columns: 12, rowHeight: 50, margin: [10, 10] },
      visuals: [visual(VISUAL_B1, PAGE_B, "B1"), visual(VISUAL_B2, PAGE_B, "B2")],
      createdAt: ts,
      updatedAt: ts,
    },
  ];
  state.dashboard.activePageId = PAGE_A;

  return state;
}

async function run(state: DashboardState, commands: unknown[]) {
  const store = makeFakeStore(state);
  const outcome = await executeCommandBatch(DASHBOARD_ID, commands as never, {
    store,
    datasetSchema: DATASET_SCHEMA,
  });
  return { outcome, store };
}

function visualOf(state: DashboardState, id: string) {
  for (const page of state.dashboard.pages) {
    const v = page.visuals.find((v) => v.id === id);
    if (v) return v;
  }
  throw new Error(`visual ${id} not found`);
}

describe("update_style scope precision — visual", () => {
  it("changes exactly the target visual; every sibling on the same page is untouched", async () => {
    const before = makeMultiPageState();
    const { outcome, store } = await run(before, [
      {
        type: "update_style",
        payload: { scope: "visual", pageId: PAGE_A, visualId: VISUAL_A1, style: { colors: ["#ff0000"] } },
      },
    ]);
    assert.ok(outcome.success, (outcome as never as { message?: string }).message);

    const after = store.persisted;
    assert.deepEqual(visualOf(after, VISUAL_A1).style, { colors: ["#ff0000"] });

    // Every other visual — same page and the other page — is byte-identical to before.
    assert.deepEqual(visualOf(after, VISUAL_A2), visualOf(before, VISUAL_A2));
    assert.deepEqual(visualOf(after, VISUAL_B1), visualOf(before, VISUAL_B1));
    assert.deepEqual(visualOf(after, VISUAL_B2), visualOf(before, VISUAL_B2));
  });

  it("never touches the dashboard theme", async () => {
    const before = makeMultiPageState();
    const { store } = await run(before, [
      { type: "update_style", payload: { scope: "visual", pageId: PAGE_A, visualId: VISUAL_A1, style: { opacity: 0.5 } } },
    ]);
    assert.deepEqual(store.persisted.dashboard.theme, before.dashboard.theme);
  });
});

describe("update_style scope precision — page", () => {
  it("changes every visual on the target page; the other page is completely untouched", async () => {
    const before = makeMultiPageState();
    const { outcome, store } = await run(before, [
      { type: "update_style", payload: { scope: "page", pageId: PAGE_A, style: { colors: ["#00ff00"] } } },
    ]);
    assert.ok(outcome.success, (outcome as never as { message?: string }).message);

    const after = store.persisted;
    assert.deepEqual(visualOf(after, VISUAL_A1).style, { colors: ["#00ff00"] });
    assert.deepEqual(visualOf(after, VISUAL_A2).style, { colors: ["#00ff00"] });

    // Page B — a completely different page — must not see this change at all.
    assert.deepEqual(visualOf(after, VISUAL_B1), visualOf(before, VISUAL_B1));
    assert.deepEqual(visualOf(after, VISUAL_B2), visualOf(before, VISUAL_B2));
    const pageB = after.dashboard.pages.find((p) => p.id === PAGE_B)!;
    const pageBBefore = before.dashboard.pages.find((p) => p.id === PAGE_B)!;
    assert.deepEqual(pageB.visuals, pageBBefore.visuals);
  });

  it("never touches the dashboard theme", async () => {
    const before = makeMultiPageState();
    const { store } = await run(before, [
      { type: "update_style", payload: { scope: "page", pageId: PAGE_A, style: { background: "#111" } } },
    ]);
    assert.deepEqual(store.persisted.dashboard.theme, before.dashboard.theme);
  });

  it("does not retroactively apply to a visual created on that page afterward", async () => {
    // Page-level style is a one-time write to the visuals present at that
    // moment, not a standing cascade rule — a later CREATE_VISUAL on the same
    // page must start from a clean style, not inherit the earlier page-wide change.
    const before = makeMultiPageState();
    const { outcome, store } = await run(before, [
      { type: "update_style", payload: { scope: "page", pageId: PAGE_A, style: { colors: ["#00ff00"] } } },
      { type: "create_chart", payload: { pageId: PAGE_A, kind: "bar", title: "New on A" } },
    ]);
    assert.ok(outcome.success, (outcome as never as { message?: string }).message);

    const pageA = store.persisted.dashboard.pages.find((p) => p.id === PAGE_A)!;
    const newVisual = pageA.visuals.find((v) => v.title === "New on A")!;
    assert.deepEqual(newVisual.style, {}, "a visual created after a page-level style change starts unstyled");
  });
});

describe("update_style scope precision — dashboard", () => {
  it("changes the dashboard theme and nothing else — no page or visual is touched", async () => {
    const before = makeMultiPageState();
    const { outcome, store } = await run(before, [
      { type: "update_style", payload: { scope: "dashboard", style: { primary: "#123456" } } },
    ]);
    assert.ok(outcome.success, (outcome as never as { message?: string }).message);

    const after = store.persisted;
    assert.equal(after.dashboard.theme?.primary, "#123456");
    // Every other theme field survives untouched (a merge, not a replace).
    assert.equal(after.dashboard.theme?.background, before.dashboard.theme?.background);
    assert.equal(after.dashboard.theme?.chartPalette.length, before.dashboard.theme?.chartPalette.length);

    // No visual anywhere was touched.
    for (const id of [VISUAL_A1, VISUAL_A2, VISUAL_B1, VISUAL_B2]) {
      assert.deepEqual(visualOf(after, id), visualOf(before, id));
    }
  });

  it("deep-merges fontSizes/spacingScale instead of clobbering the rest of the scale", async () => {
    const before = makeMultiPageState();
    const { store } = await run(before, [
      { type: "update_style", payload: { scope: "dashboard", style: { fontSizes: { base: 18 } } } },
    ]);
    const theme = store.persisted.dashboard.theme!;
    assert.equal(theme.fontSizes.base, 18);
    // Every other step of the scale must still be present.
    assert.equal(theme.fontSizes.xs, before.dashboard.theme!.fontSizes.xs);
    assert.equal(theme.fontSizes.xxl, before.dashboard.theme!.fontSizes.xxl);
  });

  it("rejects a dashboard-scoped payload that names a page or a visual", async () => {
    const before = makeMultiPageState();
    const { outcome } = await run(before, [
      { type: "update_style", payload: { scope: "dashboard", pageId: PAGE_A, style: { primary: "#000" } } },
    ]);
    assert.equal(outcome.success, false);
  });
});
