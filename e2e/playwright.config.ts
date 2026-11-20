import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

/**
 * Playwright's own browser-binary download is blocked in this sandbox (no
 * network access to cdn.playwright.dev), so every project below drives the
 * system-installed Chrome via an explicit `executablePath` instead of a
 * Playwright-managed browser — the same workaround used for the manual
 * responsiveness/accessibility pass earlier in this project. On a machine
 * where Playwright's browsers ARE installed, drop `executablePath` (or set
 * `PLAYWRIGHT_CHROME_PATH`) and this still works via the bundled Chromium.
 */
const chromePath =
  process.env.PLAYWRIGHT_CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  // A real upload -> parse -> profile round trip, an AI turn, and several UI
  // interactions comfortably exceed Playwright's 30s default under a cold
  // dev-server start (first request after `tsx watch`/Vite's dep
  // pre-bundling finishes compiling) — this is normal for this app's actual
  // work, not a hung test.
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "Desktop Chrome",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        launchOptions: { executablePath: chromePath },
      },
    },
    {
      name: "Mobile Chrome",
      use: {
        ...devices["Pixel 7"],
        launchOptions: { executablePath: chromePath },
      },
    },
  ],
  // Reuses whatever's already running locally (e.g. during iterative
  // development) instead of always spawning a fresh pair of dev servers.
  webServer: [
    {
      command: "npm run dev --workspace=backend",
      cwd: repoRoot,
      url: "http://localhost:4000/api/health",
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      command: "npm run dev --workspace=frontend",
      cwd: repoRoot,
      url: "http://localhost:5173",
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
});
