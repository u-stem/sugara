import { type Page, test as base, expect } from "@playwright/test";

export const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000";

const DEFAULT_PASSWORD = "TestPassword123!";

type AuthFixtures = {
  authenticatedPage: Page;
  userCredentials: { username: string; password: string; name: string };
};

export async function signupUser(
  page: Page,
  options: { username: string; name: string; password?: string },
): Promise<void> {
  await page.goto("/auth/signup");
  await page.getByLabel("ユーザー名").fill(options.username);
  await page.getByLabel("表示名").fill(options.name);
  const password = options.password ?? DEFAULT_PASSWORD;
  await page.locator("#password").fill(password);
  await page.locator("#confirmPassword").fill(password);
  await page.getByLabel("利用規約").check({ force: true });
  await page.getByRole("button", { name: "新規登録" }).click();
  await expect(page).toHaveURL(/\/home/, { timeout: 10000 });
}

// Per-test counter for synthetic client IPs (workers: 1, so module scope is safe
// per worker; workerIndex keeps parallel workers collision-free if ever enabled).
// Start at a random offset so consecutive runs don't reuse the same IPs — the
// dev server's in-memory rate-limit cache persists within the 60-second window,
// and fixed-start counters (e.g. 0) cause accumulated counts to trip the limits.
let testIpCounter = Math.floor(Math.random() * 16_777_115);

// Generate a unique synthetic IP for secondary browser contexts (viewer/editor users
// created inside test bodies via browser.newContext()). These contexts don't receive
// the extraHTTPHeaders fixture, so callers must pass a header explicitly. Each call
// increments the shared counter, keeping secondary IPs distinct from primary ones.
// The worker octet comes from Playwright's own TEST_WORKER_INDEX env so the
// default stays collision-free even if workers > 1 is ever enabled.
export function nextTestIp(): string {
  const workerIndex = Number(process.env.TEST_WORKER_INDEX) || 0;
  testIpCounter += 1;
  return `10.${workerIndex}.${Math.floor(testIpCounter / 256)}.${testIpCounter % 256}`;
}

// Drop the persisted React Query snapshot (PersistQueryClientProvider writes it
// to IndexedDB). A full page load restores that snapshot and, within staleTime,
// uses it without refetching — so data created outside the page (API calls,
// another context) stays invisible until the entry is wiped.
export async function clearIdbCache(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await new Promise<void>((resolve) => {
      const req = indexedDB.open("keyval-store");
      req.onerror = () => resolve();
      req.onsuccess = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("keyval")) {
          db.close();
          resolve();
          return;
        }
        const tx = db.transaction("keyval", "readwrite");
        tx.objectStore("keyval").delete("sugara-query-cache");
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => {
          db.close();
          resolve();
        };
        tx.onabort = () => {
          db.close();
          resolve();
        };
      };
    });
  });
}

export const test = base.extend<AuthFixtures>({
  // Give every test a unique synthetic client IP. The auth endpoints are
  // rate-limited per IP (apps/api/src/middleware/rate-limit.ts; sign-up is
  // 3/min), and without a proxy header all local/CI traffic collapses into the
  // single "unknown" bucket, throttling the suite. resolveIp trusts the last
  // x-forwarded-for entry only when no x-real-ip is present, which is never the
  // case behind Vercel — so this spoof works exactly and only in local/CI runs.
  extraHTTPHeaders: async ({}, use, testInfo) => {
    testIpCounter += 1;
    const ip = `10.${testInfo.workerIndex}.${Math.floor(testIpCounter / 256)}.${testIpCounter % 256}`;
    await use({ "x-forwarded-for": ip });
  },

  userCredentials: async ({}, use) => {
    const credentials = {
      username: `e2e_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      password: DEFAULT_PASSWORD,
      name: "E2E User",
    };
    await use(credentials);
  },

  authenticatedPage: async ({ page, userCredentials }, use) => {
    await signupUser(page, userCredentials);
    await use(page);
  },
});

export { expect } from "@playwright/test";

export async function createTripWithPollViaUI(
  page: Page,
  options: { title: string; destination?: string },
): Promise<string> {
  await page.getByRole("button", { name: "新規作成" }).click();
  const dialog = page.getByRole("dialog", { name: "新しい旅行を作成" });
  await expect(dialog).toBeVisible();

  await dialog.locator("#create-title").fill(options.title);
  if (options.destination) {
    await dialog.locator("#create-destination").fill(options.destination);
  }

  // Switch to poll mode
  await dialog.getByRole("tab", { name: "日程を調整する" }).click();

  // Select a date range (late-month dates to avoid past-date issues) and add as candidate
  // NOTE: gridcell aria-labels include the year (e.g. "2026年3月20日"), so /20/ would match
  // "2026" too. Use hasText to match the visible day number text instead.
  const firstGrid = dialog.getByRole("grid").first();
  await firstGrid.getByRole("gridcell").filter({ hasText: "20" }).click();
  await firstGrid.getByRole("gridcell").filter({ hasText: "22" }).click();
  await dialog.getByRole("button", { name: "日程案に追加" }).click();

  await dialog.getByRole("button", { name: "作成" }).click();
  await expect(dialog).not.toBeVisible({ timeout: 15000 });

  const tripLink = page.getByRole("link", { name: new RegExp(options.title) }).first();
  await expect(tripLink).toBeVisible({ timeout: 15000 });
  await tripLink.click();
  await expect(page).toHaveURL(/\/trips\/[a-f0-9-]+/, { timeout: 10000 });

  return page.url();
}

export async function createBookmarkListViaUI(
  page: Page,
  name: string,
): Promise<void> {
  await page.goto("/bookmarks");
  await page.getByRole("button", { name: "新規作成" }).click();
  await page.locator("#new-list-name").fill(name);
  await page.getByRole("button", { name: "作成" }).click();
  await expect(page.getByText("リストを作成しました")).toBeVisible();
}

export async function createTripViaUI(
  page: Page,
  options: { title: string; destination: string },
): Promise<string> {
  // Open create trip dialog
  await page.getByRole("button", { name: "新規作成" }).click();
  const dialog = page.getByRole("dialog", { name: "新しい旅行を作成" });
  await expect(dialog).toBeVisible();

  await dialog.locator("#create-title").fill(options.title);
  await dialog.locator("#create-destination").fill(options.destination);

  // Select date range in the calendar (use late-month dates to avoid past-date issues)
  // NOTE: gridcell aria-labels include the year (e.g. "2026年3月20日"), so /20/ would match
  // "2026" too. Use hasText to match the visible day number text instead.
  const firstGrid = dialog.getByRole("grid").first();
  await firstGrid.getByRole("gridcell").filter({ hasText: "20" }).click();
  await firstGrid.getByRole("gridcell").filter({ hasText: "22" }).click();

  await dialog.getByRole("button", { name: "作成" }).click();
  await expect(dialog).not.toBeVisible({ timeout: 15000 });

  // Trip creation no longer navigates to detail; click the trip card to navigate
  const tripLink = page.getByRole("link", { name: new RegExp(options.title) }).first();
  await expect(tripLink).toBeVisible({ timeout: 15000 });
  await tripLink.click();
  await expect(page).toHaveURL(/\/trips\/[a-f0-9-]+/, { timeout: 10000 });

  return page.url();
}
