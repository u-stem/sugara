import { expect, test } from "@playwright/test";

// Verifies the self-hosted Scalar bundle actually boots and renders the v1
// spec — this is the real compatibility check between the pinned
// @scalar/api-reference bundle and @scalar/hono-api-reference's generated
// config. A broken pairing would serve the HTML (200) but render nothing.
// Manual regression (not run in CI), like api-keys.spec.ts.
test.describe("API reference (Scalar UI)", () => {
  test.use({ locale: "ja-JP" });

  const username = `e2e_docs_${Date.now()}`;
  const password = "TestPassword123!";
  const name = "E2E Docs User";

  test("redirects to login when unauthenticated", async ({ page }) => {
    await page.goto("/api/_docs");

    await expect(page).toHaveURL(/\/auth\/login/, { timeout: 10000 });
  });

  test("renders the self-hosted reference for a logged-in user", async ({ page }) => {
    // Sign up a fresh non-guest user
    await page.goto("/auth/signup");
    await page.getByLabel("ユーザー名").fill(username);
    await page.getByLabel("表示名").fill(name);
    await page.locator("#password").fill(password);
    await page.locator("#confirmPassword").fill(password);
    await page.getByLabel("利用規約").check({ force: true });
    await page.getByRole("button", { name: "新規登録" }).click();
    await expect(page).toHaveURL(/\/home/, { timeout: 10000 });

    // The bundle is same-origin: fail the test if the page pulls from any CDN.
    const externalRequests: string[] = [];
    page.on("request", (req) => {
      const url = req.url();
      if (!url.startsWith("http://localhost") && !url.startsWith("data:")) {
        externalRequests.push(url);
      }
    });

    await page.goto("/api/_docs");

    // The Scalar app booted and parsed the spec if the API title is rendered.
    await expect(page.getByText("sugara External API").first()).toBeVisible({ timeout: 15000 });
    expect(externalRequests).toEqual([]);
  });
});
