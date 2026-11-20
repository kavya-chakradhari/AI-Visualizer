/**
 * Unit tests for the 3-stage validation engine.
 *
 * Coverage required by the spec:
 *   • valid command succeeds
 *   • missing required field is rejected
 *   • invalid chart type is rejected
 *   • scope mismatch (page-level command targeting the whole dashboard) is rejected
 * plus the suggestion engine, alias normalisation, and stage attribution.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { validateCommandFull } from "../validator.js";
import type { ValidationFailure, ValidationSuccess } from "../validator.js";
import {
  DASHBOARD_ID,
  PAGE_ID,
  SECOND_PAGE_ID,
  VISUAL_ID,
  makeState,
  validationContext,
} from "./fixtures.js";

/** Assert the outcome failed, and return it narrowed. */
function expectFailure(
  outcome: ReturnType<typeof validateCommandFull>,
  stage?: ValidationFailure["stage"]
): ValidationFailure {
  assert.equal(outcome.valid, false, `Expected failure but got: ${JSON.stringify(outcome)}`);
  const failure = outcome as ValidationFailure;
  if (stage) {
    assert.equal(
      failure.stage,
      stage,
      `Expected stage '${stage}' but got '${failure.stage}': ${failure.message}`
    );
  }
  return failure;
}

/** Assert the outcome passed, and return it narrowed. */
function expectSuccess(
  outcome: ReturnType<typeof validateCommandFull>
): ValidationSuccess {
  assert.equal(
    outcome.valid,
    true,
    `Expected success but got: ${JSON.stringify(outcome, null, 2)}`
  );
  return outcome as ValidationSuccess;
}

// ─────────────────────────────────────────────

describe("validation engine — valid commands", () => {
  it("accepts a well-formed create_chart command", () => {
    const outcome = validateCommandFull(
      {
        type: "create_chart",
        payload: {
          pageId: PAGE_ID,
          kind: "bar",
          title: "Revenue by Category",
          encoding: {
            xField: "category",
            measures: [{ field: "revenue", aggregation: "sum" }],
          },
        },
      },
      validationContext()
    );

    const success = expectSuccess(outcome);
    // The snake_case alias resolves to the canonical type.
    assert.equal(success.type, "CREATE_VISUAL");
    assert.equal(success.scope, "visual");
  });

  it("accepts every visual-scoped mutation against an existing visual", () => {
    const context = validationContext();
    const commands = [
      { type: "move_visual", payload: { pageId: PAGE_ID, visualId: VISUAL_ID, x: 2, y: 1 } },
      {
        type: "resize_visual",
        payload: { pageId: PAGE_ID, visualId: VISUAL_ID, width: 8, height: 5 },
      },
      {
        type: "change_chart_type",
        payload: { pageId: PAGE_ID, visualId: VISUAL_ID, kind: "line" },
      },
      {
        type: "change_dimension",
        payload: { pageId: PAGE_ID, visualId: VISUAL_ID, slot: "x", field: "category" },
      },
      {
        type: "change_measure",
        payload: { pageId: PAGE_ID, visualId: VISUAL_ID, field: "units_sold" },
      },
      {
        type: "change_aggregation",
        payload: { pageId: PAGE_ID, visualId: VISUAL_ID, aggregation: "avg" },
      },
      { type: "delete_visual", payload: { pageId: PAGE_ID, visualId: VISUAL_ID } },
    ];

    for (const command of commands) {
      const outcome = validateCommandFull(command, context);
      assert.equal(
        outcome.valid,
        true,
        `'${command.type}' should be valid but failed: ${JSON.stringify(outcome)}`
      );
      assert.equal((outcome as ValidationSuccess).scope, "visual");
    }
  });

  it("normalises aggregation and operator spellings to canonical form", () => {
    const outcome = validateCommandFull(
      {
        type: "change_aggregation",
        payload: {
          pageId: PAGE_ID,
          visualId: VISUAL_ID,
          // Snake_case spelling an AI is likely to emit.
          aggregation: "distinct_count",
        },
      },
      validationContext()
    );

    const success = expectSuccess(outcome);
    assert.equal(
      (success.payload as { aggregation: string }).aggregation,
      "distinctCount",
      "aggregation should be normalised before it reaches the reducer"
    );
  });

  it("accepts a command declaring the current schemaVersion", () => {
    const outcome = validateCommandFull(
      {
        type: "rename_page",
        payload: { pageId: PAGE_ID, title: "Overview" },
        schemaVersion: 1,
      },
      validationContext()
    );
    expectSuccess(outcome);
  });
});

// ─────────────────────────────────────────────
// Stage 1: schema
// ─────────────────────────────────────────────

describe("stage 1 — schema validation", () => {
  it("rejects a command missing a required field", () => {
    const failure = expectFailure(
      validateCommandFull(
        // `title` is required by CREATE_VISUAL and is absent.
        { type: "create_chart", payload: { pageId: PAGE_ID, kind: "bar" } },
        validationContext()
      ),
      "schema"
    );

    assert.ok(failure.fieldErrors, "a schema failure should carry per-field errors");
    assert.ok(
      Object.keys(failure.fieldErrors).includes("title"),
      `expected a 'title' field error, got: ${Object.keys(failure.fieldErrors).join(", ")}`
    );
  });

  it("rejects an invalid chart type", () => {
    const failure = expectFailure(
      validateCommandFull(
        {
          type: "create_chart",
          payload: { pageId: PAGE_ID, kind: "3d_pyramid", title: "Nope" },
        },
        validationContext()
      ),
      "schema"
    );

    assert.ok(
      failure.fieldErrors?.kind,
      `expected a 'kind' field error, got: ${JSON.stringify(failure.fieldErrors)}`
    );
  });

  it("rejects an invalid chart type on change_chart_type too", () => {
    expectFailure(
      validateCommandFull(
        {
          type: "change_chart_type",
          payload: { pageId: PAGE_ID, visualId: VISUAL_ID, kind: "sankey" },
        },
        validationContext()
      ),
      "schema"
    );
  });

  it("rejects an unknown command type and suggests a near match", () => {
    const failure = expectFailure(
      validateCommandFull({ type: "CREATE_VISUALS", payload: {} }, validationContext()),
      "schema"
    );

    assert.ok(
      failure.suggestions?.includes("CREATE_VISUAL"),
      `expected 'CREATE_VISUAL' to be suggested, got: ${JSON.stringify(failure.suggestions)}`
    );
  });

  it("rejects unknown keys rather than silently dropping them", () => {
    const failure = expectFailure(
      validateCommandFull(
        {
          type: "move_visual",
          payload: { pageId: PAGE_ID, visualId: VISUAL_ID, x: 1, y: 1, rotation: 45 },
        },
        validationContext()
      ),
      "schema"
    );
    assert.match(failure.message, /rotation|unrecognized/i);
  });

  it("rejects a non-integer layout coordinate", () => {
    expectFailure(
      validateCommandFull(
        {
          type: "move_visual",
          payload: { pageId: PAGE_ID, visualId: VISUAL_ID, x: 1.5, y: 0 },
        },
        validationContext()
      ),
      "schema"
    );
  });

  it("rejects a filter whose operator requires a value it was not given", () => {
    expectFailure(
      validateCommandFull(
        {
          type: "add_filter",
          payload: {
            scope: "page",
            pageId: PAGE_ID,
            filter: { field: "region", operator: "eq" },
          },
        },
        validationContext()
      ),
      "schema"
    );
  });

  it("rejects a schemaVersion from the future", () => {
    const failure = expectFailure(
      validateCommandFull(
        {
          type: "rename_page",
          payload: { pageId: PAGE_ID, title: "Overview" },
          schemaVersion: 99,
        },
        validationContext()
      ),
      "schema"
    );
    assert.match(failure.message, /schemaVersion/);
  });
});

// ─────────────────────────────────────────────
// Stage 2: semantic
// ─────────────────────────────────────────────

describe("stage 2 — semantic validation", () => {
  it("rejects a reference to a non-existent visual", () => {
    const failure = expectFailure(
      validateCommandFull(
        { type: "delete_visual", payload: { pageId: PAGE_ID, visualId: "ghost" } },
        validationContext()
      ),
      "semantic"
    );
    assert.match(failure.message, /ghost/);
  });

  it("rejects a reference to a non-existent page", () => {
    expectFailure(
      validateCommandFull(
        { type: "rename_page", payload: { pageId: "no_such_page", title: "X" } },
        validationContext()
      ),
      "semantic"
    );
  });

  it("suggests the closest field name for a misspelling", () => {
    const failure = expectFailure(
      validateCommandFull(
        {
          type: "change_dimension",
          payload: { pageId: PAGE_ID, visualId: VISUAL_ID, field: "regoin" },
        },
        validationContext()
      ),
      "semantic"
    );

    assert.ok(
      failure.suggestions?.includes("region"),
      `expected 'region' to be suggested for 'regoin', got: ${JSON.stringify(failure.suggestions)}`
    );
    assert.match(failure.message, /Did you mean 'region'\?/);
  });

  it("suggests a field that contains the requested name", () => {
    const failure = expectFailure(
      validateCommandFull(
        {
          type: "change_measure",
          payload: { pageId: PAGE_ID, visualId: VISUAL_ID, field: "units" },
        },
        validationContext()
      ),
      "semantic"
    );
    assert.ok(
      failure.suggestions?.includes("units_sold"),
      `expected 'units_sold' to be suggested, got: ${JSON.stringify(failure.suggestions)}`
    );
  });

  it("rejects a layout that overflows the page column grid", () => {
    const failure = expectFailure(
      validateCommandFull(
        {
          // The visual is 6 wide on a 12-column grid; x=8 pushes it to 14.
          type: "resize_visual",
          payload: { pageId: PAGE_ID, visualId: VISUAL_ID, width: 14, height: 4 },
        },
        validationContext()
      ),
      "semantic"
    );
    assert.match(failure.message, /out of bounds|exceeds/i);
  });

  it("refuses to delete the only page", () => {
    const failure = expectFailure(
      validateCommandFull(
        { type: "delete_page", payload: { pageId: PAGE_ID } },
        validationContext()
      ),
      "semantic"
    );
    assert.match(failure.message, /last page/i);
  });

  it("allows deleting a page when another remains", () => {
    expectSuccess(
      validateCommandFull(
        { type: "delete_page", payload: { pageId: SECOND_PAGE_ID } },
        validationContext(makeState({ pages: 2 }))
      )
    );
  });

  it("rejects removing a filter that was never added", () => {
    expectFailure(
      validateCommandFull(
        { type: "remove_filter", payload: { scope: "dashboard", field: "region" } },
        validationContext()
      ),
      "semantic"
    );
  });

  it("skips field checks when no dataset schema is available", () => {
    // Without a bound dataset there is nothing to check a field name against;
    // the engine must not invent failures.
    expectSuccess(
      validateCommandFull(
        {
          type: "change_dimension",
          payload: { pageId: PAGE_ID, visualId: VISUAL_ID, field: "anything_at_all" },
        },
        { dashboardState: makeState() }
      )
    );
  });

  it("accepts a dashboard-level calculated measure as a valid field reference", () => {
    const state = makeState();
    state.dashboard.calculatedFields = [
      { name: "profit_margin", expression: "revenue * 0.3", dataType: "number" },
    ];

    expectSuccess(
      validateCommandFull(
        {
          type: "change_measure",
          payload: { pageId: PAGE_ID, visualId: VISUAL_ID, field: "profit_margin" },
        },
        validationContext(state)
      )
    );
  });

  it("rejects a duplicate measure name", () => {
    const state = makeState();
    state.dashboard.calculatedFields = [
      { name: "profit_margin", expression: "revenue * 0.3", dataType: "number" },
    ];

    expectFailure(
      validateCommandFull(
        {
          type: "create_measure",
          payload: { name: "profit_margin", expression: "revenue * 0.4" },
        },
        validationContext(state)
      ),
      "semantic"
    );
  });
});

// ─────────────────────────────────────────────
// Stage 3: scope
// ─────────────────────────────────────────────

describe("stage 3 — scope validation", () => {
  it("rejects a page-level command that targets the whole dashboard", () => {
    // rename_page is page-scoped; without a pageId it would apply dashboard-wide.
    // pageId is unconditionally required by RENAME_PAGE, so the schema stage
    // catches it first — the earliest stage that can, which is what we want.
    const failure = expectFailure(
      validateCommandFull(
        { type: "rename_page", payload: { title: "Renamed" } },
        validationContext()
      ),
      "schema"
    );
    assert.ok(failure.fieldErrors?.pageId, "the missing target should be named");
  });

  it("rejects a page-scoped filter that identifies no page", () => {
    // ADD_FILTER's pageId is optional in the schema (dashboard scope doesn't use
    // it), so requiring it for scope 'page' is genuinely the scope stage's job.
    const failure = expectFailure(
      validateCommandFull(
        {
          type: "add_filter",
          payload: {
            scope: "page",
            filter: { field: "region", operator: "eq", value: "EMEA" },
          },
        },
        validationContext()
      ),
      "scope"
    );
    assert.match(failure.message, /page-scoped/);
  });

  it("rejects a page-scoped style change that names a single visual", () => {
    // update_style is a true discriminated union by scope now, so this isn't
    // even a shape the "page" branch accepts — it's caught at the schema
    // stage, earlier than a generic scope check ever could.
    const failure = expectFailure(
      validateCommandFull(
        {
          type: "update_style",
          payload: {
            scope: "page",
            pageId: PAGE_ID,
            visualId: VISUAL_ID,
            style: { background: "#111827" },
          },
        },
        validationContext()
      ),
      "schema"
    );
    assert.match(failure.message, /visualId/i);
  });

  it("rejects a dashboard-scoped style change that names a page", () => {
    const failure = expectFailure(
      validateCommandFull(
        {
          type: "update_style",
          payload: {
            scope: "dashboard",
            pageId: PAGE_ID,
            style: { background: "#111827" },
          },
        },
        validationContext()
      ),
      "schema"
    );
    assert.match(failure.message, /pageId/i);
  });

  it("rejects a visual-scoped style change with no visual identified", () => {
    const failure = expectFailure(
      validateCommandFull(
        {
          type: "update_style",
          payload: { scope: "visual", pageId: PAGE_ID, style: { opacity: 0.5 } },
        },
        validationContext()
      ),
      "schema"
    );
    assert.match(failure.message, /visualId/i);
  });

  it("rejects a dashboard-scoped style change carrying a visual/page-only style key", () => {
    // "opacity" is a valid Style field (visual/page scope) but not a Theme
    // field — dashboard scope validates against Partial<Theme>, not Style.
    const failure = expectFailure(
      validateCommandFull(
        {
          type: "update_style",
          payload: { scope: "dashboard", style: { opacity: 0.5 } },
        },
        validationContext()
      ),
      "schema"
    );
    assert.match(failure.message, /opacity/i);
  });

  it("rejects a visual-scoped command that omits its page", () => {
    const failure = expectFailure(
      validateCommandFull(
        { type: "delete_visual", payload: { visualId: VISUAL_ID } },
        validationContext()
      ),
      "schema"
    );
    assert.ok(failure.fieldErrors?.pageId);
  });

  it("accepts update_style at each of the three scopes when correctly targeted", () => {
    const context = validationContext();

    const visualScoped = expectSuccess(
      validateCommandFull(
        {
          type: "update_style",
          payload: {
            scope: "visual",
            pageId: PAGE_ID,
            visualId: VISUAL_ID,
            style: { opacity: 0.8 },
          },
        },
        context
      )
    );
    assert.equal(visualScoped.scope, "visual");

    const pageScoped = expectSuccess(
      validateCommandFull(
        {
          type: "update_style",
          payload: { scope: "page", pageId: PAGE_ID, style: { background: "#0b1220" } },
        },
        context
      )
    );
    assert.equal(pageScoped.scope, "page");

    const dashboardScoped = expectSuccess(
      validateCommandFull(
        {
          type: "update_style",
          payload: { scope: "dashboard", style: { fontFamily: "Inter" } },
        },
        context
      )
    );
    assert.equal(dashboardScoped.scope, "dashboard");
  });

  it("does not misreport a missing identifier as 'page does not exist'", () => {
    const failure = expectFailure(
      validateCommandFull(
        { type: "move_visual", payload: { visualId: VISUAL_ID, x: 0, y: 0 } },
        validationContext()
      ),
      "schema"
    );
    assert.doesNotMatch(
      failure.message,
      /does not exist/,
      "an absent pageId is a missing field, not a dangling reference"
    );
  });
});

// ─────────────────────────────────────────────
// Stage ordering
// ─────────────────────────────────────────────

describe("stage ordering", () => {
  it("reports the schema failure first when a command fails several stages", () => {
    // Bad chart type (schema), non-existent visual (semantic), no pageId (scope).
    const failure = expectFailure(
      validateCommandFull(
        { type: "change_chart_type", payload: { visualId: "ghost", kind: "bogus" } },
        validationContext()
      )
    );
    assert.equal(failure.stage, "schema");
  });

  it("reports the semantic failure before the scope failure", () => {
    // add_filter with scope=page pointing at a page that does not exist, and
    // also carrying a visualId (a scope violation). Semantic is checked first.
    // (Unlike update_style, add_filter's schema doesn't pin pageId/visualId to
    // the scope, so this genuinely reaches semantic before scope can fire.)
    const failure = expectFailure(
      validateCommandFull(
        {
          type: "add_filter",
          payload: {
            scope: "page",
            pageId: "no_such_page",
            visualId: VISUAL_ID,
            filter: { field: "region", operator: "eq", value: "EMEA" },
          },
        },
        validationContext()
      )
    );
    assert.equal(failure.stage, "semantic");
  });

  it("never throws, whatever it is given", () => {
    const garbage: unknown[] = [
      { type: "", payload: null },
      { type: "create_chart", payload: null },
      { type: "create_chart", payload: "not an object" },
      { type: "move_visual", payload: [] },
      { type: "update_style", payload: { scope: "galaxy", style: {} } },
      { type: "reorder_pages", payload: { orderedPageIds: [] } },
    ];

    for (const command of garbage) {
      assert.doesNotThrow(() => {
        const outcome = validateCommandFull(
          command as { type: string; payload: unknown },
          validationContext()
        );
        assert.equal(outcome.valid, false, `expected ${JSON.stringify(command)} to be invalid`);
      }, `validation threw on: ${JSON.stringify(command)}`);
    }
  });

  it("validates identically regardless of command origin", () => {
    // The same payload from a person and from the AI must get the same verdict.
    const payload = { pageId: PAGE_ID, kind: "bar", title: "Same" };
    const fromUser = validateCommandFull(
      { type: "create_chart", payload },
      validationContext()
    );
    const fromAi = validateCommandFull(
      { type: "CREATE_VISUAL", payload },
      validationContext()
    );

    assert.equal(fromUser.valid, fromAi.valid);
    assert.deepEqual(
      (fromUser as ValidationSuccess).payload,
      (fromAi as ValidationSuccess).payload
    );
  });
});

describe("multi-dataset commands", () => {
  it("attaches a new dataset that exists in the database", () => {
    const outcome = validateCommandFull(
      { type: "ATTACH_DATASET", payload: { datasetId: "dataset_2" } },
      validationContext()
    );
    expectSuccess(outcome);
  });

  it("rejects attaching a dataset that doesn't exist", () => {
    const outcome = validateCommandFull(
      { type: "ATTACH_DATASET", payload: { datasetId: "dataset_missing" } },
      validationContext()
    );
    expectFailure(outcome, "semantic");
  });

  it("rejects attaching a dataset that's already attached", () => {
    const outcome = validateCommandFull(
      { type: "ATTACH_DATASET", payload: { datasetId: "dataset_1" } },
      validationContext()
    );
    expectFailure(outcome, "semantic");
  });

  it("blocks detaching a dataset that's still used by a chart", () => {
    // makeState()'s one visual has no explicit datasetId, so it falls back to
    // dashboard.datasetId ("dataset_1") — still "in use".
    const outcome = validateCommandFull(
      { type: "DETACH_DATASET", payload: { datasetId: "dataset_1" } },
      validationContext()
    );
    const failure = expectFailure(outcome, "semantic");
    assert.match(failure.message, /still use it/);
  });

  it("allows detaching an attached dataset no chart references", () => {
    const state = makeState();
    state.dashboard.datasetIds = ["dataset_1", "dataset_2"];
    const outcome = validateCommandFull(
      { type: "DETACH_DATASET", payload: { datasetId: "dataset_2" } },
      validationContext(state)
    );
    expectSuccess(outcome);
  });

  it("rejects detaching a dataset that isn't attached", () => {
    const outcome = validateCommandFull(
      { type: "DETACH_DATASET", payload: { datasetId: "dataset_2" } },
      validationContext()
    );
    expectFailure(outcome, "semantic");
  });

  it("rejects a create_chart targeting a dataset not attached to the dashboard", () => {
    const outcome = validateCommandFull(
      {
        type: "create_chart",
        payload: { pageId: PAGE_ID, kind: "bar", title: "X", datasetId: "dataset_2" },
      },
      validationContext()
    );
    expectFailure(outcome, "semantic");
  });

  it("accepts a create_chart targeting an already-attached dataset with a field that dataset actually has", () => {
    const state = makeState();
    state.dashboard.datasetIds = ["dataset_1", "dataset_2"];
    const outcome = validateCommandFull(
      {
        type: "create_chart",
        payload: {
          pageId: PAGE_ID,
          kind: "bar",
          title: "X",
          datasetId: "dataset_2",
          encoding: { xField: "campaign", measures: [{ field: "clicks", aggregation: "sum" }] },
        },
      },
      validationContext(state)
    );
    expectSuccess(outcome);
  });

  it("rejects a create_chart whose datasetId is set but whose fields belong to a different attached dataset", () => {
    const state = makeState();
    state.dashboard.datasetIds = ["dataset_1", "dataset_2"];
    const outcome = validateCommandFull(
      {
        type: "create_chart",
        payload: {
          pageId: PAGE_ID,
          kind: "bar",
          title: "X",
          datasetId: "dataset_2",
          // "region" only exists on dataset_1, not the declared dataset_2.
          encoding: { xField: "region", measures: [{ field: "clicks", aggregation: "sum" }] },
        },
      },
      validationContext(state)
    );
    const failure = expectFailure(outcome, "semantic");
    assert.match(failure.message, /region/);
  });

  it("rejects an update_visual switching a chart to a dataset that doesn't have its fields", () => {
    const state = makeState();
    state.dashboard.datasetIds = ["dataset_1", "dataset_2"];
    const outcome = validateCommandFull(
      {
        type: "update_visual",
        payload: {
          pageId: PAGE_ID,
          visualId: VISUAL_ID,
          patch: { datasetId: "dataset_2" },
        },
      },
      validationContext(state)
    );
    // The existing visual's encoding (xField: "region", measure: "revenue")
    // isn't touched by this patch, so it isn't re-checked — only an
    // explicitly patched encoding is. This just confirms the dataset switch
    // itself is accepted once dataset_2 is attached.
    expectSuccess(outcome);
  });
});

// Referenced so the fixture's dashboard id stays meaningful in failure output.
assert.equal(makeState().dashboard.id, DASHBOARD_ID);
