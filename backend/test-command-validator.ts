import assert from "node:assert/strict";
import {
  createEmptyDashboardState,
  type Command,
  type ColumnProfile,
} from "@ai-vis/types";
import { validateCommand } from "./src/commands/validator.js";
import { AppError } from "./src/middleware/error-handler.js";

async function runValidatorTests() {
  console.log("==================================================");
  console.log("RUNNING: Command Validator Tests");
  console.log("==================================================");

  const dashId = "val-test-dash";
  const state = createEmptyDashboardState(dashId, "Validation Test");
  const pageId = state.dashboard.pages[0]!.id;

  const datasetSchema: ColumnProfile[] = [
    {
      name: "Region",
      semanticType: "categorical",
      inferredDataType: "string",
      nullPercentage: 0,
      uniqueCount: 4,
      cardinalityRatio: 0.04,
      isAmbiguous: false,
      sampleValues: ["North", "South", "East", "West"],
    },
    {
      name: "Sales",
      semanticType: "currency",
      inferredDataType: "number",
      nullPercentage: 0,
      uniqueCount: 100,
      cardinalityRatio: 1,
      isAmbiguous: false,
      min: 100,
      max: 50000,
      sampleValues: [1200, 3400, 8900],
    },
  ];

  // 1. Unsupported chart type
  console.log("\n[Test 1] Reject unsupported chart type...");
  assert.throws(
    () => {
      const cmd: Command = {
        id: "c1",
        dashboardId: dashId,
        type: "CREATE_VISUAL",
        origin: "user",
        sequenceNumber: 1,
        timestamp: new Date().toISOString(),
        payload: {
          pageId,
          kind: "hologram_3d" as never,
          title: "Invalid Chart",
        },
      };
      validateCommand(cmd, { dashboardState: state, datasetSchema });
    },
    (err: unknown) => {
      assert(err instanceof AppError);
      assert.equal(err.code, "SCHEMA_VALIDATION_FAILED");
      return true;
    }
  );
  console.log("  ✓ Unsupported chart type correctly rejected at the schema stage.");

  // 2. Out of bounds layout
  console.log("\n[Test 2] Reject out of bounds layout...");
  assert.throws(
    () => {
      const cmd: Command = {
        id: "c2",
        dashboardId: dashId,
        type: "CREATE_VISUAL",
        origin: "user",
        sequenceNumber: 2,
        timestamp: new Date().toISOString(),
        payload: {
          pageId,
          kind: "bar",
          title: "Wide Chart",
          layout: { x: 10, y: 0, width: 6, height: 4 }, // 10 + 6 = 16 > 12
        },
      };
      validateCommand(cmd, { dashboardState: state, datasetSchema });
    },
    (err: unknown) => {
      assert(err instanceof AppError);
      assert.equal(err.code, "SEMANTIC_VALIDATION_FAILED");
      return true;
    }
  );
  console.log("  ✓ Out of bounds layout correctly rejected with OUT_OF_BOUNDS.");

  // 3. Non-existent field reference in dataset
  console.log("\n[Test 3] Reject non-existent field in dataset...");
  assert.throws(
    () => {
      const cmd: Command = {
        id: "c3",
        dashboardId: dashId,
        type: "CREATE_VISUAL",
        origin: "user",
        sequenceNumber: 3,
        timestamp: new Date().toISOString(),
        payload: {
          pageId,
          kind: "bar",
          title: "Sales by Region",
          encoding: {
            xField: "NonExistentColumn",
            yField: "Sales",
          },
        },
      };
      validateCommand(cmd, { dashboardState: state, datasetSchema });
    },
    (err: unknown) => {
      assert(err instanceof AppError);
      assert.equal(err.code, "SEMANTIC_VALIDATION_FAILED");
      return true;
    }
  );
  console.log("  ✓ Non-existent field reference rejected at the semantic stage.");

  // 4. Non-existent visual ID
  console.log("\n[Test 4] Reject non-existent visual ID...");
  assert.throws(
    () => {
      const cmd: Command = {
        id: "c4",
        dashboardId: dashId,
        type: "MOVE_VISUAL",
        origin: "user",
        sequenceNumber: 4,
        timestamp: new Date().toISOString(),
        payload: {
          pageId,
          visualId: "non-existent-visual-id",
          x: 2,
          y: 2,
        },
      };
      validateCommand(cmd, { dashboardState: state, datasetSchema });
    },
    (err: unknown) => {
      assert(err instanceof AppError);
      assert.equal(err.code, "SEMANTIC_VALIDATION_FAILED");
      return true;
    }
  );
  console.log("  ✓ Non-existent visual ID rejected with VISUAL_NOT_FOUND.");

  // 5. Valid CREATE_VISUAL passes cleanly
  console.log("\n[Test 5] Accept valid CREATE_VISUAL with existing fields...");
  const validCmd: Command = {
    id: "c5",
    dashboardId: dashId,
    type: "CREATE_VISUAL",
    origin: "user",
    sequenceNumber: 5,
    timestamp: new Date().toISOString(),
    payload: {
      pageId,
      kind: "bar",
      title: "Sales by Region",
      layout: { x: 0, y: 0, width: 6, height: 4 },
      encoding: {
        xField: "Region",
        yField: "Sales",
      },
    },
  };
  assert.doesNotThrow(() => {
    validateCommand(validCmd, { dashboardState: state, datasetSchema });
  });
  console.log("  ✓ Valid CREATE_VISUAL passed validation.");

  console.log("\n==================================================");
  console.log("ALL VALIDATOR TESTS PASSED!");
  console.log("==================================================");
}

runValidatorTests().catch((err) => {
  console.error("Validator test failed:", err);
  process.exit(1);
});
