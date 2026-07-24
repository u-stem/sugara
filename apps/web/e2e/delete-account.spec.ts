import { BASE_URL, clearIdbCache, expect, signupUserViaApi, test } from "./fixtures/auth";

const PASSWORD = "TestPassword123!";
const DELETE_TIMEOUT_MS = 20000;

function shortId() {
  return Date.now().toString(36).slice(-6);
}

async function assignUniqueClientIp(page: import("@playwright/test").Page, seed?: string) {
  const value = seed ?? shortId();
  const suffix = [...value].reduce((acc, ch) => (acc + ch.charCodeAt(0)) % 253, 1);
  await page.context().setExtraHTTPHeaders({
    "x-forwarded-for": `10.23.0.${suffix}`,
  });
}

async function deleteAccount(page: import("@playwright/test").Page) {
  await page.goto("/settings");
  await page.getByRole("tab", { name: "アカウント" }).click();
  await page.getByRole("button", { name: "アカウントを削除" }).click();
  const dialog = page.getByRole("alertdialog", { name: "本当にアカウントを削除しますか？" });
  await dialog.getByLabel("パスワードを入力して確認").fill(PASSWORD);
  await dialog.getByRole("button", { name: "削除する" }).click();
  try {
    await expect(page).toHaveURL(/\/auth\/login/, { timeout: DELETE_TIMEOUT_MS });
  } catch (error) {
    const alert = dialog.getByRole("alert");
    const message = (await alert.textContent())?.trim();
    throw new Error(
      `Account deletion did not complete (message: ${message ?? "unknown"}, url: ${page.url()})`,
      { cause: error },
    );
  }
}

async function loginUser(
  page: import("@playwright/test").Page,
  username: string,
) {
  await page.goto("/auth/login");
  await page.getByLabel("ユーザー名").fill(username);
  await page.getByLabel("パスワード").fill(PASSWORD);
  await page.getByRole("button", { name: "ログイン" }).click();
}

test.describe("Delete Account", () => {
  test.describe.configure({ timeout: 120000 });

  test("cannot log in after account deletion", async ({
    authenticatedPage: page,
    userCredentials,
  }) => {
    await assignUniqueClientIp(page, userCredentials.username);
    await deleteAccount(page);

    // Re-login with same credentials should fail. Scope to the form so the
    // assertion targets the login error alert specifically — an async
    // announcement banner (also role="alert", rendered outside the form) can
    // otherwise race in and make a bare getByRole("alert") match 2 elements.
    await loginUser(page, userCredentials.username);
    await expect(page.locator("form").getByRole("alert")).toBeVisible({ timeout: 5000 });
    await expect(page).toHaveURL(/\/auth\/login/);
  });

  test("friend list shows no error after friend deletes account", async ({
    authenticatedPage: pageA,
    browser,
    userCredentials,
  }) => {
    await assignUniqueClientIp(pageA, userCredentials.username);

    // Create User B
    const contextB = await browser.newContext({ baseURL: BASE_URL });
    const pageB = await contextB.newPage();
    const userB = `delf_${shortId()}`;
    await assignUniqueClientIp(pageB, userB);
    await signupUserViaApi(pageB, { username: userB, name: "User B" });

    // Get User A's ID
    await pageA.goto("/my");
    const userAId = await pageA.locator('[data-testid="user-id"]').textContent();
    expect(userAId).toBeTruthy();

    // User B sends friend request to User A
    await pageB.goto("/friends");
    await pageB.getByPlaceholder("ユーザーIDを入力").fill(userAId!);
    await pageB.getByRole("button", { name: "検索" }).click();
    // Confirm dialog appears — send the request
    await pageB.getByRole("button", { name: "フレンド申請を送る" }).click();
    await expect(pageB.getByText("フレンド申請を送信しました")).toBeVisible();

    // User A accepts
    await clearIdbCache(pageA);
    await pageA.goto("/friends");
    await expect(pageA.getByText("User B")).toBeVisible();
    await pageA.getByRole("button", { name: "承認" }).click();
    await expect(pageA.getByText("フレンド申請を承認しました")).toBeVisible();

    // Verify friendship is established
    await expect(pageA.getByText("フレンド一覧")).toBeVisible();
    await expect(pageA.getByText("User B")).toBeVisible();

    // User B deletes account
    await deleteAccount(pageB);
    await contextB.close();

    // User A reloads friend list - no error, User B is gone
    // IDB may still cache User B in the friends list from the acceptance step;
    // clear it so useFriendsPage fetches fresh data from the server.
    await clearIdbCache(pageA);
    await pageA.goto("/friends");
    await expect(pageA.getByText("フレンド一覧")).toBeVisible();
    await expect(pageA.getByText("User B")).not.toBeVisible();
  });

  test("shared trips are not affected when a member deletes account", async ({
    authenticatedPage: pageA,
    browser,
    userCredentials,
  }) => {
    // This test orchestrates two users, two trips, member additions, account deletion,
    // and final state verification — significantly more steps than the other tests.
    // 240s gives headroom above the ~120s observed runtime.
    test.setTimeout(240000);
    await assignUniqueClientIp(pageA, userCredentials.username);

    // Create User B
    const contextB = await browser.newContext({ baseURL: BASE_URL });
    const pageB = await contextB.newPage();
    const userB = `delm_${shortId()}`;
    await assignUniqueClientIp(pageB, userB);
    await signupUserViaApi(pageB, { username: userB, name: "User B" });

    // Get User B's ID
    await pageB.goto("/my");
    const userBId = await pageB.locator('[data-testid="user-id"]').textContent();
    expect(userBId).toBeTruthy();

    // Get User A's ID
    await pageA.goto("/my");
    const userAId = await pageA.locator('[data-testid="user-id"]').textContent();
    expect(userAId).toBeTruthy();

    // User A creates a trip and adds User B.
    // Navigating to the trip detail page (as createTripViaUI does via tripLink.click)
    // triggers a 401 → useAuthRedirect while the page is idle during pageB's setup.
    // Stay on /home: create via dialog, extract the trip ID from the card link href,
    // and POST the member addition via pageA.request (shares pageA's session cookie).
    await pageA.goto("/home");
    await pageA.getByRole("button", { name: "新規作成" }).click();
    const aDialog = pageA.getByRole("dialog", { name: "新しい旅行を作成" });
    await expect(aDialog).toBeVisible();
    await aDialog.locator("#create-title").fill("A's Trip");
    await aDialog.locator("#create-destination").fill("Tokyo");
    const aGrid = aDialog.getByRole("grid").first();
    await aGrid.getByRole("gridcell").filter({ hasText: "20" }).click();
    await aGrid.getByRole("gridcell").filter({ hasText: "22" }).click();
    await aDialog.getByRole("button", { name: "作成" }).click();
    await expect(aDialog).not.toBeVisible({ timeout: 15000 });

    const aTripLink = pageA.getByRole("link", { name: /A's Trip/ }).first();
    await expect(aTripLink).toBeVisible({ timeout: 15000 });
    const aTripHref = await aTripLink.getAttribute("href");
    expect(aTripHref).toMatch(/^\/trips\/[a-f0-9-]+/);
    const aTripId = aTripHref!.replace(/^\/trips\//, "").split("/")[0];

    // Add User B as member via API (stays on /home, avoids trip-detail 401)
    const addBResp = await pageA.request.post(`/api/trips/${aTripId}/members`, {
      data: { userId: userBId!, role: "editor" },
    });
    expect(addBResp.status()).toBe(201);

    // User B creates a trip and adds User A.
    // Same approach: stay on /home, create via dialog, add member via API.
    await clearIdbCache(pageB);
    await pageB.goto("/home");
    await pageB.getByRole("button", { name: "新規作成" }).click();
    const bDialog = pageB.getByRole("dialog", { name: "新しい旅行を作成" });
    await expect(bDialog).toBeVisible();
    await bDialog.locator("#create-title").fill("B's Trip");
    await bDialog.locator("#create-destination").fill("Osaka");
    const bGrid = bDialog.getByRole("grid").first();
    await bGrid.getByRole("gridcell").filter({ hasText: "20" }).click();
    await bGrid.getByRole("gridcell").filter({ hasText: "22" }).click();
    await bDialog.getByRole("button", { name: "作成" }).click();
    await expect(bDialog).not.toBeVisible({ timeout: 15000 });

    const bTripLink = pageB.getByRole("link", { name: /B's Trip/ }).first();
    await expect(bTripLink).toBeVisible({ timeout: 15000 });
    const bTripHref = await bTripLink.getAttribute("href");
    expect(bTripHref).toMatch(/^\/trips\/[a-f0-9-]+/);
    const bTripId = bTripHref!.replace(/^\/trips\//, "").split("/")[0];

    // Add User A as member via API (pageB.request shares contextB's session cookie)
    const addMemberResp = await pageB.request.post(`/api/trips/${bTripId}/members`, {
      data: { userId: userAId!, role: "editor" },
    });
    expect(addMemberResp.status()).toBe(201);

    // Clear IDB so PersistQueryClientProvider starts fresh on the next full
    // navigation (/settings). pageA has stayed on /home throughout setup, so the
    // session is still valid; this just ensures no stale trip data is restored.
    await clearIdbCache(pageA);

    // User A deletes account
    await deleteAccount(pageA);

    // Verify pageB session is still valid after User A's deletion.
    // Check both Playwright's request context and the in-page fetch() to detect
    // any BroadcastChannel signOut bleed or cookie isolation issues.
    const sessionCheck = await pageB.request.get("/api/trips?scope=owned");
    expect(sessionCheck.status(), "pageB session must be valid (request API)").toBe(200);
    const inBrowserStatus = await pageB.evaluate(async () => {
      const res = await fetch("/api/trips?scope=owned", { credentials: "include" });
      return res.status;
    });
    expect(inBrowserStatus, "pageB session must be valid (in-browser fetch)").toBe(200);

    // A's trip should be gone (CASCADE deleted with user A's account)
    const aTripResp = await pageB.request.get(`/api/trips/${aTripId}`);
    expect(aTripResp.status(), "A's trip should be gone after account deletion (CASCADE)").toBe(404);

    // B's trip should still exist and be accessible to User B
    const bTripResp = await pageB.request.get(`/api/trips/${bTripId}`);
    expect(bTripResp.status(), "B's trip should still exist").toBe(200);

    // User A should no longer be a member of B's trip (CASCADE-deleted with user A)
    const membersResp = await pageB.request.get(`/api/trips/${bTripId}/members`);
    expect(membersResp.status(), "B's trip members endpoint should be accessible").toBe(200);
    const members = await membersResp.json();
    const hasUserA =
      Array.isArray(members) && members.some((m: { userId: string }) => m.userId === userAId);
    expect(hasUserA, "User A should not be in B's trip member list after deletion").toBe(false);

    // UI verification, restored per issue #162: the historical flake here was
    // the proxy treating a rate-limited (429) get-session as "unauthenticated"
    // and bouncing valid sessions to /auth/login. Fixed by the dedicated
    // get-session rate limit (#163) and the proxy failing open on non-OK
    // session checks instead of redirecting.
    await clearIdbCache(pageB);
    await pageB.goto("/home");
    await expect(pageB).toHaveURL(/\/home/);
    await expect(pageB.getByRole("link", { name: /B's Trip/ }).first()).toBeVisible({
      timeout: 15000,
    });
    await expect(pageB.getByRole("link", { name: /A's Trip/ })).not.toBeVisible();

    await contextB.close();
  });
});
