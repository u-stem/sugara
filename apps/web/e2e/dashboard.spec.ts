import { createTripViaUI, expect, test } from "./fixtures/auth";

// PersistQueryClientProvider writes the React Query cache to IDB
// ('keyval-store' / 'sugara-query-cache').  On full browser navigation the
// in-memory cache clears but the IDB snapshot survives; staleTime: 15_000
// means React Query restores the snapshot and skips the refetch.  Delete the
// cache entry so the next page load fires a fresh fetch.
async function clearIdbCache(page: import("@playwright/test").Page): Promise<void> {
  await page.evaluate(async () => {
    await new Promise<void>((resolve) => {
      const req = indexedDB.open("keyval-store");
      req.onerror = () => resolve();
      req.onsuccess = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("keyval")) {
          db.close();
          resolve();
          return;
        }
        const tx = db.transaction("keyval", "readwrite");
        tx.objectStore("keyval").delete("sugara-query-cache");
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => {
          db.close();
          resolve();
        };
        tx.onabort = () => {
          db.close();
          resolve();
        };
      };
    });
  });
}

test.describe("Dashboard", () => {
  test("searches trips by title", async ({ authenticatedPage: page }) => {
    await createTripViaUI(page, { title: "Tokyo Trip", destination: "Tokyo" });
    await page.getByRole("link", { name: "ホーム" }).click();
    await expect(page).toHaveURL(/\/home/);

    await createTripViaUI(page, { title: "Osaka Trip", destination: "Osaka" });
    await page.getByRole("link", { name: "ホーム" }).click();
    await expect(page).toHaveURL(/\/home/);

    // Create the third trip via API to sidestep the useAuthRedirect race: after
    // each invalidateAll() the home-page trips query briefly refetches; if a
    // transient error is treated as 401, useAuthRedirect redirects the page away
    // before createTripViaUI can observe the new trip link.
    const kyotoResp = await page.request.post("/api/trips", {
      data: {
        title: "Kyoto Trip",
        destination: "Kyoto",
        startDate: new Date(Date.now() + 86400000 * 20).toISOString().slice(0, 10),
        endDate: new Date(Date.now() + 86400000 * 22).toISOString().slice(0, 10),
      },
    });
    expect(kyotoResp.status()).toBe(201);
    // The trips list is in IDB from the last home visit (Osaka + Tokyo only).
    // staleTime: 15_000 means the restored snapshot would be used as-is and
    // Kyoto would never appear.  Wipe the entry so goto fires a fresh fetch.
    await clearIdbCache(page);
    await page.goto("/home");
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveURL(/\/home/);

    await expect(page.getByText("Tokyo Trip")).toBeVisible();
    await expect(page.getByText("Osaka Trip")).toBeVisible();
    await expect(page.getByText("Kyoto Trip")).toBeVisible();

    await page.getByLabel("旅行を検索").fill("Tokyo");
    await expect(page.getByText("Tokyo Trip")).toBeVisible();
    await expect(page.getByText("Osaka Trip")).not.toBeVisible();
    await expect(page.getByText("Kyoto Trip")).not.toBeVisible();
  });

  test("filters trips by status", async ({ authenticatedPage: page }) => {
    await createTripViaUI(page, {
      title: "Draft Trip",
      destination: "Nara",
    });
    await page.getByRole("link", { name: "ホーム" }).click();
    await expect(page).toHaveURL(/\/home/);

    await expect(page.getByText("Draft Trip")).toBeVisible();

    // New trips default to "draft" status, so filtering by "計画済み" should show nothing
    const statusSelect = page
      .getByRole("toolbar", { name: "旅行フィルター" })
      .getByRole("combobox")
      .first();
    await statusSelect.click();
    await page.getByRole("option", { name: "計画済み" }).click();

    await expect(
      page.getByText("条件に一致する旅行がありません"),
    ).toBeVisible();
  });

  test("sorts trips by start date", async ({ authenticatedPage: page }) => {
    await createTripViaUI(page, {
      title: "Sort Trip",
      destination: "Matsumoto",
    });
    await page.getByRole("link", { name: "ホーム" }).click();
    await expect(page).toHaveURL(/\/home/);

    // Default sort is by updated date; toggle to start date
    await page
      .getByRole("toolbar", { name: "旅行フィルター" })
      .getByRole("button", { name: "並び替え" })
      .click();

    // Trip should still be visible after sort change
    await expect(page.getByText("Sort Trip")).toBeVisible();
  });

  test("duplicates a trip", async ({ authenticatedPage: page }) => {
    await createTripViaUI(page, {
      title: "Original Trip",
      destination: "Takayama",
    });
    await page.getByRole("link", { name: "ホーム" }).click();
    await expect(page).toHaveURL(/\/home/);

    // Enter selection mode and select the trip
    await page
      .getByRole("toolbar", { name: "旅行フィルター" })
      .getByRole("button", { name: "選択" })
      .click();
    await page.getByRole("button", { name: "全選択" }).click();
    await page.getByRole("button", { name: "選択操作メニュー" }).click();
    await page.getByRole("menuitem", { name: "複製" }).click();

    await expect(page.getByText("1件の旅行を複製しました")).toBeVisible();
  });

  test("selects and deletes a trip", async ({ authenticatedPage: page }) => {
    await createTripViaUI(page, {
      title: "Delete Me",
      destination: "Nowhere",
    });
    await page.getByRole("link", { name: "ホーム" }).click();
    await expect(page).toHaveURL(/\/home/);

    await expect(page.getByText("Delete Me")).toBeVisible();

    await page
      .getByRole("toolbar", { name: "旅行フィルター" })
      .getByRole("button", { name: "選択" })
      .click();
    await page.getByRole("button", { name: "全選択" }).click();
    await page.getByRole("button", { name: "選択操作メニュー" }).click();
    await page.getByRole("menuitem", { name: "削除" }).click();
    await page.getByRole("button", { name: "削除する" }).click();

    await expect(page.getByText("Delete Me")).not.toBeVisible();
  });
});
