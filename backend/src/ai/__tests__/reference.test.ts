/**
 * Tests for pronoun / demonstrative reference detection and resolution.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { detectReferenceIntent, resolveReference, describeAmbiguousReference } from "../reference.js";
import { makeContext } from "./contextFixtures.js";
import type { AIVisualSummary } from "../context.js";

function visual(id: string, kind: AIVisualSummary["kind"], title: string): AIVisualSummary {
  return { id, kind, title, layout: { x: 0, y: 0, width: 6, height: 4 } };
}

describe("detectReferenceIntent", () => {
  it("returns null for a message with no reference language", () => {
    assert.equal(detectReferenceIntent("Create a bar chart of Sales by Region"), null);
  });

  it("detects a bare pronoun", () => {
    assert.deepEqual(detectReferenceIntent("Make it blue"), { phrase: "this_chart" });
  });

  it("detects 'this chart' / 'that chart'", () => {
    assert.deepEqual(detectReferenceIntent("Delete this chart"), { phrase: "this_chart" });
    assert.deepEqual(detectReferenceIntent("Resize that chart"), { phrase: "this_chart" });
  });

  it("extracts a descriptor from 'the X chart'", () => {
    assert.deepEqual(detectReferenceIntent("Make the sales chart blue"), {
      phrase: "this_chart",
      descriptor: "sales",
    });
  });

  it("detects 'all charts'", () => {
    assert.deepEqual(detectReferenceIntent("Make all charts blue"), { phrase: "all_charts" });
    assert.deepEqual(detectReferenceIntent("Delete all visuals"), { phrase: "all_charts" });
  });

  it("detects 'this page'", () => {
    assert.deepEqual(detectReferenceIntent("Change the background of this page"), {
      phrase: "this_page",
    });
  });

  it("does not false-positive on 'it' embedded in a longer word", () => {
    assert.equal(detectReferenceIntent("Increase the profit margin"), null);
  });
});

describe("resolveReference", () => {
  const context = makeContext({
    visuals: [visual("v1", "bar", "Sales by Region"), visual("v2", "kpi", "Revenue")],
  });

  it("prefers the explicitly selected visual", () => {
    const result = resolveReference({ phrase: "this_chart" }, context, {
      selectedVisualId: "v2",
      lastVisualId: "v1",
    });
    assert.equal(result.kind, "single");
    assert.ok(result.kind === "single" && result.visualId === "v2");
    assert.ok(result.kind === "single" && result.matchedVia === "selected");
  });

  it("falls back to the last-touched visual when nothing is selected", () => {
    const result = resolveReference({ phrase: "this_chart" }, context, { lastVisualId: "v1" });
    assert.ok(result.kind === "single" && result.visualId === "v1");
    assert.ok(result.kind === "single" && result.matchedVia === "last");
  });

  it("matches by title when a descriptor is given", () => {
    const result = resolveReference(
      { phrase: "this_chart", descriptor: "sales" },
      context,
      {}
    );
    assert.ok(result.kind === "single" && result.visualId === "v1");
    assert.ok(result.kind === "single" && result.matchedVia === "name");
  });

  it("matches by chart kind when the descriptor names a type", () => {
    const result = resolveReference({ phrase: "this_chart", descriptor: "kpi" }, context, {});
    assert.ok(result.kind === "single" && result.visualId === "v2");
    assert.ok(result.kind === "single" && result.matchedVia === "type");
  });

  it("resolves a bare pronoun to the only visual when there is exactly one", () => {
    const oneVisualContext = makeContext({ visuals: [visual("solo", "bar", "Only Chart")] });
    const result = resolveReference({ phrase: "this_chart" }, oneVisualContext, {});
    assert.ok(result.kind === "single" && result.visualId === "solo");
    assert.ok(result.kind === "single" && result.matchedVia === "only");
  });

  it("is ambiguous when nothing anchors a bare pronoun and there are multiple visuals", () => {
    const result = resolveReference({ phrase: "this_chart" }, context, {});
    assert.equal(result.kind, "ambiguous");
  });

  it("is ambiguous when a descriptor matches nothing", () => {
    const result = resolveReference({ phrase: "this_chart", descriptor: "marketing" }, context, {});
    assert.equal(result.kind, "ambiguous");
    assert.ok(result.kind === "ambiguous" && result.term === "marketing");
  });

  it("is ambiguous when a descriptor matches more than one visual", () => {
    const ambiguousContext = makeContext({
      visuals: [visual("v1", "bar", "Sales Bar"), visual("v2", "line", "Sales Line")],
    });
    const result = resolveReference({ phrase: "this_chart", descriptor: "sales" }, ambiguousContext, {});
    assert.equal(result.kind, "ambiguous");
    assert.ok(result.kind === "ambiguous" && result.candidates.length === 2);
  });

  it("resolves 'all charts' to every visual on the page", () => {
    const result = resolveReference({ phrase: "all_charts" }, context, {});
    assert.equal(result.kind, "all");
    assert.deepEqual(result.kind === "all" ? result.visualIds : [], ["v1", "v2"]);
  });

  it("resolves 'this page' to the active page", () => {
    const result = resolveReference({ phrase: "this_page" }, context, {});
    assert.equal(result.kind, "page");
    assert.ok(result.kind === "page" && result.pageId === context.pageId);
  });

  it("ignores a stale selected/last id that no longer exists on the page", () => {
    const result = resolveReference({ phrase: "this_chart" }, context, {
      selectedVisualId: "ghost",
      lastVisualId: "also-ghost",
    });
    assert.equal(result.kind, "ambiguous");
  });
});

describe("describeAmbiguousReference", () => {
  it("lists real candidates when some exist", () => {
    const message = describeAmbiguousReference({
      kind: "ambiguous",
      term: "sales",
      candidates: ["Sales Bar", "Sales Line"],
    });
    assert.match(message, /Sales Bar/);
    assert.match(message, /Sales Line/);
  });

  it("gives a helpful message when there is nothing to suggest", () => {
    const message = describeAmbiguousReference({ kind: "ambiguous", term: "it", candidates: [] });
    assert.match(message, /don't see any charts/i);
  });
});
