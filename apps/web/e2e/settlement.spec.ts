import { BASE_URL, createTripViaUI, expect, nextTestIp, signupUserViaApi, test } from "./fixtures/auth";

test.describe("Settlement", () => {
  test("checks and unchecks a settlement payment", async ({
    authenticatedPage: page,
    browser,
  }) => {
    // Create a second user. Pass a unique x-forwarded-for header so the sign-up
    // request is bucketed separately from the primary user and does not exhaust
    // the per-IP rate limit that the primary context owns.
    const memberContext = await browser.newContext({
      baseURL: BASE_URL,
      extraHTTPHeaders: { "x-forwarded-for": nextTestIp() },
    });
    const memberPage = await memberContext.newPage();
    await signupUserViaApi(memberPage, {
      username: `settle${Date.now()}`,
      name: "Settle User",
    });

    await memberPage.goto("/my");
    const memberId = await memberPage.locator('[data-testid="user-id"]').textContent();
    expect(memberId).toBeTruthy();
    await memberContext.close();

    // Owner creates a trip and adds the member
    await createTripViaUI(page, {
      title: "Settlement Check Test",
      destination: "Kyoto",
    });

    await page.getByRole("button", { name: "メンバー" }).click();
    await page.getByRole("tab", { name: "IDで追加" }).click();
    await page.locator("#member-user-id").fill(memberId!);
    await page.getByRole("button", { name: "追加" }).click();
    await expect(page.getByText("メンバーを追加しました")).toBeVisible();
    await page.keyboard.press("Escape");

    // Add an expense paid by the owner
    await page.getByRole("tab", { name: "費用" }).click();
    await page.getByRole("button", { name: "費用を追加" }).click();

    const expenseDialog = page.getByRole("dialog", { name: "費用を追加" });
    await expect(expenseDialog).toBeVisible();
    await expenseDialog.locator("#expense-title").fill("夕食");
    await expenseDialog.locator("#expense-amount").fill("4000");

    // Select payer
    await expenseDialog.locator("#expense-paid-by").click();
    await page.getByRole("option").first().click();

    await expenseDialog.getByRole("button", { name: "追加" }).click();
    await expect(expenseDialog).not.toBeVisible({ timeout: 10000 });

    // Settlement section should be visible with a transfer.
    // "精算" / "0/1 完了" / "精算完了" are plain <span> elements rendered in both
    // the mobile (display:none / inert) and desktop panels — getByText matches both
    // and causes a strict mode violation. Use role-based locators instead:
    //   settlement section presence  → "立替ごと" tab (accessibility tree, inert excluded)
    //   unchecked state              → checkbox not checked
    //   checked state (精算完了)     → checkbox is checked
    await expect(page.getByRole("tab", { name: "立替ごと" })).toBeVisible();
    await expect(page.getByRole("checkbox")).not.toBeChecked();

    // Check the settlement (mark as paid)
    const checkbox = page.getByRole("checkbox").first();
    await checkbox.click();

    // Should show as completed
    await expect(page.getByRole("checkbox")).toBeChecked({ timeout: 5000 });

    // Uncheck the settlement
    await checkbox.click();
    await expect(page.getByRole("checkbox")).not.toBeChecked({ timeout: 5000 });
  });

  test("settlement resets when expense is modified", async ({
    authenticatedPage: page,
    browser,
  }) => {
    // Create a second user with a unique IP to avoid rate-limit collisions.
    const memberContext = await browser.newContext({
      baseURL: BASE_URL,
      extraHTTPHeaders: { "x-forwarded-for": nextTestIp() },
    });
    const memberPage = await memberContext.newPage();
    await signupUserViaApi(memberPage, {
      username: `reset${Date.now()}`,
      name: "Reset User",
    });

    await memberPage.goto("/my");
    const memberId = await memberPage.locator('[data-testid="user-id"]').textContent();
    expect(memberId).toBeTruthy();
    await memberContext.close();

    // Create trip with member and expense
    await createTripViaUI(page, {
      title: "Settlement Reset Test",
      destination: "Osaka",
    });

    await page.getByRole("button", { name: "メンバー" }).click();
    await page.getByRole("tab", { name: "IDで追加" }).click();
    await page.locator("#member-user-id").fill(memberId!);
    await page.getByRole("button", { name: "追加" }).click();
    await expect(page.getByText("メンバーを追加しました")).toBeVisible();
    await page.keyboard.press("Escape");

    await page.getByRole("tab", { name: "費用" }).click();
    await page.getByRole("button", { name: "費用を追加" }).click();

    const addDialog = page.getByRole("dialog", { name: "費用を追加" });
    await addDialog.locator("#expense-title").fill("ランチ");
    await addDialog.locator("#expense-amount").fill("3000");
    await addDialog.locator("#expense-paid-by").click();
    await page.getByRole("option").first().click();
    await addDialog.getByRole("button", { name: "追加" }).click();
    await expect(addDialog).not.toBeVisible({ timeout: 10000 });

    // Check the settlement (see comment in test 1 for why we use checkbox state
    // instead of text assertions for "精算完了" / "0/1 完了").
    await page.getByRole("checkbox").first().click();
    await expect(page.getByRole("checkbox")).toBeChecked({ timeout: 5000 });

    // Edit the expense — this should reset settlement
    await page.getByRole("button", { name: "ランチのメニュー" }).click();
    await page.getByRole("menuitem", { name: "編集" }).click();

    const editDialog = page.getByRole("dialog", { name: "費用を編集" });
    await expect(editDialog).toBeVisible();
    await editDialog.locator("#expense-amount").clear();
    await editDialog.locator("#expense-amount").fill("5000");
    await editDialog.getByRole("button", { name: "更新" }).click();
    await expect(editDialog).not.toBeVisible({ timeout: 10000 });

    // Settlement should be reset — expense edit resets all checked payments.
    await expect(page.getByRole("checkbox")).not.toBeChecked({ timeout: 5000 });
  });
});
