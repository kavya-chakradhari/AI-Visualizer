import { test, expect } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE_CSV = path.join(__dirname, "..", "fixtures", "sample.csv");

/**
 * Regression test for a real bug: CanvasItem's resize-handle drag committed
 * the SIZE FROM BEFORE THE DRAG on mouseup (a stale-closure bug — the
 * mouseup handler read `currentDim` from component state captured at
 * mousedown time, not the value updated live during the drag), so every
 * drag-resize visually grew the chart while dragging and then snapped back
 * to its original size the instant the mouse was released. Fixed in
 * CanvasItem.tsx by tracking the live size in a local variable read directly
 * by the mouseup handler instead of through React state.
 */
test("dragging a chart's resize handle persists the new size across reload", async ({ page }) => {
  await page.goto("/");

  await page.locator('input[type="file"]').setInputFiles(SAMPLE_CSV);
  await expect(page.getByText("Add Chart", { exact: true })).toBeVisible({ timeout: 20_000 });

  await page.getByRole("button", { name: "Add Chart" }).first().click();
  await expect(page.getByRole("dialog", { name: "Add visual to canvas" })).toBeVisible();
  await page.getByRole("button", { name: "Add Chart to Canvas" }).click();
  await expect(page.getByRole("dialog", { name: "Add visual to canvas" })).toBeHidden();
  await expect(page.getByText("1 visual on page")).toBeVisible();

  const chartCard = page.getByRole("option").first();
  await expect(chartCard).toBeVisible();
  const before = await chartCard.boundingBox();
  expect(before).not.toBeNull();

  const resizeHandle = page.locator(
    '[title="Drag to resize chart (or select it and use Shift+arrow keys)"]'
  );
  await expect(resizeHandle).toBeVisible();
  const handleBox = await resizeHandle.boundingBox();
  expect(handleBox).not.toBeNull();

  const startX = handleBox!.x + handleBox!.width / 2;
  const startY = handleBox!.y + handleBox!.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  // Drag well past one grid column/row so the change isn't lost to rounding.
  await page.mouse.move(startX + 220, startY + 160, { steps: 10 });
  await page.mouse.up();

  // The card must reflect the new size immediately after release, not just
  // mid-drag — this is exactly what the stale-closure bug broke.
  await expect
    .poll(async () => {
      const box = await chartCard.boundingBox();
      return box ? box.width : 0;
    })
    .toBeGreaterThan(before!.width + 100);

  const afterDrag = await chartCard.boundingBox();

  // Prove the new size is the authoritative committed value (came back from
  // RESIZE_VISUAL -> applyCommand -> backend -> re-render), not just a
  // client-only artifact of mid-drag component state: deselect by clicking
  // empty canvas, then re-select. CanvasItem's layout-sync effect only ever
  // re-derives currentDim from `visual.layout` (the authoritative prop) once
  // isDragging/isResizing are both false, so if the stale-closure bug were
  // still present, this round-trip would snap the card back to `before`.
  await page.mouse.click(20, 20);
  await chartCard.click();
  const afterReselect = await chartCard.boundingBox();

  expect(afterReselect).not.toBeNull();
  expect(afterReselect!.width).toBeGreaterThan(before!.width + 100);
  expect(Math.abs(afterReselect!.width - afterDrag!.width)).toBeLessThan(10);
});
