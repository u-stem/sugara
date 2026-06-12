import { BASE_URL, clearIdbCache, expect, nextTestIp, signupUser, test } from "./fixtures/auth";

test.describe("Friends", () => {
  test("sends a friend request, accepts it, and removes friend", async ({
    authenticatedPage: page,
    browser,
  }) => {
    // Create user B in a separate context with a unique IP to avoid rate limiting
    const contextB = await browser.newContext({
      baseURL: BASE_URL,
      extraHTTPHeaders: { "x-forwarded-for": nextTestIp() },
    });
    const pageB = await contextB.newPage();
    await signupUser(pageB, {
      username: `friend_b_${Date.now()}`,
      name: "Friend B",
    });

    // Get user B's ID
    await pageB.goto("/my");
    const userBId = await pageB.locator('[data-testid="user-id"]').textContent();
    expect(userBId).toBeTruthy();

    // User A sends friend request to user B via inline form
    await page.goto("/friends");
    await page.getByPlaceholder("ユーザーIDを入力").fill(userBId!);
    await page.getByRole("button", { name: "検索" }).click();

    // Confirm dialog appears — send the request
    await expect(page.getByText("Friend B")).toBeVisible();
    await page.getByRole("button", { name: "フレンド申請を送る" }).click();
    await expect(page.getByText("フレンド申請を送信しました")).toBeVisible();

    // User B sees the request and accepts it
    await clearIdbCache(pageB);
    await pageB.goto("/friends");
    await expect(pageB.getByText("フレンドリクエスト")).toBeVisible();
    await expect(pageB.getByText("E2E User")).toBeVisible();
    await pageB.getByRole("button", { name: "承認" }).click();
    await expect(pageB.getByText("フレンド申請を承認しました")).toBeVisible();

    // User B sees user A in friend list
    await expect(pageB.getByText("フレンド一覧")).toBeVisible();
    await expect(pageB.getByText("E2E User")).toBeVisible();

    // User A sees user B in friend list after reload
    // IDB may cache the old (empty) friends list from the /home visit; clear it
    // so useFriendsPage fetches fresh data showing Friend B.
    await clearIdbCache(page);
    await page.goto("/friends");
    await expect(page.getByText("Friend B")).toBeVisible();

    // User A removes user B
    await page.getByRole("button", { name: "解除" }).click();
    await page.getByRole("button", { name: "解除する" }).click();
    await expect(page.getByText("フレンドを解除しました")).toBeVisible();
    await expect(page.getByText("フレンドがいません")).toBeVisible();

    await contextB.close();
  });

  test("rejects a friend request", async ({
    authenticatedPage: page,
    browser,
  }) => {
    // Create user C with a unique IP to avoid rate limiting
    const contextC = await browser.newContext({
      baseURL: BASE_URL,
      extraHTTPHeaders: { "x-forwarded-for": nextTestIp() },
    });
    const pageC = await contextC.newPage();
    await signupUser(pageC, {
      username: `friend_c_${Date.now()}`,
      name: "Friend C",
    });

    // Get user A's ID
    await page.goto("/my");
    const userAId = await page.locator('[data-testid="user-id"]').textContent();
    expect(userAId).toBeTruthy();

    // User C sends request to user A via inline form
    await pageC.goto("/friends");
    await pageC.getByPlaceholder("ユーザーIDを入力").fill(userAId!);
    await pageC.getByRole("button", { name: "検索" }).click();
    await pageC.getByRole("button", { name: "フレンド申請を送る" }).click();
    await expect(pageC.getByText("フレンド申請を送信しました")).toBeVisible();

    // User A rejects the request
    await clearIdbCache(page);
    await page.goto("/friends");
    await expect(page.getByText("フレンドリクエスト")).toBeVisible();
    await expect(page.getByText("Friend C")).toBeVisible();
    await page.getByRole("button", { name: "拒否" }).click();
    await expect(page.getByText("フレンド申請を拒否しました")).toBeVisible();

    // Request section disappears
    await expect(page.getByText("フレンドリクエスト")).not.toBeVisible();

    await contextC.close();
  });

  test("QR button on my page opens QR dialog", async ({ authenticatedPage: page }) => {
    await page.goto("/my");
    const qrButton = page.getByRole("button", { name: "QRコード" });
    await expect(qrButton).toBeVisible();
    await qrButton.click();
    await expect(page.getByText("フレンド追加用QRコード")).toBeVisible();
    await expect(page.getByText(/相手がスキャンすると/)).toBeVisible();
  });

  test("inline form shows confirm dialog with profile for valid userId", async ({
    authenticatedPage: page,
    browser,
  }) => {
    const contextB = await browser.newContext({
      baseURL: BASE_URL,
      extraHTTPHeaders: { "x-forwarded-for": nextTestIp() },
    });
    const pageB = await contextB.newPage();
    await signupUser(pageB, {
      username: `qr_target_${Date.now()}`,
      name: "QR Target User",
    });

    await pageB.goto("/my");
    const userBId = await pageB.locator('[data-testid="user-id"]').textContent();
    expect(userBId).toBeTruthy();

    // Enter user ID in inline form
    await page.goto("/friends");
    await page.getByPlaceholder("ユーザーIDを入力").fill(userBId!);
    await page.getByRole("button", { name: "検索" }).click();

    // Confirm dialog shows profile
    await expect(page.getByText("QR Target User")).toBeVisible();
    await expect(page.getByRole("button", { name: "フレンド申請を送る" })).toBeVisible();

    await contextB.close();
  });

  test("inline form shows error for own userId", async ({
    authenticatedPage: page,
  }) => {
    await page.goto("/my");
    const ownId = await page.locator('[data-testid="user-id"]').textContent();
    expect(ownId).toBeTruthy();

    await page.goto("/friends");
    await page.getByPlaceholder("ユーザーIDを入力").fill(ownId!);
    await page.getByRole("button", { name: "検索" }).click();

    await expect(page.getByText("自分自身にフレンド申請はできません")).toBeVisible();
  });
});
