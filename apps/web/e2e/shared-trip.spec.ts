import {
  BASE_URL,
  clearIdbCache,
  createTripViaUI,
  expect,
  nextTestIp,
  signupUser,
  test,
} from "./fixtures/auth";

test.describe("Shared Trip", () => {
  test("generates share link and views shared trip", async ({
    authenticatedPage: page,
    browser,
  }) => {
    await createTripViaUI(page, {
      title: "Shared Trip Test",
      destination: "Nagoya",
    });

    // Grant clipboard permission for headless browser
    await page.context().grantPermissions(["clipboard-write", "clipboard-read"]);

    // Generate share link and capture the token from API response
    const responsePromise = page.waitForResponse(
      (res) => res.url().includes("/api/trips/") && res.url().endsWith("/share") && res.ok(),
    );
    await page.getByRole("button", { name: "共有リンク" }).click();
    const response = await responsePromise;
    const body = (await response.json()) as { shareToken: string };
    const shareToken = body.shareToken;

    await expect(page.getByText("共有リンクをコピーしました")).toBeVisible();

    // Open shared link in a new unauthenticated context
    const context = await browser.newContext({ baseURL: BASE_URL });
    const sharedPage = await context.newPage();
    await sharedPage.goto(`/shared/${shareToken}`);

    await expect(sharedPage.getByRole("heading", { name: "Shared Trip Test" })).toBeVisible({
      timeout: 15000,
    });
    await context.close();
  });

  test("regenerates share link", async ({ authenticatedPage: page }) => {
    await createTripViaUI(page, {
      title: "Regenerate Link Test",
      destination: "Shizuoka",
    });

    await page.context().grantPermissions(["clipboard-write", "clipboard-read"]);

    // Generate initial share link
    const firstResponse = page.waitForResponse(
      (res) => res.url().includes("/api/trips/") && res.url().endsWith("/share") && res.ok(),
    );
    await page.getByRole("button", { name: "共有リンク" }).click();
    await firstResponse;
    await expect(page.getByText("共有リンクをコピーしました")).toBeVisible();

    // Close the share dialog before clicking regenerate
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).not.toBeVisible();

    // Regenerate share link. The button only renders while the component holds
    // shareUrl state from the first request, so wait for it explicitly before
    // arming the response listener (observed flaky on CI otherwise).
    const regenerateButton = page.getByRole("button", { name: "共有リンクを再生成" });
    await expect(regenerateButton).toBeVisible({ timeout: 10000 });
    const secondResponse = page.waitForResponse(
      (res) => res.url().includes("/api/trips/") && res.url().endsWith("/share") && res.ok(),
    );
    await regenerateButton.click();
    await secondResponse;
    await expect(page.getByText("共有リンクを再生成してコピーしました")).toBeVisible();
  });

  test("shows shared trip on shared-trips page", async ({
    authenticatedPage: page,
    browser,
  }) => {
    // Create the member user.
    // Assign a unique synthetic IP so the proxy's session check requests
    // (to /api/auth/get-session, rate-limited 300/min per IP) don't collapse to
    // "unknown" and trigger redirect loops that land the member at /home instead
    // of the requested page.
    const memberContext = await browser.newContext({
      baseURL: BASE_URL,
      extraHTTPHeaders: { "x-forwarded-for": nextTestIp() },
    });
    const memberPage = await memberContext.newPage();
    await signupUser(memberPage, {
      username: `shared${Date.now()}`,
      name: "Shared List User",
    });

    // Retrieve the member's user ID via the session API to avoid navigating to
    // /my: the proxy's rate-limit redirect loop can steer secondary contexts to
    // /home instead of /my, causing [data-testid="user-id"] to never appear.
    const sessionRes = await memberPage.request.get("/api/auth/get-session");
    const sessionData = (await sessionRes.json()) as { user?: { id: string } };
    const memberId = sessionData?.user?.id;
    expect(memberId).toBeTruthy();

    // Owner creates a trip
    await createTripViaUI(page, {
      title: "Shared List Trip",
      destination: "Kanazawa",
    });

    // Add member by user ID
    await page.getByRole("button", { name: "メンバー" }).click();
    await page.getByRole("tab", { name: "IDで追加" }).click();
    await page.locator("#member-user-id").fill(memberId!);
    await page.getByRole("button", { name: "追加" }).click();
    await expect(page.getByText("メンバーを追加しました")).toBeVisible();

    // The member's home page fetched shared trips (returning []) during
    // signupUser and wrote the result to IDB.  staleTime: 15_000 means
    // React Query would restore that empty snapshot without refetching.
    // Wipe the IDB entry so the next goto fires a fresh shared-trips fetch
    // that now includes the newly-added trip.
    await clearIdbCache(memberPage);

    // Both queries (owned and shared) fire on mount regardless of the active
    // tab.  Register the response interceptor before navigation so the
    // shared-trips fetch is captured even if it completes before the tab
    // click, avoiding waitForLoadState("networkidle") which can time out in
    // the full suite due to Realtime WebSocket keep-alive traffic.
    const sharedTripsResponse = memberPage.waitForResponse(
      (res) => res.url().includes("scope=shared") && res.ok(),
    );

    // Member navigates to home and switches to shared tab
    await memberPage.goto("/home");
    await expect(memberPage).toHaveURL(/\/home/, { timeout: 10000 });

    // Await the shared-trips API response so the data is in React Query's
    // cache before we switch the tab.
    await sharedTripsResponse;

    // The home page tab has explicit role="tab", not role="button"; getByRole
    // uses the ARIA role so "button" would not match a role="tab" element.
    await memberPage.getByRole("tab", { name: "共有された旅行" }).click();
    await expect(memberPage.getByText("Shared List Trip")).toBeVisible({
      timeout: 10000,
    });

    await memberContext.close();
  });

  test("shows error for invalid share token", async ({ browser }) => {
    const context = await browser.newContext({ baseURL: BASE_URL });
    const page = await context.newPage();
    await page.goto("/shared/invalidtoken123");

    // The shared-trip page uses server-side rendering: when the API returns a
    // non-ok response notFound() is called, which renders the Next.js 404 page
    // instead of a client-side error message. Accept all known error surfaces.
    await expect(
      page.getByText(/このリンクは無効か|旅行の取得に失敗しました|ページが見つかりません/),
    ).toBeVisible({ timeout: 15000 });
    await context.close();
  });
});
