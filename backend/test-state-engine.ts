import assert from "node:assert/strict";
import {
  applyCommand,
  createEmptyDashboardState,
  type Command,
  type DashboardState,
  type Visual,
} from "@ai-vis/types";
import { dashboardEngine } from "./src/state/dashboardEngine.js";

async function runTests() {
  console.log("==================================================");
  console.log("RUNNING: State Authoritative Source Invariant Tests");
  console.log("==================================================");

  // -------------------------------------------------------------
  // Test 1: Single Mutation Path Invariant (AI command + Manual edit)
  // -------------------------------------------------------------
  console.log("\n[Test 1] Pure applyCommand single path invariant...");

  const dashId = "test-dash-001";
  const initial = createEmptyDashboardState(dashId, "Test Dashboard");
  const firstPageId = initial.dashboard.pages[0]!.id;

  // 1. AI Command creates a Bar Chart
  const aiCreateCommand: Command<"CREATE_VISUAL"> = {
    id: "cmd-ai-01",
    dashboardId: dashId,
    type: "CREATE_VISUAL",
    origin: "ai",
    prompt: "Create a bar chart showing revenue by region",
    sequenceNumber: 1,
    timestamp: new Date().toISOString(),
    payload: {
      pageId: firstPageId,
      kind: "bar",
      title: "Revenue by Region",
      layout: { x: 0, y: 0, width: 6, height: 4 },
      encoding: {
        xField: "region",
        yField: "revenue",
      },
      style: {
        colors: ["#3b82f6"],
      },
    },
  };

  const stateAfterAI = applyCommand(initial, aiCreateCommand);

  assert.equal(stateAfterAI.dashboard.pages[0]!.visuals.length, 1);
  const createdVisual = stateAfterAI.dashboard.pages[0]!.visuals[0]!;
  assert.equal(createdVisual.kind, "bar");
  assert.equal(createdVisual.title, "Revenue by Region");
  assert.equal(createdVisual.layout.width, 6);
  assert.equal(stateAfterAI.version, 1);
  assert.equal(stateAfterAI.appliedCommandCount, 1);

  // 2. Manual User Edit updates the same visual
  const manualUpdateCommand: Command<"UPDATE_VISUAL"> = {
    id: "cmd-manual-01",
    dashboardId: dashId,
    type: "UPDATE_VISUAL",
    origin: "user",
    sequenceNumber: 2,
    timestamp: new Date().toISOString(),
    payload: {
      pageId: firstPageId,
      visualId: createdVisual.id,
      patch: {
        title: "Q3 Revenue by Region (Updated Manually)",
        layout: { x: 2, y: 0, width: 8, height: 5, zIndex: 1 },
      },
    },
  };

  const stateAfterManual = applyCommand(stateAfterAI, manualUpdateCommand);

  assert.equal(stateAfterManual.dashboard.pages[0]!.visuals.length, 1);
  const updatedVisual = stateAfterManual.dashboard.pages[0]!.visuals[0]!;
  assert.equal(updatedVisual.id, createdVisual.id);
  assert.equal(updatedVisual.title, "Q3 Revenue by Region (Updated Manually)");
  assert.equal(updatedVisual.layout.width, 8);
  assert.equal(updatedVisual.layout.x, 2);
  assert.equal(stateAfterManual.version, 2);
  assert.equal(stateAfterManual.appliedCommandCount, 2);

  // 3. Confirm both states have the exact same object shape
  function getVisualShape(v: Visual) {
    return Object.keys(v).sort();
  }

  const keysAI = getVisualShape(createdVisual);
  const keysManual = getVisualShape(updatedVisual);
  assert.deepEqual(
    keysAI,
    keysManual,
    "Visual object shape produced by AI and manual edit MUST be identical"
  );
  console.log("  ✓ Visual shapes match identically between AI and manual edits.");
  console.log("  ✓ Both mutations strictly modified state via applyCommand.");

  // -------------------------------------------------------------
  // Test 2: Interleaved Multi-type Commands
  // -------------------------------------------------------------
  console.log("\n[Test 2] Interleaved multi-command flow...");

  // AI creates a KPI visual
  const aiKPICommand: Command<"CREATE_VISUAL"> = {
    id: "cmd-ai-02",
    dashboardId: dashId,
    type: "CREATE_VISUAL",
    origin: "ai",
    sequenceNumber: 3,
    timestamp: new Date().toISOString(),
    payload: {
      pageId: firstPageId,
      kind: "kpi",
      title: "Total Profit",
      layout: { x: 6, y: 0, width: 3, height: 2 },
    },
  };

  const stateWithKPI = applyCommand(stateAfterManual, aiKPICommand);
  assert.equal(stateWithKPI.dashboard.pages[0]!.visuals.length, 2);

  // User creates a second page manually
  const manualCreatePage: Command<"CREATE_PAGE"> = {
    id: "cmd-manual-02",
    dashboardId: dashId,
    type: "CREATE_PAGE",
    origin: "user",
    sequenceNumber: 4,
    timestamp: new Date().toISOString(),
    payload: {
      title: "Detailed Breakdown",
    },
  };

  const stateWithTwoPages = applyCommand(stateWithKPI, manualCreatePage);
  assert.equal(stateWithTwoPages.dashboard.pages.length, 2);
  assert.equal(stateWithTwoPages.dashboard.pages[1]!.title, "Detailed Breakdown");
  console.log("  ✓ Interleaved AI and manual commands applied seamlessly.");

  // -------------------------------------------------------------
  // Test 3: Engine applyAndPersist + Undo/Redo Log
  // -------------------------------------------------------------
  console.log("\n[Test 3] Persistence Engine + Command Log Undo/Redo...");

  const engineDash = await dashboardEngine.createDashboard("Persistence Test Dash");
  const testEngineDashId = engineDash.dashboard.id;
  const page1Id = engineDash.dashboard.pages[0]!.id;

  // AI adds visual via applyAndPersist
  const aiPersistRes = await dashboardEngine.applyAndPersist(testEngineDashId, {
    type: "CREATE_VISUAL",
    origin: "ai",
    prompt: "Add pie chart of expenses",
    payload: {
      pageId: page1Id,
      kind: "pie",
      title: "Expenses Distribution",
      layout: { x: 0, y: 0, width: 6, height: 4 },
    },
  });

  assert.equal(aiPersistRes.success, true);
  assert.equal(aiPersistRes.dashboard.dashboard.pages[0]!.visuals.length, 1);
  const pieVisualId = aiPersistRes.dashboard.dashboard.pages[0]!.visuals[0]!.id;

  // User manually edits the pie chart via applyAndPersist
  const manualPersistRes = await dashboardEngine.applyAndPersist(testEngineDashId, {
    type: "UPDATE_VISUAL",
    origin: "user",
    payload: {
      pageId: page1Id,
      visualId: pieVisualId,
      patch: { title: "2026 Operating Expenses" },
    },
  });

  assert.equal(manualPersistRes.success, true);
  assert.equal(
    manualPersistRes.dashboard.dashboard.pages[0]!.visuals[0]!.title,
    "2026 Operating Expenses"
  );

  // Undo manual edit -> should roll back title to "Expenses Distribution"
  const undoRes = await dashboardEngine.undo(testEngineDashId);
  assert.equal(undoRes.success, true);
  assert.equal(
    undoRes.dashboard.dashboard.pages[0]!.visuals[0]!.title,
    "Expenses Distribution",
    "Undo must restore AI visual title"
  );
  console.log("  ✓ Undo restored previous state correctly.");

  // Redo manual edit -> should restore "2026 Operating Expenses"
  const redoRes = await dashboardEngine.redo(testEngineDashId);
  assert.equal(redoRes.success, true);
  assert.equal(
    redoRes.dashboard.dashboard.pages[0]!.visuals[0]!.title,
    "2026 Operating Expenses",
    "Redo must re-apply manual edit"
  );
  console.log("  ✓ Redo restored manual edit correctly.");

  // Verify command log audit trail
  const commandLog = await dashboardEngine.getCommandLog(testEngineDashId);
  assert.equal(commandLog.length, 2);
  assert.equal(commandLog[0]!.action, "UPDATE_VISUAL");
  assert.equal(commandLog[1]!.action, "CREATE_VISUAL");
  assert.equal(commandLog[1]!.origin, "ai");
  assert.equal(commandLog[0]!.origin, "user");
  console.log("  ✓ Audit trail logged both AI and manual commands with correct origins.");

  console.log("\n==================================================");
  console.log("ALL TESTS PASSED: Single authoritative representation verified!");
  console.log("==================================================");
}

runTests().catch((err) => {
  console.error("Test failed with error:", err);
  process.exit(1);
});
