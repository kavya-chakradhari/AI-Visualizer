/**
 * Shared fixtures for the command validation + transaction tests.
 *
 * Everything here is in-memory: the validation engine and the batch executor are
 * pure with respect to persistence (the executor talks to a `CommandBatchStore`
 * interface), so the whole pipeline is testable without a database.
 */
import { createEmptyDashboardState } from "@ai-vis/types";
import type {
  ColumnProfile,
  Command,
  DashboardState,
  Visual,
} from "@ai-vis/types";
import type { CommandBatchStore } from "../transaction.js";

export const DASHBOARD_ID = "dash_test_1";
export const PAGE_ID = "page_1";
export const VISUAL_ID = "visual_1";
export const SECOND_PAGE_ID = "page_2";

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
    uniqueCount: dataType === "number" ? 100 : 5,
    cardinalityRatio: dataType === "number" ? 1 : 0.05,
    sampleValues: [],
  };
}

/** Column profiles standing in for a parsed sales dataset. */
export const DATASET_SCHEMA: ColumnProfile[] = [
  column("region", "string", "categorical"),
  column("revenue", "number", "currency"),
  column("order_date", "date", "date"),
  column("units_sold", "number", "numeric"),
  column("category", "string", "categorical"),
];

function makeVisual(overrides: Partial<Visual> = {}): Visual {
  const ts = "2026-01-01T00:00:00.000Z";
  return {
    id: VISUAL_ID,
    pageId: PAGE_ID,
    title: "Revenue by Region",
    kind: "bar",
    type: "bar",
    layout: { x: 0, y: 0, width: 6, height: 4, zIndex: 0 },
    encoding: {
      xField: "region",
      measures: [{ field: "revenue", aggregation: "sum" }],
    },
    style: {},
    filters: [],
    calculatedFields: [],
    createdAt: ts,
    updatedAt: ts,
    ...overrides,
  } as Visual;
}

/**
 * A dashboard with one page holding one bar chart. Pass `pages: 2` for a second
 * empty page (used by the multi-page / rollback tests).
 */
export function makeState(
  options: { pages?: number; visuals?: Visual[] } = {}
): DashboardState {
  const state = createEmptyDashboardState(DASHBOARD_ID, "Test Dashboard");
  const ts = "2026-01-01T00:00:00.000Z";

  const firstPage = state.dashboard.pages[0]!;
  firstPage.id = PAGE_ID;
  firstPage.title = "Page 1";
  firstPage.visuals = options.visuals ?? [makeVisual()];

  state.dashboard.activePageId = PAGE_ID;
  state.dashboard.datasetId = "dataset_1";
  state.dashboard.datasetIds = ["dataset_1"];

  if ((options.pages ?? 1) > 1) {
    state.dashboard.pages.push({
      id: SECOND_PAGE_ID,
      dashboardId: DASHBOARD_ID,
      title: "Page 2",
      order: 1,
      layoutConfig: { columns: 12, rowHeight: 50, margin: [10, 10] },
      visuals: [],
      createdAt: ts,
      updatedAt: ts,
    });
  }

  return state;
}

/** A second dataset's columns — disjoint from DATASET_SCHEMA, for multi-dataset tests. */
export const DATASET_SCHEMA_2: ColumnProfile[] = [
  column("campaign", "string", "categorical"),
  column("clicks", "number", "numeric"),
];

export const validationContext = (state = makeState()) => ({
  dashboardState: state,
  datasetSchema: DATASET_SCHEMA,
  datasetSchemasById: new Map([
    ["dataset_1", DATASET_SCHEMA],
    ["dataset_2", DATASET_SCHEMA_2],
  ]),
  knownDatasetIds: new Set(["dataset_1", "dataset_2"]),
});

// ─────────────────────────────────────────────
// In-memory CommandBatchStore
// ─────────────────────────────────────────────

export interface FakeStore extends CommandBatchStore {
  /** The state as "persisted". Assertions read this to prove rollback worked. */
  readonly persisted: DashboardState;
  /** Commands written by committed batches. */
  readonly log: Command[];
  /** Number of times commit() was called, including failures. */
  readonly commitAttempts: number;
}

/**
 * A CommandBatchStore backed by a plain object.
 *
 * `failCommit` makes commit throw, standing in for a database transaction that
 * rolls back — the store's contents are left untouched, exactly as Prisma's
 * `$transaction` would leave the real database.
 */
export function makeFakeStore(
  initial: DashboardState = makeState(),
  options: { failCommit?: boolean } = {}
): FakeStore {
  let persisted = structuredClone(initial);
  const log: Command[] = [];
  let commitAttempts = 0;

  return {
    get persisted() {
      return persisted;
    },
    get log() {
      return log;
    },
    get commitAttempts() {
      return commitAttempts;
    },

    async load() {
      return structuredClone(persisted);
    },

    async commit(_dashboardId, _previous, next, applied) {
      commitAttempts++;
      if (options.failCommit) {
        // Throw *before* mutating anything, mirroring an aborted transaction.
        throw new Error("Simulated database transaction failure.");
      }
      persisted = structuredClone(next);
      log.push(...applied);
    },
  };
}

/** Convenience: locate a visual in a state by id. */
export function findVisual(
  state: DashboardState,
  visualId = VISUAL_ID,
  pageId = PAGE_ID
): Visual | undefined {
  return state.dashboard.pages
    .find((p) => p.id === pageId)
    ?.visuals.find((v) => v.id === visualId);
}
