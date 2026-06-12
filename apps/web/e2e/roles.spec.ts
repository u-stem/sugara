import type { Browser, Page } from "@playwright/test";
import { BASE_URL, createTripViaUI, expect, nextTestIp, signupUser, test } from "./fixtures/auth";

async function setupViewerMember(
  page: Page,
  browser: Browser,
  tripTitle: string,
): Promise<{ ctx: Awaited<ReturnType<Browser["newContext"]>>; memberPage: Page; tripUrl: string }> {
  const ctx = await browser.newContext({
    baseURL: BASE_URL,
    extraHTTPHeaders: { "x-forwarded-for": nextTestIp() },
  });
  const memberPage = await ctx.newPage();
  await signupUser(memberPage, {
    username: `viewer${Date.now()}`,
    name: "Viewer User",
  });

  await memberPage.goto("/my");
  const memberId = await memberPage.locator('[data-testid="user-id"]').textContent();

  await createTripViaUI(page, { title: tripTitle, destination: "Tokyo" });

  await page.getByRole("button", { name: "メンバー" }).click();
  await page.getByRole("tab", { name: "IDで追加" }).click();
  await page.locator("#member-user-id").fill(memberId!);
  await page.getByRole("button", { name: "追加" }).click();
  await expect(page.getByText("メンバーを追加しました")).toBeVisible();

  // Change role to viewer
  const memberRow = page.getByText("Viewer User").locator("../..");
  await memberRow.getByRole("combobox").click();
  await page.getByRole("option", { name: "閲覧者" }).click();
  await expect(page.getByText("ロールを変更しました")).toBeVisible();

  await page.keyboard.press("Escape");

  const tripUrl = page.url();
  return { ctx, memberPage, tripUrl };
}

test.describe("Roles and Permissions", () => {
  test("viewer cannot see schedule add button", async ({
    authenticatedPage: page,
    browser,
  }) => {
    const { ctx, memberPage, tripUrl } = await setupViewerMember(
      page,
      browser,
      "Viewer Schedule Test",
    );

    await memberPage.goto(tripUrl);
    await expect(memberPage).toHaveURL(/\/trips\//, { timeout: 10000 });

    await expect(memberPage.getByRole("button", { name: "予定を追加" })).not.toBeVisible();

    await ctx.close();
  });

  test("viewer cannot see candidate add button", async ({
    authenticatedPage: page,
    browser,
  }) => {
    const { ctx, memberPage, tripUrl } = await setupViewerMember(
      page,
      browser,
      "Viewer Candidate Test",
    );

    await memberPage.goto(tripUrl);
    await expect(memberPage).toHaveURL(/\/trips\//, { timeout: 10000 });

    await expect(memberPage.getByRole("button", { name: "候補を追加" })).not.toBeVisible();

    await ctx.close();
  });

  test("viewer cannot see expense add button", async ({
    authenticatedPage: page,
    browser,
  }) => {
    const { ctx, memberPage, tripUrl } = await setupViewerMember(
      page,
      browser,
      "Viewer Expense Test",
    );

    await memberPage.goto(tripUrl);
    await expect(memberPage).toHaveURL(/\/trips\//, { timeout: 10000 });

    // Navigate to expenses tab in the right panel
    await memberPage.getByRole("tab", { name: "費用" }).click();
    await expect(memberPage.getByRole("button", { name: "費用を追加" })).not.toBeVisible();

    await ctx.close();
  });

  // Souvenir lists are personal per member (the API gates writes by item
  // ownership, not trip role — requireTripAccess() at viewer level in
  // apps/api/src/routes/souvenirs.ts), so unlike schedules/candidates/expenses
  // the add button is intentionally available to viewers too.
  test("viewer can see souvenir add button (personal list)", async ({
    authenticatedPage: page,
    browser,
  }) => {
    const { ctx, memberPage, tripUrl } = await setupViewerMember(
      page,
      browser,
      "Viewer Souvenir Test",
    );

    await memberPage.goto(tripUrl);
    await expect(memberPage).toHaveURL(/\/trips\//, { timeout: 10000 });

    await memberPage.getByRole("tab", { name: "お土産" }).click();
    await expect(memberPage.getByRole("button", { name: "お土産を追加" })).toBeVisible();

    await ctx.close();
  });

  test("viewer can react to candidates", async ({ authenticatedPage: page, browser }) => {
    await createTripViaUI(page, {
      title: "Viewer Reaction Test",
      destination: "Kyoto",
    });
    await page.getByRole("button", { name: "候補を追加" }).click();
    await page.locator("#candidate-name").fill("金閣寺");
    await page.getByRole("button", { name: "追加", exact: true }).click();
    await expect(page.getByText("候補を追加しました")).toBeVisible();

    const ctx = await browser.newContext({
      baseURL: BASE_URL,
      extraHTTPHeaders: { "x-forwarded-for": nextTestIp() },
    });
    const memberPage = await ctx.newPage();
    await signupUser(memberPage, {
      username: `vreact${Date.now()}`,
      name: "Viewer Reactor",
    });

    await memberPage.goto("/my");
    const memberId = await memberPage.locator('[data-testid="user-id"]').textContent();

    await page.getByRole("button", { name: "メンバー" }).click();
    await page.getByRole("tab", { name: "IDで追加" }).click();
    await page.locator("#member-user-id").fill(memberId!);
    await page.getByRole("button", { name: "追加" }).click();
    await expect(page.getByText("メンバーを追加しました")).toBeVisible();

    const memberRow = page.getByText("Viewer Reactor").locator("../..");
    await memberRow.getByRole("combobox").click();
    await page.getByRole("option", { name: "閲覧者" }).click();
    await expect(page.getByText("ロールを変更しました")).toBeVisible();
    await page.keyboard.press("Escape");

    const tripUrl = page.url();
    await memberPage.goto(tripUrl);
    await expect(memberPage).toHaveURL(/\/trips\//, { timeout: 10000 });

    // Click the candidates tab to ensure the list is loaded.
    await memberPage.getByRole("tab", { name: /候補/ }).click();
    // Wait for the candidate item to appear before checking the reaction button.
    // Use .last() to target the desktop panel element — the mobile section (lg:hidden)
    // is first in the DOM but has display:none at 1280px viewport, so getByText("金閣寺")
    // returns 2 elements (both panels) and strict mode would throw without disambiguation.
    await expect(memberPage.getByText("金閣寺").last()).toBeVisible({ timeout: 10000 });

    // Viewer can still react to candidates.
    // Use aria-label attribute selector as getByRole struggles with these buttons.
    // Use .last() for the same dual-render reason (mobile panel precedes desktop in DOM).
    const likeButton = memberPage.locator('[aria-label="いいね"]').last();
    await expect(likeButton).toBeVisible({ timeout: 10000 });
    await likeButton.click();
    await expect(likeButton).toHaveAttribute("aria-pressed", "true");

    await ctx.close();
  });

  test("editor can add schedules and sees edit option in trip menu", async ({
    authenticatedPage: page,
    browser,
  }) => {
    const ctx = await browser.newContext({
      baseURL: BASE_URL,
      extraHTTPHeaders: { "x-forwarded-for": nextTestIp() },
    });
    const editorPage = await ctx.newPage();
    await signupUser(editorPage, {
      username: `editor${Date.now()}`,
      name: "Editor User",
    });

    await editorPage.goto("/my");
    const editorId = await editorPage.locator('[data-testid="user-id"]').textContent();

    await createTripViaUI(page, { title: "Owner Edit Test", destination: "Kobe" });

    await page.getByRole("button", { name: "メンバー" }).click();
    await page.getByRole("tab", { name: "IDで追加" }).click();
    await page.locator("#member-user-id").fill(editorId!);
    await page.getByRole("button", { name: "追加" }).click();
    await expect(page.getByText("メンバーを追加しました")).toBeVisible();
    // Default role is editor — no role change needed
    await page.keyboard.press("Escape");

    const tripUrl = page.url();

    // Owner sees edit option in the trip menu
    await page.getByRole("button", { name: "旅行メニュー" }).click();
    await expect(page.getByRole("menuitem", { name: "編集" })).toBeVisible();
    await page.keyboard.press("Escape");

    // Editor navigates to the same trip and can add schedules
    await editorPage.goto(tripUrl);
    await expect(editorPage).toHaveURL(/\/trips\//, { timeout: 10000 });
    await expect(editorPage.getByRole("button", { name: "予定を追加" })).toBeVisible();

    await ctx.close();
  });
});
