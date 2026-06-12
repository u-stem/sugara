import {
  BASE_URL,
  clearIdbCache,
  createTripViaUI,
  expect,
  nextTestIp,
  signupUser,
  test,
} from "./fixtures/auth";

test.describe("Notifications", () => {
  test("shows unread badge when member is added to trip", async ({
    authenticatedPage: page,
    browser,
  }) => {
    // Create member context with a unique IP to avoid rate limiting on
    // /api/auth/* endpoints (shared "unknown" bucket without the header).
    const memberContext = await browser.newContext({
      baseURL: BASE_URL,
      extraHTTPHeaders: { "x-forwarded-for": nextTestIp() },
    });
    const memberPage = await memberContext.newPage();
    await signupUser(memberPage, {
      username: `notif${Date.now()}`,
      name: "Notif User",
    });

    await memberPage.goto("/my");
    const memberId = await memberPage.locator('[data-testid="user-id"]').textContent();
    expect(memberId).toBeTruthy();

    await createTripViaUI(page, {
      title: "Notification Trip",
      destination: "Sendai",
    });

    await page.getByRole("button", { name: "メンバー" }).click();
    await page.getByRole("tab", { name: "IDで追加" }).click();
    await page.locator("#member-user-id").fill(memberId!);
    await page.getByRole("button", { name: "追加" }).click();
    await expect(page.getByText("メンバーを追加しました")).toBeVisible();

    // notifyUsers is fire-and-forget (void promise) on the server: the 201 is
    // returned before the DB write completes. Wait briefly so the insert lands
    // before memberPage's notification query fires on reload.
    await page.waitForTimeout(500);

    // Clear IDB so the stale unreadCount=0 entry (written when the member first
    // visited /home) does not suppress the refetch on reload.
    await clearIdbCache(memberPage);

    // Member reloads and should see notification badge
    await memberPage.reload();
    const badge = memberPage.locator("button:has(.lucide-bell) span").first();
    await expect(badge).toBeVisible({ timeout: 15000 });

    await memberContext.close();
  });

  test("marks all notifications as read", async ({
    authenticatedPage: page,
    browser,
  }) => {
    // Create member context with a unique IP to avoid rate limiting
    const memberContext = await browser.newContext({
      baseURL: BASE_URL,
      extraHTTPHeaders: { "x-forwarded-for": nextTestIp() },
    });
    const memberPage = await memberContext.newPage();
    await signupUser(memberPage, {
      username: `notif2${Date.now()}`,
      name: "Notif User 2",
    });

    await memberPage.goto("/my");
    const memberId = await memberPage.locator('[data-testid="user-id"]').textContent();
    expect(memberId).toBeTruthy();

    await createTripViaUI(page, {
      title: "Mark Read Trip",
      destination: "Kanazawa",
    });

    await page.getByRole("button", { name: "メンバー" }).click();
    await page.getByRole("tab", { name: "IDで追加" }).click();
    await page.locator("#member-user-id").fill(memberId!);
    await page.getByRole("button", { name: "追加" }).click();
    await expect(page.getByText("メンバーを追加しました")).toBeVisible();

    // notifyUsers is fire-and-forget (void promise) on the server: the 201 is
    // returned before the DB write completes. Wait briefly so the insert lands
    // before memberPage's notification query fires on reload.
    await page.waitForTimeout(500);

    // Clear IDB so the stale unreadCount=0 entry (written when the member first
    // visited /home) does not suppress the refetch on reload.
    await clearIdbCache(memberPage);

    // Member opens notification dropdown and marks all as read.
    // Wait for the badge to confirm the notification arrived before clicking.
    await memberPage.reload();
    await expect(memberPage.locator("button:has(.lucide-bell) span").first()).toBeVisible({
      timeout: 15000,
    });
    await memberPage.locator("button:has(.lucide-bell)").click();
    await expect(memberPage.getByText("すべて既読")).toBeVisible({ timeout: 5000 });

    await memberPage.getByText("すべて既読").click();

    // Badge should disappear after marking all read
    await expect(memberPage.locator("button:has(.lucide-bell) span")).not.toBeVisible({
      timeout: 5000,
    });

    await memberContext.close();
  });

  test("can toggle in-app notification preferences", async ({ authenticatedPage: page }) => {
    await page.goto("/settings");
    await page.getByRole("tab", { name: "通知" }).click();

    // Each category row has an in-app switch with aria-label "{category} アプリ内通知"
    const memberToggle = page.getByRole("switch", { name: "メンバー アプリ内通知" });
    await expect(memberToggle).toBeVisible();

    const initialState = await memberToggle.isChecked();

    await memberToggle.click();
    // Switch state reflects an API mutation, so wait for the update to propagate.
    await expect(memberToggle).toBeChecked({ checked: !initialState });

    // Toggle back to original state
    await memberToggle.click();
    await expect(memberToggle).toBeChecked({ checked: initialState });
  });
});
