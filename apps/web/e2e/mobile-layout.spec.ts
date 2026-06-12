import { expect, test } from "./fixtures/auth";

test.describe("Mobile layout", () => {
  test("BottomNav is visible with 5 nav links", async ({ authenticatedPage: page }) => {
    const bottomNav = page.locator("nav[aria-label='ボトムナビゲーション']");
    await expect(bottomNav).toBeVisible();

    const links = bottomNav.getByRole("link");
    await expect(links).toHaveCount(5);
    await expect(bottomNav.getByRole("link", { name: "ホーム" })).toBeVisible();
    await expect(bottomNav.getByRole("link", { name: "ブックマーク" })).toBeVisible();
    await expect(bottomNav.getByRole("link", { name: "フレンド" })).toBeVisible();
    // SP_NAV_LINKS contains "記事" (articles), not "通知" (notifications).
    await expect(bottomNav.getByRole("link", { name: "記事" })).toBeVisible();
    await expect(bottomNav.getByRole("link", { name: "プロフィール" })).toBeVisible();
  });

  test("BottomNav links navigate to correct pages", async ({ authenticatedPage: page }) => {
    const bottomNav = page.locator("nav[aria-label='ボトムナビゲーション']");

    await bottomNav.getByRole("link", { name: "フレンド" }).click();
    await expect(page).toHaveURL(/\/friends/);

    await bottomNav.getByRole("link", { name: "ホーム" }).click();
    await expect(page).toHaveURL(/\/home/);
  });

  test("Header desktop nav links are hidden on mobile", async ({
    authenticatedPage: page,
  }) => {
    const headerNav = page.locator("header nav[aria-label='メインナビゲーション']");
    await expect(headerNav.getByRole("link", { name: "ホーム" })).toBeHidden();
    await expect(headerNav.getByRole("link", { name: "フレンド" })).toBeHidden();
  });

  test("SP header shows settings link", async ({ authenticatedPage: page }) => {
    // Settings link and logout button live inside the SpHeaderMenu panel, which
    // is conditionally rendered ({expanded && ...}). Open the menu before asserting.
    await page.getByRole("button", { name: "メニューを開く" }).click();
    const settingsLink = page.locator("header").getByRole("link", { name: "設定" });
    await expect(settingsLink).toBeVisible();
    await settingsLink.click();
    await expect(page).toHaveURL(/\/settings/);
    // useMenuState sets animatingRef for ANIMATION_DURATION (300ms) after the
    // pathname-change close effect fires. Checking for a DOM element only
    // confirms rendering; SSR pages render in < 300ms so the lock may not have
    // expired yet. Wait an explicit 350ms so the lock is always cleared before
    // the next menu-open click.
    await page.waitForTimeout(350);
    await page.getByRole("button", { name: "メニューを開く" }).click();
    await expect(page.getByRole("button", { name: "ログアウト" })).toBeVisible();
  });

  test("Logout via settings navigates to landing page", async ({ authenticatedPage: page }) => {
    await page.goto("/sp/settings");
    // Logout button is inside the SpHeaderMenu panel; expand it before clicking.
    await page.getByRole("button", { name: "メニューを開く" }).click();
    await page.getByRole("button", { name: "ログアウト" }).click();
    // On mobile the confirmation UI is a Drawer; the confirm button is the last
    // "ログアウト" in the DOM (the trigger button remains mounted in the panel).
    await page.getByRole("button", { name: "ログアウト" }).last().click();
    // handleSignOut sets window.location.href = "/auth/login", not "/".
    await expect(page).toHaveURL(/\/auth\/login/, { timeout: 10000 });
  });
});
