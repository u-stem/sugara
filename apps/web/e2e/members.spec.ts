import { BASE_URL, createTripViaUI, expect, nextTestIp, signupUserViaApi, test } from "./fixtures/auth";

test.describe("Members", () => {
  test("adds a member and changes role", async ({
    authenticatedPage: page,
    browser,
  }) => {
    // Create a second user in a separate context with a unique IP to avoid
    // rate limiting on /api/auth/* endpoints (shared "unknown" bucket would
    // be exhausted without the header).
    const memberContext = await browser.newContext({
      baseURL: BASE_URL,
      extraHTTPHeaders: { "x-forwarded-for": nextTestIp() },
    });
    const memberPage = await memberContext.newPage();
    await signupUserViaApi(memberPage, {
      username: `member${Date.now()}`,
      name: "Member User",
    });

    // Get member's user ID from settings page
    await memberPage.goto("/my");
    const memberId = await memberPage.locator('[data-testid="user-id"]').textContent();
    expect(memberId).toBeTruthy();
    await memberContext.close();

    // Owner creates a trip
    await createTripViaUI(page, {
      title: "Member Test Trip",
      destination: "Sendai",
    });

    // Open member dialog and add the member by user ID
    await page.getByRole("button", { name: "メンバー" }).click();
    await page.getByRole("tab", { name: "IDで追加" }).click();
    await page.locator("#member-user-id").fill(memberId!);
    await page.getByRole("button", { name: "追加" }).click();
    await expect(page.getByText("メンバーを追加しました")).toBeVisible();

    // Verify member appears in the list
    await expect(page.getByText("Member User")).toBeVisible();

    // Change role to viewer
    const memberRow = page.getByText("Member User").locator("../..");
    await memberRow.getByRole("combobox").click();
    await page.getByRole("option", { name: "閲覧者" }).click();
    await expect(page.getByText("ロールを変更しました")).toBeVisible();
  });

  test("removes a member", async ({ authenticatedPage: page, browser }) => {
    // Create a second user with a unique IP to avoid rate limiting
    const memberContext = await browser.newContext({
      baseURL: BASE_URL,
      extraHTTPHeaders: { "x-forwarded-for": nextTestIp() },
    });
    const memberPage = await memberContext.newPage();
    await signupUserViaApi(memberPage, {
      username: `remove${Date.now()}`,
      name: "Remove User",
    });

    // Get member's user ID from settings page
    await memberPage.goto("/my");
    const memberId = await memberPage.locator('[data-testid="user-id"]').textContent();
    expect(memberId).toBeTruthy();
    await memberContext.close();

    // Owner creates a trip and adds member
    await createTripViaUI(page, {
      title: "Remove Member Test",
      destination: "Sapporo",
    });

    await page.getByRole("button", { name: "メンバー" }).click();
    await page.getByRole("tab", { name: "IDで追加" }).click();
    await page.locator("#member-user-id").fill(memberId!);
    await page.getByRole("button", { name: "追加" }).click();
    await expect(page.getByText("メンバーを追加しました")).toBeVisible();
    await expect(page.getByText("Remove User")).toBeVisible();

    // Remove the member - open the per-member action menu, then confirm deletion.
    // aria-label is tc("itemMenu", { name: member.name }) = "{name}のメニュー".
    await page.getByRole("button", { name: "Remove Userのメニュー" }).click();
    await page.getByRole("button", { name: "削除する" }).click();
    await expect(page.getByText("メンバーを削除しました")).toBeVisible();
    await expect(page.getByText("Remove User")).not.toBeVisible();
  });
});
