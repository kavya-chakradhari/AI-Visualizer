import { test, expect } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE_CSV = path.join(__dirname, "..", "fixtures", "sample.csv");

/**
 * The MVP-complete acceptance walk: upload -> manual chart creation -> AI
 * chat command -> undo -> theme change -> export. Runs against both the
 * "Desktop Chrome" and "Mobile Chrome" projects (see playwright.config.ts) —
 * every step below uses controls that stay visible and clickable at both
 * breakpoints per the responsive audit (icon-only buttons collapse their
 * label text under `sm:`, but never disappear or move off the visible
 * toolbar).
 *
 * Uses the backend's default "mock" AI provider (no API key required, see
 * backend/.env.example) — deterministic, so "create a revenue kpi" always
 * produces the same command without depending on a real model.
 */
test("upload, manual chart, AI command, undo, theme change, export", async ({ page }) => {
  await page.goto("/");

  // ── Upload ──────────────────────────────────────────────────────────
  await page.locator('input[type="file"]').setInputFiles(SAMPLE_CSV);
  await expect(page.getByText("Add Chart", { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("0 visuals on page")).toBeVisible();

  // ── Manual chart creation ────────────────────────────────────────────
  // Defaults (chart kind "bar", dimension/metric columns) are pre-populated
  // by the modal from the dataset schema — submitting immediately creates a
  // real chart with no further input needed.
  await page.getByRole("button", { name: "Add Chart" }).first().click();
  await expect(page.getByRole("dialog", { name: "Add visual to canvas" })).toBeVisible();
  await page.getByRole("button", { name: "Add Chart to Canvas" }).click();
  await expect(page.getByRole("dialog", { name: "Add visual to canvas" })).toBeHidden();
  await expect(page.getByText("1 visual on page")).toBeVisible();

  // ── AI chat command ──────────────────────────────────────────────────
  await page.getByRole("button", { name: "Open AI assistant" }).click();
  const chatInput = page.getByRole("textbox", { name: "Message to AI assistant" });
  await expect(chatInput).toBeEnabled();
  await chatInput.fill("create a revenue kpi");
  await page.getByRole("button", { name: "Send message" }).click();

  // The mock provider auto-executes this (not destructive/bulk/dashboard-wide
  // — see backend/src/ai/confirmation.ts), so no confirmation click needed.
  await expect(page.getByText("Created a revenue KPI.")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Close AI assistant" }).click();
  await expect(page.getByText("2 visuals on page")).toBeVisible();

  // ── Undo ─────────────────────────────────────────────────────────────
  // Reverts the AI's batch as one atomic step, back down to just the manual chart.
  await page.getByRole("button", { name: /Undo last edit/ }).click();
  await expect(page.getByText("1 visual on page")).toBeVisible();

  // ── Theme change ─────────────────────────────────────────────────────
  await expect(page.locator("html")).toHaveAttribute("data-theme-mode", "dark");
  await page.getByRole("button", { name: /^Theme:/ }).click();
  await page.getByRole("option", { name: "Light" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme-mode", "light");

  // ── Export: CSV ──────────────────────────────────────────────────────
  await page.getByRole("button", { name: "Export" }).click();
  const [csvDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("menuitem", { name: /Export dataset as CSV/ }).click(),
  ]);
  expect(csvDownload.suggestedFilename()).toMatch(/\.csv$/);

  // ── Export: PNG ──────────────────────────────────────────────────────
  await page.getByRole("button", { name: "Export" }).click();
  const [pngDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("menuitem", { name: /Export as PNG/ }).click(),
  ]);
  expect(pngDownload.suggestedFilename()).toMatch(/\.png$/);
});
