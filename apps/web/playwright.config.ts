import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  // One retry on CI pairs with trace: "on-first-retry" — a flake gets absorbed
  // AND leaves a trace artifact for diagnosis. Locally fail fast.
  retries: process.env.CI ? 1 : 0,
  // File-level parallelism is safe: every test signs up its own user with a
  // unique synthetic IP (fixtures/auth.ts), and the only shared DB state is
  // the read-only FAQ seed. fullyParallel stays false so tests within a file
  // run serially, which keeps the Date.now()-based secondary usernames
  // (e.g. roles.spec.ts) collision-free. The real ceiling is CPU: in CI the
  // runner also hosts next start and the Supabase stack. Locally the dev
  // server recompiles on demand, so default to 1; override via
  // PLAYWRIGHT_WORKERS to experiment in either environment.
  workers: process.env.PLAYWRIGHT_WORKERS
    ? Number(process.env.PLAYWRIGHT_WORKERS)
    : process.env.CI
      ? 2
      : 1,
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
