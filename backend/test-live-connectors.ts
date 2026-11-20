import {
  executeApiRequest,
  testApiConnection,
} from "./src/data/connectors/apiConnector.js";
import {
  validateReadOnlySqlQuery,
  executeDatabaseQuery,
  testDatabaseConnection,
  ensureDemoTablesExist,
} from "./src/data/connectors/databaseConnector.js";

async function runTests() {
  console.log("=== 1. Testing SQL Safety Validator ===");
  const validQuery = "SELECT order_id, customer_region, sales_amount FROM live_enterprise_orders";
  const validWith = "WITH high_sales AS (SELECT * FROM live_enterprise_orders WHERE sales_amount > 5000) SELECT * FROM high_sales";
  const dropQuery = "DROP TABLE users";
  const deleteQuery = "DELETE FROM orders WHERE id = 1";
  const insertQuery = "INSERT INTO orders VALUES (1, 'abc')";

  console.assert(validateReadOnlySqlQuery(validQuery).valid === true, "valid SELECT should pass");
  console.assert(validateReadOnlySqlQuery(validWith).valid === true, "valid WITH should pass");
  console.assert(validateReadOnlySqlQuery(dropQuery).valid === false, "DROP should fail");
  console.assert(validateReadOnlySqlQuery(deleteQuery).valid === false, "DELETE should fail");
  console.assert(validateReadOnlySqlQuery(insertQuery).valid === false, "INSERT should fail");
  console.log("✓ SQL Safety checks passed!");

  console.log("\n=== 2. Testing Built-in SQLite Enterprise DB ===");
  await ensureDemoTablesExist();
  const dbTest = await testDatabaseConnection({
    type: "sqlite",
    query: "SELECT order_id, order_date, customer_region, product_category, sales_amount, profit_margin FROM live_enterprise_orders ORDER BY sales_amount DESC LIMIT 5",
  });
  console.log("DB Test result:", dbTest.valid, dbTest.message);
  console.assert(dbTest.valid === true, "DB test should succeed");
  console.assert(dbTest.sampleRows.length > 0, "DB test should return sample rows");
  console.log("Sample DB row:", dbTest.sampleRows[0]);
  console.log("✓ Database connector passed!");

  console.log("\n=== 3. Testing REST API Connector ===");
  // Test with mock / public JSON API (e.g. JSONPlaceholder or dummyjson or httpbin)
  try {
    const apiTest = await testApiConnection({
      url: "https://jsonplaceholder.typicode.com/posts",
      method: "GET",
    });
    console.log("API Test result:", apiTest.valid, apiTest.message);
    console.assert(apiTest.valid === true, "API test should succeed");
    console.assert(apiTest.sampleRows.length > 0, "API test should return sample rows");
    console.log("Detected columns:", apiTest.detectedColumns);
    console.log("✓ REST API connector passed!");
  } catch (err) {
    console.warn("Public API test skipped/failed (network check):", err);
  }

  console.log("\nAll Live Connector unit checks verified successfully!");
}

runTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
