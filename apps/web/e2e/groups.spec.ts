import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures/auth";

// createGroupViaUI is defined locally because the fixture version uses a
// button locator ("新規作成") that no longer exists. The current UI renders
// the button as "グループを作成" (tf("createGroup") in the friend namespace).
// The members-auto-open behaviour that the fixture expected was also removed.
// A fixture diff is proposed in the final report.
async function createGroupViaUI(page: Page, name: string): Promise<void> {
  await page.goto("/friends");
  await page.getByRole("button", { name: /グループを作成/ }).click();
  await page.locator("#group-name").fill(name);
  await page.getByRole("button", { name: "作成" }).click();
  await expect(page.getByText("グループを作成しました")).toBeVisible();
}

test.describe("Groups", () => {
  test("creates a group", async ({ authenticatedPage: page }) => {
    await createGroupViaUI(page, "E2E Test Group");
    await expect(page.getByText("E2E Test Group", { exact: true })).toBeVisible();
  });

  test("renames a group", async ({ authenticatedPage: page }) => {
    await createGroupViaUI(page, "Before Rename");

    await page.getByRole("button", { name: "Before Renameのメニュー" }).click();
    await page.getByRole("menuitem", { name: "編集" }).click();

    await page.locator("#edit-group-name").clear();
    await page.locator("#edit-group-name").fill("After Rename");
    await page.getByRole("button", { name: "保存" }).click();

    await expect(page.getByText("グループ名を変更しました")).toBeVisible();
    await expect(page.getByText("After Rename")).toBeVisible();
  });

  test("deletes a group", async ({ authenticatedPage: page }) => {
    await createGroupViaUI(page, "To Be Deleted");

    await page.getByRole("button", { name: "To Be Deletedのメニュー" }).click();
    await page.getByRole("menuitem", { name: "削除" }).click();
    await page.getByRole("button", { name: "削除する" }).click();

    await expect(page.getByText("グループを削除しました")).toBeVisible();
    await expect(page.getByText("To Be Deleted")).not.toBeVisible();
  });
});
