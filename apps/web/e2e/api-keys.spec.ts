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

    // Issue a key with the trips scope only
    await page.getByLabel("名前").fill("e2e key");
    await page.getByLabel("旅行", { exact: true }).check({ force: true });
    await page.getByRole("button", { name: "発行", exact: true }).click();

    // The raw key is shown exactly once in the dialog
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("キーを発行しました")).toBeVisible();
    const rawKey = (await dialog.locator("code").innerText()).trim();
    expect(rawKey).toMatch(/^sk_/);
    await page.screenshot({ path: "/tmp/apikeys-issued.png" });
    await dialog.getByRole("button", { name: "閉じる" }).click();

    // The list now shows the key (name + key prefix)
    await expect(page.getByText("e2e key")).toBeVisible();
    await expect(page.getByText(rawKey.slice(0, 11))).toBeVisible();
    await page.screenshot({ path: "/tmp/apikeys-list.png" });

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
});
