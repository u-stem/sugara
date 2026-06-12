// Imported from the shared fixture so each test gets a unique synthetic client
// IP (per-IP auth rate limits would otherwise throttle repeated signups).
import { expect, test } from "./fixtures/auth";

test.describe("Authentication", () => {
  const username = `e2e_${Date.now()}`;
  const password = "TestPassword123!";
  const name = "E2E User";

  test("sign up, log out, and log in", async ({ page }) => {
    // Sign up
    await page.goto("/auth/signup");
    await page.getByLabel("ユーザー名").fill(username);
    await page.getByLabel("表示名").fill(name);
    await page.locator("#password").fill(password);
    await page.locator("#confirmPassword").fill(password);
    await page.getByLabel("利用規約").check({ force: true });
    await page.getByRole("button", { name: "新規登録" }).click();
    await expect(page).toHaveURL(/\/home/, { timeout: 10000 });

    // Log out via settings page — logout button lives inside the hamburger
    // panel which is conditionally rendered; open the menu before clicking.
    await page.goto("/settings");
    await page.getByRole("button", { name: "メニューを開く" }).click();
    await page.getByRole("button", { name: "ログアウト" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "ログアウト" }).click();
    // handleSignOut sets window.location.href = "/auth/login", not "/".
    await expect(page).toHaveURL(/\/auth\/login/, { timeout: 10000 });

    // Log in — the logout redirect already landed on /auth/login, so no extra
    // navigation (each full load spends the shared per-IP auth rate budget).
    await page.getByLabel("ユーザー名").fill(username);
    await page.getByLabel("パスワード").fill(password);
    await page.getByRole("button", { name: "ログイン" }).click();
    await expect(page).toHaveURL(/\/home/, { timeout: 10000 });
  });
});
