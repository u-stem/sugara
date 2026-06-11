import { expect, test } from "@playwright/test";

// Covers the full API key lifecycle through the real UI: issue a key from the
// settings tab, read /api/v1 with it, verify scope enforcement, then revoke it
// from the list and confirm the key stops working immediately.
test.describe("API keys", () => {
  // The spec drives the UI via Japanese labels; pin the browser locale so
  // next-intl's Accept-Language fallback cannot switch the page to English.
  test.use({ locale: "ja-JP" });

  const username = `e2e_apikey_${Date.now()}`;
  const password = "TestPassword123!";
  const name = "E2E ApiKey User";

  test("issue, use against /api/v1, and revoke", async ({ page, request }) => {
    // Sign up a fresh (non-guest) user
    await page.goto("/auth/signup");
    await page.getByLabel("ユーザー名").fill(username);
    await page.getByLabel("表示名").fill(name);
    await page.locator("#password").fill(password);
    await page.locator("#confirmPassword").fill(password);
    await page.getByLabel("利用規約").check({ force: true });
    await page.getByRole("button", { name: "新規登録" }).click();
    await expect(page).toHaveURL(/\/home/, { timeout: 10000 });

    // Open the API keys tab in settings
    await page.goto("/settings");
    await page.getByRole("tab", { name: "API キー" }).click();
    await expect(page.getByText("発行済みのキーはありません")).toBeVisible();

    // Issue a key with the trips read scope only
    await page.getByLabel("名前").fill("e2e key");
    await page.getByLabel("旅行(読み取り)", { exact: true }).check({ force: true });
    await page.getByRole("button", { name: "発行", exact: true }).click();

    // The raw key is shown exactly once in the dialog
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("キーを発行しました")).toBeVisible();
    const rawKey = (await dialog.locator("code").innerText()).trim();
    expect(rawKey).toMatch(/^sk_/);
    await dialog.getByRole("button", { name: "閉じる" }).click();

    // The list now shows the key (name + key prefix)
    await expect(page.getByText("e2e key")).toBeVisible();
    await expect(page.getByText(rawKey.slice(0, 11))).toBeVisible();

    // The key reads /api/v1 within its scope
    const ok = await request.get("/api/v1/trips", {
      headers: { Authorization: `Bearer ${rawKey}` },
    });
    expect(ok.status()).toBe(200);
    const body = await ok.json();
    expect(Array.isArray(body.data)).toBe(true);

    // Missing auth is rejected
    const noAuth = await request.get("/api/v1/trips");
    expect(noAuth.status()).toBe(401);

    // A scope the key does not hold is rejected
    const wrongScope = await request.get("/api/v1/articles", {
      headers: { Authorization: `Bearer ${rawKey}` },
    });
    expect(wrongScope.status()).toBe(403);

    // Revoke from the UI
    await page.getByRole("button", { name: "e2e key を削除" }).click();
    await page.getByRole("button", { name: "削除する" }).click();
    await expect(page.getByText("発行済みのキーはありません")).toBeVisible({ timeout: 10000 });

    // The revoked key stops working immediately
    const revoked = await request.get("/api/v1/trips", {
      headers: { Authorization: `Bearer ${rawKey}` },
    });
    expect(revoked.status()).toBe(401);
  });

  test("write scope allows POST while a read-only key is rejected", async ({ page, request }) => {
    const writeUser = `e2e_apikey_w_${Date.now()}`;

    // Sign up a fresh (non-guest) user
    await page.goto("/auth/signup");
    await page.getByLabel("ユーザー名").fill(writeUser);
    await page.getByLabel("表示名").fill(name);
    await page.locator("#password").fill(password);
    await page.locator("#confirmPassword").fill(password);
    await page.getByLabel("利用規約").check({ force: true });
    await page.getByRole("button", { name: "新規登録" }).click();
    await expect(page).toHaveURL(/\/home/, { timeout: 10000 });

    await page.goto("/settings");
    await page.getByRole("tab", { name: "API キー" }).click();

    // Issue a read-only key, then a write key, capturing each raw key from
    // the one-time dialog before it closes.
    const issueKey = async (keyName: string, scopeLabel: string): Promise<string> => {
      await page.getByLabel("名前").fill(keyName);
      await page.getByLabel(scopeLabel, { exact: true }).check({ force: true });
      await page.getByRole("button", { name: "発行", exact: true }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog.getByText("キーを発行しました")).toBeVisible();
      const raw = (await dialog.locator("code").innerText()).trim();
      await dialog.getByRole("button", { name: "閉じる" }).click();
      // Scope checkboxes keep their state between issues; uncheck for the next round
      await page.getByLabel(scopeLabel, { exact: true }).uncheck({ force: true });
      return raw;
    };

    const readKey = await issueKey("e2e read key", "旅行(読み取り)");
    const writeKey = await issueKey("e2e write key", "旅行(作成・更新)");

    const tripBody = {
      title: "E2E write trip",
      startDate: "2026-07-01",
      endDate: "2026-07-03",
    };

    // A read-only key cannot create a trip
    const denied = await request.post("/api/v1/trips", {
      headers: { Authorization: `Bearer ${readKey}` },
      data: tripBody,
    });
    expect(denied.status()).toBe(403);

    // A write key creates the trip
    const created = await request.post("/api/v1/trips", {
      headers: { Authorization: `Bearer ${writeKey}` },
      data: tripBody,
    });
    expect(created.status()).toBe(201);
    const createdBody = await created.json();
    expect(createdBody.title).toBe("E2E write trip");

    // Write does not imply read — the write-only key cannot list trips
    const readDenied = await request.get("/api/v1/trips", {
      headers: { Authorization: `Bearer ${writeKey}` },
    });
    expect(readDenied.status()).toBe(403);
  });
});
