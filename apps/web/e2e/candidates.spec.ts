import { createTripViaUI, expect, test } from "./fixtures/auth";

test.describe("Candidates", () => {
  test("adds a candidate", async ({ authenticatedPage: page }) => {
    await createTripViaUI(page, {
      title: "Candidate Add Test",
      destination: "Kamakura",
    });

    await page.getByRole("button", { name: "候補を追加" }).click();
    await page.locator("#candidate-name").fill("鶴岡八幡宮");
    await page.locator("#candidate-memo").fill("駅から徒歩10分");
    await page.getByRole("button", { name: "追加", exact: true }).click();

    await expect(page.getByText("候補を追加しました")).toBeVisible();
    // Use the menu button to confirm the item exists — getByText would match both
    // the mobile (display:none) and desktop panels and trigger a strict mode violation.
    await expect(page.getByRole("button", { name: "鶴岡八幡宮のメニュー" })).toBeVisible();
  });

  test("edits a candidate", async ({ authenticatedPage: page }) => {
    await createTripViaUI(page, {
      title: "Candidate Edit Test",
      destination: "Kamakura",
    });

    // Add a candidate first
    await page.getByRole("button", { name: "候補を追加" }).click();
    await page.locator("#candidate-name").fill("長谷寺");
    await page.getByRole("button", { name: "追加", exact: true }).click();
    await expect(page.getByText("候補を追加しました")).toBeVisible();

    // Edit the candidate
    await page.getByRole("button", { name: "長谷寺のメニュー" }).click();
    await page.getByRole("menuitem", { name: "編集" }).click();

    await page.locator("#edit-candidate-name").clear();
    await page.locator("#edit-candidate-name").fill("高徳院");
    await page.getByRole("button", { name: "更新" }).click();

    await expect(page.getByText("候補を更新しました")).toBeVisible();
    // Use the menu button — getByText matches the mobile (display:none) panel too.
    await expect(page.getByRole("button", { name: "高徳院のメニュー" })).toBeVisible();
  });

  test("deletes a candidate", async ({ authenticatedPage: page }) => {
    await createTripViaUI(page, {
      title: "Candidate Delete Test",
      destination: "Kamakura",
    });

    // Add a candidate first
    await page.getByRole("button", { name: "候補を追加" }).click();
    await page.locator("#candidate-name").fill("報国寺");
    await page.getByRole("button", { name: "追加", exact: true }).click();
    await expect(page.getByText("候補を追加しました")).toBeVisible();

    // Delete the candidate
    await page.getByRole("button", { name: "報国寺のメニュー" }).click();
    await page.getByRole("menuitem", { name: "削除" }).click();
    await page.getByRole("button", { name: "削除する" }).click();

    await expect(page.getByText("候補を削除しました")).toBeVisible();
    await expect(page.getByText("報国寺")).not.toBeVisible();
  });

  test("assigns a candidate to the timeline", async ({
    authenticatedPage: page,
  }) => {
    await createTripViaUI(page, {
      title: "Candidate Assign Test",
      destination: "Kamakura",
    });

    // Add a candidate
    await page.getByRole("button", { name: "候補を追加" }).click();
    await page.locator("#candidate-name").fill("江ノ島");
    await page.getByRole("button", { name: "追加", exact: true }).click();
    await expect(page.getByText("候補を追加しました")).toBeVisible();

    // Assign to timeline via menu
    await page.getByRole("button", { name: "江ノ島のメニュー" }).click();
    await page.getByRole("menuitem", { name: "予定に追加" }).click();

    await expect(page.getByText("予定に追加しました")).toBeVisible();
  });
});
