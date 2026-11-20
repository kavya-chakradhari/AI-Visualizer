# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: resize.spec.ts >> dragging a chart's resize handle persists the new size across reload
- Location: tests\resize.spec.ts:18:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByText('1 visual on page')
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" getByText('1 visual on page') with timeout 5000ms
  - waiting for getByText('1 visual on page')

```

```yaml
- status:
  - text: "Cannot apply command: No active dashboard."
  - button "Dismiss notification"
- banner:
  - text: AI VIS v0.1
  - paragraph: Manual Dashboard Canvas & Interactive Visual Studio
  - 'button "Theme: Dark. Change theme"': Dark
  - text: sample
  - button "New Upload"
- main:
  - heading "sample Dashboard" [level=2]
  - paragraph: sample • 5 rows • 0 visuals on page
  - tablist "Dashboard view":
    - tab "Canvas" [selected]
    - tab "Profiling"
    - tab "Raw Data"
  - button "Undo last edit (Ctrl/Cmd+Z)" [disabled]
  - button "Redo edit (Ctrl/Cmd+Shift+Z)" [disabled]
  - button "Toggle command history"
  - button "Export"
  - button "Add Chart"
  - listbox "Dashboard charts":
    - heading "Your Dashboard Canvas is Empty" [level=3]
    - paragraph: Create your first chart using the manual chart builder. Pick a chart type, select dimension and metric columns, and add it to your canvas.
    - button "Add Your First Chart"
- button "Open AI assistant"
```

# Test source

```ts
  1  | import { test, expect } from "@playwright/test";
  2  | import path from "node:path";
  3  | import { fileURLToPath } from "node:url";
  4  | 
  5  | const __dirname = path.dirname(fileURLToPath(import.meta.url));
  6  | const SAMPLE_CSV = path.join(__dirname, "..", "fixtures", "sample.csv");
  7  | 
  8  | /**
  9  |  * Regression test for a real bug: CanvasItem's resize-handle drag committed
  10 |  * the SIZE FROM BEFORE THE DRAG on mouseup (a stale-closure bug — the
  11 |  * mouseup handler read `currentDim` from component state captured at
  12 |  * mousedown time, not the value updated live during the drag), so every
  13 |  * drag-resize visually grew the chart while dragging and then snapped back
  14 |  * to its original size the instant the mouse was released. Fixed in
  15 |  * CanvasItem.tsx by tracking the live size in a local variable read directly
  16 |  * by the mouseup handler instead of through React state.
  17 |  */
  18 | test("dragging a chart's resize handle persists the new size across reload", async ({ page }) => {
  19 |   await page.goto("/");
  20 | 
  21 |   await page.locator('input[type="file"]').setInputFiles(SAMPLE_CSV);
  22 |   await expect(page.getByText("Add Chart", { exact: true })).toBeVisible({ timeout: 20_000 });
  23 | 
  24 |   await page.getByRole("button", { name: "Add Chart" }).first().click();
  25 |   await expect(page.getByRole("dialog", { name: "Add visual to canvas" })).toBeVisible();
  26 |   await page.getByRole("button", { name: "Add Chart to Canvas" }).click();
  27 |   await expect(page.getByRole("dialog", { name: "Add visual to canvas" })).toBeHidden();
> 28 |   await expect(page.getByText("1 visual on page")).toBeVisible();
     |                                                    ^ Error: expect(locator).toBeVisible() failed
  29 | 
  30 |   const chartCard = page.getByRole("option").first();
  31 |   await expect(chartCard).toBeVisible();
  32 |   const before = await chartCard.boundingBox();
  33 |   expect(before).not.toBeNull();
  34 | 
  35 |   const resizeHandle = page.locator(
  36 |     '[title="Drag to resize chart (or select it and use Shift+arrow keys)"]'
  37 |   );
  38 |   await expect(resizeHandle).toBeVisible();
  39 |   const handleBox = await resizeHandle.boundingBox();
  40 |   expect(handleBox).not.toBeNull();
  41 | 
  42 |   const startX = handleBox!.x + handleBox!.width / 2;
  43 |   const startY = handleBox!.y + handleBox!.height / 2;
  44 | 
  45 |   await page.mouse.move(startX, startY);
  46 |   await page.mouse.down();
  47 |   // Drag well past one grid column/row so the change isn't lost to rounding.
  48 |   await page.mouse.move(startX + 220, startY + 160, { steps: 10 });
  49 |   await page.mouse.up();
  50 | 
  51 |   // The card must reflect the new size immediately after release, not just
  52 |   // mid-drag — this is exactly what the stale-closure bug broke.
  53 |   await expect
  54 |     .poll(async () => {
  55 |       const box = await chartCard.boundingBox();
  56 |       return box ? box.width : 0;
  57 |     })
  58 |     .toBeGreaterThan(before!.width + 100);
  59 | 
  60 |   const afterDrag = await chartCard.boundingBox();
  61 | 
  62 |   // Prove the new size is the authoritative committed value (came back from
  63 |   // RESIZE_VISUAL -> applyCommand -> backend -> re-render), not just a
  64 |   // client-only artifact of mid-drag component state: deselect by clicking
  65 |   // empty canvas, then re-select. CanvasItem's layout-sync effect only ever
  66 |   // re-derives currentDim from `visual.layout` (the authoritative prop) once
  67 |   // isDragging/isResizing are both false, so if the stale-closure bug were
  68 |   // still present, this round-trip would snap the card back to `before`.
  69 |   await page.mouse.click(20, 20);
  70 |   await chartCard.click();
  71 |   const afterReselect = await chartCard.boundingBox();
  72 | 
  73 |   expect(afterReselect).not.toBeNull();
  74 |   expect(afterReselect!.width).toBeGreaterThan(before!.width + 100);
  75 |   expect(Math.abs(afterReselect!.width - afterDrag!.width)).toBeLessThan(10);
  76 | });
  77 | 
```