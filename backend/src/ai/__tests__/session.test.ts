/** Tests for the per-dashboard conversation session store. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import {
  getSessionHistory,
  getLastVisualId,
  recordTurn,
  recordVisualTouch,
  clearLastVisualId,
  clearSession,
} from "../session.js";

describe("conversation session", () => {
  it("returns empty history and no last-visual for a fresh dashboard", () => {
    const id = randomUUID();
    assert.deepEqual(getSessionHistory(id), []);
    assert.equal(getLastVisualId(id), undefined);
  });

  it("records turns in order", () => {
    const id = randomUUID();
    recordTurn(id, "user", "Create a revenue KPI");
    recordTurn(id, "assistant", "Created a Revenue KPI.");
    recordTurn(id, "user", "Make it blue");

    const history = getSessionHistory(id);
    assert.deepEqual(history, [
      { role: "user", content: "Create a revenue KPI" },
      { role: "assistant", content: "Created a Revenue KPI." },
      { role: "user", content: "Make it blue" },
    ]);
  });

  it("caps history at MAX_TURNS, dropping the oldest first", () => {
    const id = randomUUID();
    for (let i = 0; i < 25; i++) {
      recordTurn(id, i % 2 === 0 ? "user" : "assistant", `turn ${i}`);
    }
    const history = getSessionHistory(id);
    assert.ok(history.length <= 20, `expected history capped at 20, got ${history.length}`);
    assert.equal(history[0]!.content, "turn 5", "the oldest 5 turns should have been dropped");
    assert.equal(history.at(-1)!.content, "turn 24");
  });

  it("tracks the last visual touched, independently per dashboard", () => {
    const a = randomUUID();
    const b = randomUUID();
    recordVisualTouch(a, "visual_a");
    recordVisualTouch(b, "visual_b");
    assert.equal(getLastVisualId(a), "visual_a");
    assert.equal(getLastVisualId(b), "visual_b");
  });

  it("overwrites the last visual on each new touch", () => {
    const id = randomUUID();
    recordVisualTouch(id, "v1");
    recordVisualTouch(id, "v2");
    assert.equal(getLastVisualId(id), "v2");
  });

  it("clears the last visual without affecting history", () => {
    const id = randomUUID();
    recordTurn(id, "user", "hi");
    recordVisualTouch(id, "v1");
    clearLastVisualId(id);
    assert.equal(getLastVisualId(id), undefined);
    assert.equal(getSessionHistory(id).length, 1);
  });

  it("clearSession wipes both history and last visual", () => {
    const id = randomUUID();
    recordTurn(id, "user", "hi");
    recordVisualTouch(id, "v1");
    clearSession(id);
    assert.deepEqual(getSessionHistory(id), []);
    assert.equal(getLastVisualId(id), undefined);
  });
});
