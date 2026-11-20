/**
 * Tests for confirmation classification — destructive, dashboard-wide, and
 * bulk (3+ visual) command batches must require confirmation; simple
 * single-visual edits must not.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { classifyRequiresConfirmation, describeConfirmationReason } from "../confirmation.js";
import type { CommandInput } from "@ai-vis/types";

function cmd(type: string, payload: Record<string, unknown>): CommandInput {
  return { type, payload };
}

describe("classifyRequiresConfirmation", () => {
  it("requires confirmation for delete_visual", () => {
    const result = classifyRequiresConfirmation([
      cmd("delete_visual", { pageId: "p1", visualId: "v1" }),
    ]);
    assert.equal(result.required, true);
    assert.equal(result.reason, "destructive");
  });

  it("requires confirmation for delete_page and delete_measure too", () => {
    assert.equal(
      classifyRequiresConfirmation([cmd("delete_page", { pageId: "p1" })]).required,
      true
    );
    assert.equal(
      classifyRequiresConfirmation([cmd("delete_measure", { name: "Margin" })]).required,
      true
    );
  });

  it("requires confirmation for a dashboard-scoped style change", () => {
    const result = classifyRequiresConfirmation([
      cmd("update_style", { scope: "dashboard", style: { background: "#000" } }),
    ]);
    assert.equal(result.required, true);
    assert.equal(result.reason, "dashboard_wide_style");
  });

  it("does NOT require confirmation for a visual- or page-scoped style change", () => {
    assert.equal(
      classifyRequiresConfirmation([
        cmd("update_style", { scope: "visual", pageId: "p1", visualId: "v1", style: { colors: ["#000"] } }),
      ]).required,
      false
    );
    assert.equal(
      classifyRequiresConfirmation([
        cmd("update_style", { scope: "page", pageId: "p1", style: { background: "#000" } }),
      ]).required,
      false
    );
  });

  it("requires confirmation for a batch touching 3 or more distinct visuals", () => {
    const result = classifyRequiresConfirmation([
      cmd("update_style", { scope: "visual", pageId: "p1", visualId: "v1", style: {} }),
      cmd("update_style", { scope: "visual", pageId: "p1", visualId: "v2", style: {} }),
      cmd("update_style", { scope: "visual", pageId: "p1", visualId: "v3", style: {} }),
    ]);
    assert.equal(result.required, true);
    assert.equal(result.reason, "bulk_edit");
    assert.equal(result.touchedVisualCount, 3);
  });

  it("does NOT require confirmation for exactly 2 visuals touched", () => {
    const result = classifyRequiresConfirmation([
      cmd("move_visual", { pageId: "p1", visualId: "v1", x: 0, y: 0 }),
      cmd("move_visual", { pageId: "p1", visualId: "v2", x: 0, y: 0 }),
    ]);
    assert.equal(result.required, false);
  });

  it("counts distinct visuals, not command count", () => {
    // 4 commands, but only 2 distinct visuals — should not require confirmation.
    const result = classifyRequiresConfirmation([
      cmd("move_visual", { pageId: "p1", visualId: "v1", x: 0, y: 0 }),
      cmd("resize_visual", { pageId: "p1", visualId: "v1", width: 6, height: 4 }),
      cmd("move_visual", { pageId: "p1", visualId: "v2", x: 0, y: 0 }),
      cmd("resize_visual", { pageId: "p1", visualId: "v2", width: 6, height: 4 }),
    ]);
    assert.equal(result.required, false);
  });

  it("counts visuals referenced via REORDER_VISUALS' layout list", () => {
    const result = classifyRequiresConfirmation([
      cmd("reorder_visuals", {
        pageId: "p1",
        layouts: [
          { visualId: "v1", layout: { x: 0, y: 0, width: 4, height: 4 } },
          { visualId: "v2", layout: { x: 4, y: 0, width: 4, height: 4 } },
          { visualId: "v3", layout: { x: 8, y: 0, width: 4, height: 4 } },
        ],
      }),
    ]);
    assert.equal(result.required, true);
    assert.equal(result.reason, "bulk_edit");
  });

  it("does not require confirmation for a single reversible move/resize/color edit", () => {
    assert.equal(
      classifyRequiresConfirmation([cmd("move_visual", { pageId: "p1", visualId: "v1", x: 1, y: 1 })])
        .required,
      false
    );
    assert.equal(
      classifyRequiresConfirmation([
        cmd("resize_visual", { pageId: "p1", visualId: "v1", width: 8, height: 5 }),
      ]).required,
      false
    );
    assert.equal(
      classifyRequiresConfirmation([
        cmd("update_style", { scope: "visual", pageId: "p1", visualId: "v1", style: { colors: ["#3b82f6"] } }),
      ]).required,
      false
    );
  });

  it("is case-insensitive about command type spelling", () => {
    assert.equal(
      classifyRequiresConfirmation([cmd("DELETE_VISUAL", { pageId: "p1", visualId: "v1" })]).required,
      true
    );
  });
});

describe("describeConfirmationReason", () => {
  it("describes each reason distinctly", () => {
    assert.match(describeConfirmationReason({ required: true, reason: "destructive" })!, /undone/i);
    assert.match(
      describeConfirmationReason({ required: true, reason: "dashboard_wide_style" })!,
      /entire dashboard/i
    );
    assert.match(
      describeConfirmationReason({ required: true, reason: "bulk_edit", touchedVisualCount: 5 })!,
      /5 charts/
    );
  });

  it("returns undefined when confirmation isn't required", () => {
    assert.equal(describeConfirmationReason({ required: false }), undefined);
  });
});
