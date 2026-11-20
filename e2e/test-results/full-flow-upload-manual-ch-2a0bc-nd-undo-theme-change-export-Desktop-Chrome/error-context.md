# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: full-flow.spec.ts >> upload, manual chart, AI command, undo, theme change, export
- Location: tests\full-flow.spec.ts:21:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByText('Created a revenue KPI.')
Expected: visible
Timeout: 15000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" getByText('Created a revenue KPI.') with timeout 15000ms
  - waiting for getByText('Created a revenue KPI.')

```

```yaml
- banner:
  - text: AI VIS v0.1
  - paragraph: Manual Dashboard Canvas & Interactive Visual Studio
  - 'button "Theme: Dark. Change theme"': Dark
  - text: sample
  - button "New Upload"
- main:
  - heading "sample Dashboard" [level=2]
  - paragraph: sample • 5 rows • 2 visuals on page
  - tablist "Dashboard view":
    - tab "Canvas" [selected]
    - tab "Profiling"
    - tab "Raw Data"
  - button "Undo last edit (Ctrl/Cmd+Z)"
  - button "Redo edit (Ctrl/Cmd+Shift+Z)" [disabled]
  - button "Toggle command history"
  - button "Export"
  - button "Add Chart"
  - listbox "Dashboard charts":
    - option "revenue by name, bar chart. Press Enter to select, arrow keys to move, Shift plus arrow keys to resize, Delete to remove.":
      - text: revenue by name bar
      - button "Bring revenue by name forward"
      - button "Send revenue by name backward"
      - button "Edit revenue by name properties"
      - button "Delete revenue by name"
      - img: 0 500 1,000 1,500 2,000 2,500 Alice Bob Carol Dave Erin
    - option "Revenue KPI, kpi chart. Press Enter to select, arrow keys to move, Shift plus arrow keys to resize, Delete to remove.":
      - text: Revenue KPI kpi
      - button "Bring Revenue KPI forward"
      - button "Send Revenue KPI backward"
      - button "Edit Revenue KPI properties"
      - button "Delete Revenue KPI"
      - text: Revenue KPI 8.8k
- dialog "AI assistant":
  - paragraph: AI Assistant
  - paragraph: Nothing selected — I'll infer "it" from context
  - button "Close AI assistant"
  - text: Ask me to build or edit your dashboard — try "create a bar chart of Sales by Region". 01:51 PM create a revenue kpi 01:51 PM Created a KPI chart for revenue on the current page. 01:51 PM
  - textbox "Message to AI assistant":
    - /placeholder: Ask me to build or edit a chart…
  - button "Send message" [disabled]
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
  9  |  * The MVP-complete acceptance walk: upload -> manual chart creation -> AI
  10 |  * chat command -> undo -> theme change -> export. Runs against both the
  11 |  * "Desktop Chrome" and "Mobile Chrome" projects (see playwright.config.ts) —
  12 |  * every step below uses controls that stay visible and clickable at both
  13 |  * breakpoints per the responsive audit (icon-only buttons collapse their
  14 |  * label text under `sm:`, but never disappear or move off the visible
  15 |  * toolbar).
  16 |  *
  17 |  * Uses the backend's default "mock" AI provider (no API key required, see
  18 |  * backend/.env.example) — deterministic, so "create a revenue kpi" always
  19 |  * produces the same command without depending on a real model.
  20 |  */
  21 | test("upload, manual chart, AI command, undo, theme change, export", async ({ page }) => {
  22 |   await page.goto("/");
  23 | 
  24 |   // ── Upload ──────────────────────────────────────────────────────────
  25 |   await page.locator('input[type="file"]').setInputFiles(SAMPLE_CSV);
  26 |   await expect(page.getByText("Add Chart", { exact: true })).toBeVisible({ timeout: 20_000 });
  27 |   await expect(page.getByText("0 visuals on page")).toBeVisible();
  28 | 
  29 |   // ── Manual chart creation ────────────────────────────────────────────
  30 |   // Defaults (chart kind "bar", dimension/metric columns) are pre-populated
  31 |   // by the modal from the dataset schema — submitting immediately creates a
  32 |   // real chart with no further input needed.
  33 |   await page.getByRole("button", { name: "Add Chart" }).first().click();
  34 |   await expect(page.getByRole("dialog", { name: "Add visual to canvas" })).toBeVisible();
  35 |   await page.getByRole("button", { name: "Add Chart to Canvas" }).click();
  36 |   await expect(page.getByRole("dialog", { name: "Add visual to canvas" })).toBeHidden();
  37 |   await expect(page.getByText("1 visual on page")).toBeVisible();
  38 | 
  39 |   // ── AI chat command ──────────────────────────────────────────────────
  40 |   await page.getByRole("button", { name: "Open AI assistant" }).click();
  41 |   const chatInput = page.getByRole("textbox", { name: "Message to AI assistant" });
  42 |   await expect(chatInput).toBeEnabled();
  43 |   await chatInput.fill("create a revenue kpi");
  44 |   await page.getByRole("button", { name: "Send message" }).click();
  45 | 
  46 |   // The mock provider auto-executes this (not destructive/bulk/dashboard-wide
  47 |   // — see backend/src/ai/confirmation.ts), so no confirmation click needed.
> 48 |   await expect(page.getByText("Created a revenue KPI.")).toBeVisible({ timeout: 15_000 });
     |                                                          ^ Error: expect(locator).toBeVisible() failed
  49 |   await page.getByRole("button", { name: "Close AI assistant" }).click();
  50 |   await expect(page.getByText("2 visuals on page")).toBeVisible();
  51 | 
  52 |   // ── Undo ─────────────────────────────────────────────────────────────
  53 |   // Reverts the AI's batch as one atomic step, back down to just the manual chart.
  54 |   await page.getByRole("button", { name: /Undo last edit/ }).click();
  55 |   await expect(page.getByText("1 visual on page")).toBeVisible();
  56 | 
  57 |   // ── Theme change ─────────────────────────────────────────────────────
  58 |   await expect(page.locator("html")).toHaveAttribute("data-theme-mode", "dark");
  59 |   await page.getByRole("button", { name: /^Theme:/ }).click();
  60 |   await page.getByRole("option", { name: "Light" }).click();
  61 |   await expect(page.locator("html")).toHaveAttribute("data-theme-mode", "light");
  62 | 
  63 |   // ── Export: CSV ──────────────────────────────────────────────────────
  64 |   await page.getByRole("button", { name: "Export" }).click();
  65 |   const [csvDownload] = await Promise.all([
  66 |     page.waitForEvent("download"),
  67 |     page.getByRole("menuitem", { name: /Export dataset as CSV/ }).click(),
  68 |   ]);
  69 |   expect(csvDownload.suggestedFilename()).toMatch(/\.csv$/);
  70 | 
  71 |   // ── Export: PNG ──────────────────────────────────────────────────────
  72 |   await page.getByRole("button", { name: "Export" }).click();
  73 |   const [pngDownload] = await Promise.all([
  74 |     page.waitForEvent("download"),
  75 |     page.getByRole("menuitem", { name: /Export as PNG/ }).click(),
  76 |   ]);
  77 |   expect(pngDownload.suggestedFilename()).toMatch(/\.png$/);
  78 | });
  79 | 
```