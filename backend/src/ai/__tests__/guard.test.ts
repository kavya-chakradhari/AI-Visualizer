/**
 * Tests for the field-hallucination guard — the authoritative check that
 * catches a made-up field regardless of what the model claims about it.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { checkFieldReferences, describeUnknownFields } from "../guard.js";
import { makeContext } from "./contextFixtures.js";

describe("checkFieldReferences", () => {
  it("passes when every referenced field exists", () => {
    const result = checkFieldReferences(
      [
        {
          type: "create_chart",
          payload: {
            pageId: "page_1",
            kind: "bar",
            title: "X",
            encoding: { xField: "Region", measures: [{ field: "Sales", aggregation: "sum" }] },
          },
        },
      ],
      makeContext()
    );
    assert.equal(result.ok, true);
    assert.deepEqual(result.invalidFields, []);
  });

  it("flags an unknown field and suggests the close spelling match", () => {
    const result = checkFieldReferences(
      [{ type: "change_dimension", payload: { pageId: "page_1", visualId: "v1", field: "Regoin" } }],
      makeContext()
    );
    assert.equal(result.ok, false);
    assert.deepEqual(result.invalidFields, ["Regoin"]);
    assert.ok(result.suggestions.Regoin?.includes("Region"));
  });

  it("falls back to a same-role suggestion when nothing is textually close", () => {
    const result = checkFieldReferences(
      [
        {
          type: "create_chart",
          payload: {
            pageId: "page_1",
            kind: "bar",
            title: "X",
            encoding: { measures: [{ field: "Revenue", aggregation: "sum" }] },
          },
        },
      ],
      makeContext()
    );
    assert.equal(result.ok, false);
    assert.ok(
      result.suggestions.Revenue?.includes("Sales"),
      `expected 'Sales' to be suggested for 'Revenue', got: ${JSON.stringify(result.suggestions)}`
    );
  });

  it("checks fields nested inside a patch (UPDATE_VISUAL)", () => {
    const result = checkFieldReferences(
      [
        {
          type: "update_visual",
          payload: {
            pageId: "page_1",
            visualId: "v1",
            patch: { encoding: { colorField: "Nope" } },
          },
        },
      ],
      makeContext()
    );
    assert.equal(result.ok, false);
    assert.deepEqual(result.invalidFields, ["Nope"]);
  });

  it("checks a filter's field", () => {
    const result = checkFieldReferences(
      [
        {
          type: "add_filter",
          payload: { scope: "dashboard", filter: { field: "Bogus", operator: "eq", value: 1 } },
        },
      ],
      makeContext()
    );
    assert.equal(result.ok, false);
    assert.deepEqual(result.invalidFields, ["Bogus"]);
  });

  it("checks every measure in a yField array and a measures list", () => {
    const result = checkFieldReferences(
      [
        {
          type: "create_chart",
          payload: {
            pageId: "page_1",
            kind: "line",
            title: "X",
            encoding: { yField: ["Sales", "Ghost"], measures: [{ field: "Units", aggregation: "sum" }] },
          },
        },
      ],
      makeContext()
    );
    assert.equal(result.ok, false);
    assert.deepEqual(result.invalidFields, ["Ghost"]);
  });

  it("ignores commands with no field references at all", () => {
    const result = checkFieldReferences(
      [{ type: "rename_page", payload: { pageId: "page_1", title: "New Title" } }],
      makeContext()
    );
    assert.equal(result.ok, true);
  });

  it("is case-insensitive when matching against known fields", () => {
    const result = checkFieldReferences(
      [{ type: "change_dimension", payload: { pageId: "page_1", visualId: "v1", field: "region" } }],
      makeContext()
    );
    assert.equal(result.ok, true, "a differently-cased but real field name should be accepted");
  });
});

describe("checkFieldReferences — multiple datasets", () => {
  const twoDatasetContext = makeContext({
    fields: [
      { name: "Sales", dataType: "number", semanticType: "currency", role: "measure", datasetId: "ds_a", datasetName: "A" },
      { name: "Region", dataType: "string", semanticType: "categorical", role: "dimension", datasetId: "ds_a", datasetName: "A" },
      { name: "Clicks", dataType: "number", semanticType: "numeric", role: "measure", datasetId: "ds_b", datasetName: "B" },
      { name: "Campaign", dataType: "string", semanticType: "categorical", role: "dimension", datasetId: "ds_b", datasetName: "B" },
    ],
    datasets: [
      { id: "ds_a", name: "A" },
      { id: "ds_b", name: "B" },
    ],
  });

  it("accepts a command whose fields all belong to its declared datasetId", () => {
    const result = checkFieldReferences(
      [
        {
          type: "create_chart",
          payload: {
            pageId: "page_1",
            kind: "bar",
            title: "X",
            datasetId: "ds_b",
            encoding: { xField: "Campaign", measures: [{ field: "Clicks", aggregation: "sum" }] },
          },
        },
      ],
      twoDatasetContext
    );
    assert.equal(result.ok, true);
  });

  it("rejects a command mixing a field from the wrong dataset into a declared datasetId", () => {
    const result = checkFieldReferences(
      [
        {
          type: "create_chart",
          payload: {
            pageId: "page_1",
            kind: "bar",
            title: "X",
            datasetId: "ds_b",
            // "Sales" only exists on dataset A, but this chart targets dataset B.
            encoding: { xField: "Campaign", measures: [{ field: "Sales", aggregation: "sum" }] },
          },
        },
      ],
      twoDatasetContext
    );
    assert.equal(result.ok, false);
    assert.deepEqual(result.invalidFields, ["Sales"]);
  });

  it("falls back to the union of all datasets' fields when no datasetId is given", () => {
    const result = checkFieldReferences(
      [
        {
          type: "create_chart",
          payload: {
            pageId: "page_1",
            kind: "bar",
            title: "X",
            encoding: { xField: "Region", measures: [{ field: "Clicks", aggregation: "sum" }] },
          },
        },
      ],
      twoDatasetContext
    );
    assert.equal(result.ok, true);
  });
});

describe("describeUnknownFields", () => {
  it("produces a readable message naming the field and its suggestion", () => {
    const result = checkFieldReferences(
      [{ type: "change_dimension", payload: { pageId: "page_1", visualId: "v1", field: "Regoin" } }],
      makeContext()
    );
    const message = describeUnknownFields(result);
    assert.match(message, /Regoin/);
    assert.match(message, /Region/);
  });
});
