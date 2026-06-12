import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  retries: 0,
  // Prevent dev-server overload: tests share real DB state so parallel execution causes flakiness
  workers: 1,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000",
    trace: "on-first-retry",
    // The specs assert Japanese UI text; locale resolution falls back to
    // Accept-Language (i18n/request.ts), so pin the browser to ja explicitly.
    locale: "ja-JP",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: "e2e/mobile-*.spec.ts",
    },
    {
      name: "mobile",
      use: { ...devices["Pixel 7"] },
      testMatch: "e2e/mobile-*.spec.ts",
    },
  ],
  webServer: process.env.CI
    ? undefined
    : {
        command: "bun run dev",
        url: "http://localhost:3000",
        reuseExistingServer: true,
      },
});
