import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient, type FetchLike } from "../client.js";

function makeResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Type guard helpers for inspecting recorded mock fetch calls without unsafe casts.

function getFirstCallUrl(calls: Parameters<FetchLike>[]): string {
  const first = calls[0];
  if (first === undefined) throw new Error("no fetch calls recorded");
  const [urlArg] = first;
  return typeof urlArg === "string" ? urlArg : urlArg.toString();
}

function getFirstCallHeaders(calls: Parameters<FetchLike>[]): Record<string, string> {
  const first = calls[0];
  if (first === undefined) throw new Error("no fetch calls recorded");
  const [, initArg] = first;
  if (!initArg) throw new Error("no RequestInit in fetch call");
  const { headers } = initArg;
  if (typeof headers !== "object" || headers === null || Array.isArray(headers)) {
    throw new Error("expected plain object headers, got something else");
  }
  // Safe: runtime checks above confirm it is a plain string-keyed object record
  return headers as Record<string, string>;
}

// Returns the HTTP method of the first recorded fetch call.
function getFirstCallMethod(calls: Parameters<FetchLike>[]): string {
  const first = calls[0];
  if (first === undefined) throw new Error("no fetch calls recorded");
  const [, initArg] = first;
  // Absence of method in RequestInit means GET by convention
  return initArg?.method ?? "GET";
}

// Parses and returns the JSON-parsed request body of the first recorded fetch call.
function getFirstCallBody(calls: Parameters<FetchLike>[]): unknown {
  const first = calls[0];
  if (first === undefined) throw new Error("no fetch calls recorded");
  const [, initArg] = first;
  if (!initArg?.body) throw new Error("no body in fetch call");
  return JSON.parse(String(initArg.body));
}

describe("ApiClient", () => {
  let mockFetch: ReturnType<typeof vi.fn<FetchLike>>;
  let client: ApiClient;

  beforeEach(() => {
    mockFetch = vi.fn<FetchLike>();
    client = new ApiClient("http://localhost:3000", "sk_test_key", mockFetch);
  });

  describe("Authorization header", () => {
    it("sends Bearer token in Authorization header", async () => {
      // Arrange
      mockFetch.mockResolvedValue(makeResponse({ data: [], pagination: {} }, 200));

      // Act
      await client.listTrips();

      // Assert
      const headers = getFirstCallHeaders(mockFetch.mock.calls);
      expect(headers.Authorization).toBe("Bearer sk_test_key");
    });

    it("does not include the API key in error messages on 401", async () => {
      // Arrange
      mockFetch.mockResolvedValue(
        makeResponse({ error: { code: "unauthorized", message: "bad key" } }, 401),
      );

      // Act + Assert: must throw AND the message must not expose the key
      await expect(client.listTrips()).rejects.toThrow(
        expect.objectContaining({ message: expect.not.stringContaining("sk_test_key") }),
      );
    });

    it("does not include the API key in error messages on network failure", async () => {
      // Arrange
      mockFetch.mockRejectedValue(new TypeError("fetch failed"));

      // Act + Assert
      await expect(client.listTrips()).rejects.toThrow(
        expect.objectContaining({ message: expect.not.stringContaining("sk_test_key") }),
      );
    });

    it("does not include the API key in error messages on non-JSON 500", async () => {
      // Arrange — non-JSON body causes safeParse to fail, falling back to "HTTP 500 error"
      mockFetch.mockResolvedValue(new Response("Internal Server Error", { status: 500 }));

      // Act + Assert
      await expect(client.listTrips()).rejects.toThrow(
        expect.objectContaining({ message: expect.not.stringContaining("sk_test_key") }),
      );
    });
  });

  describe("error code mapping", () => {
    it("maps 401 unauthorized to Japanese message", async () => {
      // Arrange
      mockFetch.mockResolvedValue(
        makeResponse({ error: { code: "unauthorized", message: "bad key" } }, 401),
      );

      // Act
      let errorMessage = "";
      try {
        await client.listTrips();
      } catch (err) {
        errorMessage = err instanceof Error ? err.message : "";
      }

      // Assert
      expect(errorMessage).toContain("API キー");
    });

    it("maps 403 insufficient_scope to Japanese message", async () => {
      // Arrange
      mockFetch.mockResolvedValue(
        makeResponse({ error: { code: "insufficient_scope", message: "no scope" } }, 403),
      );

      // Act
      let errorMessage = "";
      try {
        await client.listTrips();
      } catch (err) {
        errorMessage = err instanceof Error ? err.message : "";
      }

      // Assert
      expect(errorMessage).toContain("スコープ");
    });

    it("maps 404 not_found to Japanese message", async () => {
      // Arrange
      mockFetch.mockResolvedValue(
        makeResponse({ error: { code: "not_found", message: "not found" } }, 404),
      );

      // Act
      let errorMessage = "";
      try {
        await client.getTrip("00000000-0000-0000-0000-000000000001");
      } catch (err) {
        errorMessage = err instanceof Error ? err.message : "";
      }

      // Assert
      expect(errorMessage).toContain("見つからない");
    });

    it("maps 409 conflict to Japanese message", async () => {
      // Arrange
      mockFetch.mockResolvedValue(
        makeResponse({ error: { code: "conflict", message: "limit reached" } }, 409),
      );

      // Act
      let errorMessage = "";
      try {
        await client.createTrip({
          title: "Test",
          startDate: "2025-01-01",
          endDate: "2025-01-03",
        });
      } catch (err) {
        errorMessage = err instanceof Error ? err.message : "";
      }

      // Assert
      expect(errorMessage).toContain("競合");
    });

    it("includes the trip limit value when reason is trip_limit_reached", async () => {
      // Arrange
      mockFetch.mockResolvedValue(
        makeResponse(
          {
            error: {
              code: "conflict",
              reason: "trip_limit_reached",
              message: "Trip limit reached for this account",
              details: { max: 10 },
            },
          },
          409,
        ),
      );

      // Act
      let errorMessage = "";
      try {
        await client.createTrip({
          title: "Test",
          startDate: "2025-01-01",
          endDate: "2025-01-03",
        });
      } catch (err) {
        errorMessage = err instanceof Error ? err.message : "";
      }

      // Assert
      expect(errorMessage).toContain("10");
    });

    it("includes the schedule limit value when reason is schedule_limit_reached", async () => {
      // Arrange
      mockFetch.mockResolvedValue(
        makeResponse(
          {
            error: {
              code: "conflict",
              reason: "schedule_limit_reached",
              message: "Per-trip schedule limit reached",
              details: { max: 300 },
            },
          },
          409,
        ),
      );

      // Act
      let errorMessage = "";
      try {
        await client.createSchedule("trip-1", 1, { name: "Tokyo Tower" });
      } catch (err) {
        errorMessage = err instanceof Error ? err.message : "";
      }

      // Assert
      expect(errorMessage).toContain("300");
      expect(errorMessage).toContain("予定");
    });

    it("includes the expense limit value when reason is expense_limit_reached", async () => {
      // Arrange
      mockFetch.mockResolvedValue(
        makeResponse(
          {
            error: {
              code: "conflict",
              reason: "expense_limit_reached",
              message: "Per-trip expense limit reached",
              details: { max: 200 },
            },
          },
          409,
        ),
      );

      // Act
      let errorMessage = "";
      try {
        await client.createExpense("trip-1", { title: "Dinner", amount: 1000 });
      } catch (err) {
        errorMessage = err instanceof Error ? err.message : "";
      }

      // Assert
      expect(errorMessage).toContain("200");
      expect(errorMessage).toContain("費用");
    });

    it("includes the bookmark-list limit value when reason is bookmark_list_limit_reached", async () => {
      // Arrange
      mockFetch.mockResolvedValue(
        makeResponse(
          {
            error: {
              code: "conflict",
              reason: "bookmark_list_limit_reached",
              message: "Bookmark list limit reached",
              details: { max: 5 },
            },
          },
          409,
        ),
      );

      // Act
      let errorMessage = "";
      try {
        await client.createBookmarkList({ name: "Trips" });
      } catch (err) {
        errorMessage = err instanceof Error ? err.message : "";
      }

      // Assert
      expect(errorMessage).toContain("5");
      expect(errorMessage).toContain("リスト");
    });

    it("includes the bookmark limit value when reason is bookmark_limit_reached", async () => {
      // Arrange
      mockFetch.mockResolvedValue(
        makeResponse(
          {
            error: {
              code: "conflict",
              reason: "bookmark_limit_reached",
              message: "Bookmark limit reached",
              details: { max: 20 },
            },
          },
          409,
        ),
      );

      // Act
      let errorMessage = "";
      try {
        await client.createBookmark("list-1", { name: "Place", urls: [] });
      } catch (err) {
        errorMessage = err instanceof Error ? err.message : "";
      }

      // Assert
      expect(errorMessage).toContain("20");
      expect(errorMessage).toContain("ブックマーク");
    });

    it("includes the article limit value when reason is article_limit_reached", async () => {
      // Arrange
      mockFetch.mockResolvedValue(
        makeResponse(
          {
            error: {
              code: "conflict",
              reason: "article_limit_reached",
              message: "Article limit reached",
              details: { max: 50 },
            },
          },
          409,
        ),
      );

      // Act
      let errorMessage = "";
      try {
        await client.createArticle({ title: "My Article" });
      } catch (err) {
        errorMessage = err instanceof Error ? err.message : "";
      }

      // Assert
      expect(errorMessage).toContain("50");
      expect(errorMessage).toContain("記事");
    });

    it("includes the pattern limit value when reason is pattern_limit_reached", async () => {
      // Arrange
      mockFetch.mockResolvedValue(
        makeResponse(
          {
            error: {
              code: "conflict",
              reason: "pattern_limit_reached",
              message: "Per-day pattern limit reached",
              details: { max: 3 },
            },
          },
          409,
        ),
      );

      // Act
      let errorMessage = "";
      try {
        await client.createPattern("trip-1", 1, { label: "Rainy plan" });
      } catch (err) {
        errorMessage = err instanceof Error ? err.message : "";
      }

      // Assert
      expect(errorMessage).toContain("3");
      expect(errorMessage).toContain("パターン");
    });

    it("maps the cannot_delete_default_pattern reason to a Japanese message", async () => {
      // Arrange — non-limit reason, no details
      mockFetch.mockResolvedValue(
        makeResponse(
          {
            error: {
              code: "invalid_request",
              reason: "cannot_delete_default_pattern",
              message: "Cannot delete the default pattern",
            },
          },
          400,
        ),
      );

      // Act
      let errorMessage = "";
      try {
        await client.deletePattern("trip-1", "pattern-1");
      } catch (err) {
        errorMessage = err instanceof Error ? err.message : "";
      }

      // Assert
      expect(errorMessage).toContain("デフォルト");
    });

    it("maps the trip_has_no_days reason to a Japanese message", async () => {
      // Arrange — non-limit reason, no details
      mockFetch.mockResolvedValue(
        makeResponse(
          {
            error: {
              code: "conflict",
              reason: "trip_has_no_days",
              message: "Trip has no days",
            },
          },
          409,
        ),
      );

      // Act
      let errorMessage = "";
      try {
        await client.createSchedule("trip-1", 1, { name: "Tokyo Tower" });
      } catch (err) {
        errorMessage = err instanceof Error ? err.message : "";
      }

      // Assert
      expect(errorMessage).toContain("日程");
    });

    it("falls back to the generic conflict message when an unknown reason is returned", async () => {
      // Arrange — a reason the client does not recognize maps to the code-level message
      mockFetch.mockResolvedValue(
        makeResponse(
          { error: { code: "conflict", reason: "some_future_reason", message: "x" } },
          409,
        ),
      );

      // Act
      let errorMessage = "";
      try {
        await client.createTrip({ title: "Test", startDate: "2025-01-01", endDate: "2025-01-03" });
      } catch (err) {
        errorMessage = err instanceof Error ? err.message : "";
      }

      // Assert
      expect(errorMessage).toContain("競合");
    });

    it("falls back to the generic conflict message when details.max is absent", async () => {
      // Arrange
      mockFetch.mockResolvedValue(
        makeResponse(
          { error: { code: "conflict", reason: "trip_limit_reached", message: "limit" } },
          409,
        ),
      );

      // Act
      let errorMessage = "";
      try {
        await client.createTrip({
          title: "Test",
          startDate: "2025-01-01",
          endDate: "2025-01-03",
        });
      } catch (err) {
        errorMessage = err instanceof Error ? err.message : "";
      }

      // Assert
      expect(errorMessage).toContain("競合");
    });

    it("maps 429 rate_limited to Japanese message", async () => {
      // Arrange
      mockFetch.mockResolvedValue(
        makeResponse({ error: { code: "rate_limited", message: "too many" } }, 429),
      );

      // Act
      let errorMessage = "";
      try {
        await client.listTrips();
      } catch (err) {
        errorMessage = err instanceof Error ? err.message : "";
      }

      // Assert
      expect(errorMessage).toContain("レート制限");
    });

    it("maps network failure to Japanese message", async () => {
      // Arrange
      mockFetch.mockRejectedValue(new TypeError("fetch failed"));

      // Act
      let errorMessage = "";
      try {
        await client.listTrips();
      } catch (err) {
        errorMessage = err instanceof Error ? err.message : "";
      }

      // Assert
      expect(errorMessage).toContain("接続できません");
    });
  });

  describe("query parameters", () => {
    it("appends limit to list_trips request", async () => {
      // Arrange
      mockFetch.mockResolvedValue(makeResponse({ data: [], pagination: {} }, 200));

      // Act
      await client.listTrips({ limit: 10 });

      // Assert
      const url = getFirstCallUrl(mockFetch.mock.calls);
      expect(url).toContain("limit=10");
    });

    it("appends offset to list_trips request", async () => {
      // Arrange
      mockFetch.mockResolvedValue(makeResponse({ data: [], pagination: {} }, 200));

      // Act
      await client.listTrips({ offset: 20 });

      // Assert
      const url = getFirstCallUrl(mockFetch.mock.calls);
      expect(url).toContain("offset=20");
    });

    it("appends scope to list_trips request", async () => {
      // Arrange
      mockFetch.mockResolvedValue(makeResponse({ data: [], pagination: {} }, 200));

      // Act
      await client.listTrips({ scope: "owned" });

      // Assert
      const url = getFirstCallUrl(mockFetch.mock.calls);
      expect(url).toContain("scope=owned");
    });
  });

  describe("createTrip — request assembly", () => {
    const tripBody = { title: "Japan 2025", startDate: "2025-01-01", endDate: "2025-01-05" };

    it("uses POST method", async () => {
      // Arrange
      mockFetch.mockResolvedValue(makeResponse({ id: "abc" }, 201));

      // Act
      await client.createTrip(tripBody);

      // Assert
      expect(getFirstCallMethod(mockFetch.mock.calls)).toBe("POST");
    });

    it("sends to /api/v1/trips", async () => {
      // Arrange
      mockFetch.mockResolvedValue(makeResponse({ id: "abc" }, 201));

      // Act
      await client.createTrip(tripBody);

      // Assert
      expect(getFirstCallUrl(mockFetch.mock.calls)).toContain("/api/v1/trips");
    });

    it("sends Content-Type: application/json header", async () => {
      // Arrange
      mockFetch.mockResolvedValue(makeResponse({ id: "abc" }, 201));

      // Act
      await client.createTrip(tripBody);

      // Assert
      expect(getFirstCallHeaders(mockFetch.mock.calls)["Content-Type"]).toBe("application/json");
    });

    it("serialises the body to JSON", async () => {
      // Arrange
      mockFetch.mockResolvedValue(makeResponse({ id: "abc" }, 201));

      // Act
      await client.createTrip(tripBody);

      // Assert
      expect(getFirstCallBody(mockFetch.mock.calls)).toEqual(tripBody);
    });
  });

  describe("updateTrip — request assembly", () => {
    const tripId = "550e8400-e29b-41d4-a716-446655440000";

    it("uses PATCH method", async () => {
      // Arrange
      mockFetch.mockResolvedValue(makeResponse({ id: tripId }, 200));

      // Act
      await client.updateTrip(tripId, { title: "Updated" });

      // Assert
      expect(getFirstCallMethod(mockFetch.mock.calls)).toBe("PATCH");
    });

    it("sends to /api/v1/trips/:id", async () => {
      // Arrange
      mockFetch.mockResolvedValue(makeResponse({ id: tripId }, 200));

      // Act
      await client.updateTrip(tripId, { title: "Updated" });

      // Assert
      expect(getFirstCallUrl(mockFetch.mock.calls)).toContain(`/api/v1/trips/${tripId}`);
    });
  });

  describe("createSchedule — request assembly", () => {
    const tripId = "550e8400-e29b-41d4-a716-446655440000";

    it("uses POST method", async () => {
      // Arrange
      mockFetch.mockResolvedValue(makeResponse({ id: "s1" }, 201));

      // Act
      await client.createSchedule(tripId, 2, { name: "Lunch", category: "restaurant" });

      // Assert
      expect(getFirstCallMethod(mockFetch.mock.calls)).toBe("POST");
    });

    it("encodes dayNumber in the URL path", async () => {
      // Arrange
      mockFetch.mockResolvedValue(makeResponse({ id: "s1" }, 201));

      // Act
      await client.createSchedule(tripId, 3, { name: "Dinner", category: "restaurant" });

      // Assert
      expect(getFirstCallUrl(mockFetch.mock.calls)).toContain("/days/3/schedules");
    });
  });

  describe("createExpense — request assembly", () => {
    const tripId = "550e8400-e29b-41d4-a716-446655440000";
    const expenseBody = {
      title: "Dinner",
      amount: 3000,
      paidByMemberNo: 1,
      splitType: "equal",
      splits: [{ memberNo: 1 }, { memberNo: 2 }],
    };

    it("uses POST method", async () => {
      // Arrange
      mockFetch.mockResolvedValue(makeResponse({ id: "e1" }, 201));

      // Act
      await client.createExpense(tripId, expenseBody);

      // Assert
      expect(getFirstCallMethod(mockFetch.mock.calls)).toBe("POST");
    });

    it("sends to /api/v1/trips/:tripId/expenses", async () => {
      // Arrange
      mockFetch.mockResolvedValue(makeResponse({ id: "e1" }, 201));

      // Act
      await client.createExpense(tripId, expenseBody);

      // Assert
      expect(getFirstCallUrl(mockFetch.mock.calls)).toContain(`/api/v1/trips/${tripId}/expenses`);
    });
  });

  describe("createBookmarkList — request assembly", () => {
    it("sends to /api/v1/bookmark-lists", async () => {
      // Arrange
      mockFetch.mockResolvedValue(makeResponse({ id: "bl1" }, 201));

      // Act
      await client.createBookmarkList({ name: "Japan 2025" });

      // Assert
      expect(getFirstCallUrl(mockFetch.mock.calls)).toContain("/api/v1/bookmark-lists");
    });
  });

  describe("createArticle — request assembly", () => {
    it("sends to /api/v1/articles", async () => {
      // Arrange
      mockFetch.mockResolvedValue(makeResponse({ id: "a1" }, 201));

      // Act
      await client.createArticle({ title: "My Story" });

      // Assert
      expect(getFirstCallUrl(mockFetch.mock.calls)).toContain("/api/v1/articles");
    });
  });

  describe("candidate methods — request assembly", () => {
    const tripId = "550e8400-e29b-41d4-a716-446655440000";
    const scheduleId = "660e8400-e29b-41d4-a716-446655440000";

    it("listCandidates sends GET to /trips/:tripId/candidates with pagination", async () => {
      mockFetch.mockResolvedValue(makeResponse({ data: [], pagination: {} }, 200));

      await client.listCandidates(tripId, { limit: 10, offset: 5 });

      expect(getFirstCallMethod(mockFetch.mock.calls)).toBe("GET");
      const url = getFirstCallUrl(mockFetch.mock.calls);
      expect(url).toContain(`/api/v1/trips/${tripId}/candidates`);
      expect(url).toContain("limit=10");
      expect(url).toContain("offset=5");
    });

    it("createCandidate POSTs to /trips/:tripId/candidates", async () => {
      mockFetch.mockResolvedValue(makeResponse({ id: "c1" }, 201));

      await client.createCandidate(tripId, { name: "Tokyo Tower", category: "sightseeing" });

      expect(getFirstCallMethod(mockFetch.mock.calls)).toBe("POST");
      expect(getFirstCallUrl(mockFetch.mock.calls)).toContain(`/api/v1/trips/${tripId}/candidates`);
    });

    it("updateCandidate PATCHes /trips/:tripId/candidates/:scheduleId", async () => {
      mockFetch.mockResolvedValue(makeResponse({ id: "c1" }, 200));

      await client.updateCandidate(tripId, scheduleId, { name: "Updated" });

      expect(getFirstCallMethod(mockFetch.mock.calls)).toBe("PATCH");
      expect(getFirstCallUrl(mockFetch.mock.calls)).toContain(
        `/api/v1/trips/${tripId}/candidates/${scheduleId}`,
      );
    });
  });

  describe("q (name search) parameter", () => {
    const tripId = "550e8400-e29b-41d4-a716-446655440000";
    const listId = "880e8400-e29b-41d4-a716-446655440000";

    it("listCandidates appends q to the URL when provided", async () => {
      // Arrange
      mockFetch.mockResolvedValue(makeResponse({ data: [], pagination: {} }, 200));

      // Act
      await client.listCandidates(tripId, { q: "Tower" });

      // Assert
      expect(getFirstCallUrl(mockFetch.mock.calls)).toContain("q=Tower");
    });

    it("listCandidates does not append q when absent", async () => {
      // Arrange
      mockFetch.mockResolvedValue(makeResponse({ data: [], pagination: {} }, 200));

      // Act
      await client.listCandidates(tripId);

      // Assert
      expect(getFirstCallUrl(mockFetch.mock.calls)).not.toContain("q=");
    });

    it("listSouvenirs appends q to the URL when provided", async () => {
      // Arrange
      mockFetch.mockResolvedValue(makeResponse({ data: [], pagination: {} }, 200));

      // Act
      await client.listSouvenirs(tripId, { q: "Matcha" });

      // Assert
      expect(getFirstCallUrl(mockFetch.mock.calls)).toContain("q=Matcha");
    });

    it("listArticles appends q to the URL when provided", async () => {
      // Arrange
      mockFetch.mockResolvedValue(makeResponse({ data: [], pagination: {} }, 200));

      // Act
      await client.listArticles({ q: "Kyoto" });

      // Assert
      expect(getFirstCallUrl(mockFetch.mock.calls)).toContain("q=Kyoto");
    });

    it("listBookmarks appends q to the URL when provided", async () => {
      // Arrange
      mockFetch.mockResolvedValue(makeResponse({ data: [], pagination: {} }, 200));

      // Act
      await client.listBookmarks(listId, { q: "Senso" });

      // Assert
      expect(getFirstCallUrl(mockFetch.mock.calls)).toContain("q=Senso");
    });
  });

  describe("souvenir methods — request assembly", () => {
    const tripId = "550e8400-e29b-41d4-a716-446655440000";
    const itemId = "770e8400-e29b-41d4-a716-446655440000";

    it("listSouvenirs sends GET to /trips/:tripId/souvenirs", async () => {
      mockFetch.mockResolvedValue(makeResponse({ data: [], pagination: {} }, 200));

      await client.listSouvenirs(tripId);

      expect(getFirstCallMethod(mockFetch.mock.calls)).toBe("GET");
      expect(getFirstCallUrl(mockFetch.mock.calls)).toContain(`/api/v1/trips/${tripId}/souvenirs`);
    });

    it("createSouvenir POSTs to /trips/:tripId/souvenirs", async () => {
      mockFetch.mockResolvedValue(makeResponse({ id: "s1" }, 201));

      await client.createSouvenir(tripId, { name: "Matcha KitKat" });

      expect(getFirstCallMethod(mockFetch.mock.calls)).toBe("POST");
      expect(getFirstCallUrl(mockFetch.mock.calls)).toContain(`/api/v1/trips/${tripId}/souvenirs`);
    });

    it("updateSouvenir PATCHes /trips/:tripId/souvenirs/:itemId", async () => {
      mockFetch.mockResolvedValue(makeResponse({ id: "s1" }, 200));

      await client.updateSouvenir(tripId, itemId, { isPurchased: true });

      expect(getFirstCallMethod(mockFetch.mock.calls)).toBe("PATCH");
      expect(getFirstCallUrl(mockFetch.mock.calls)).toContain(
        `/api/v1/trips/${tripId}/souvenirs/${itemId}`,
      );
    });
  });

  describe("batch methods — request assembly", () => {
    const tripId = "550e8400-e29b-41d4-a716-446655440000";
    const batchResponse = { created: [], skipped: [], _meta: { count: 0, max: 300 } };

    it("batchCreateCandidates POSTs to /trips/:tripId/candidates/batch", async () => {
      // Arrange
      mockFetch.mockResolvedValue(makeResponse(batchResponse, 201));

      // Act
      await client.batchCreateCandidates(tripId, [{ name: "Tower", category: "sightseeing" }]);

      // Assert
      expect(getFirstCallMethod(mockFetch.mock.calls)).toBe("POST");
      expect(getFirstCallUrl(mockFetch.mock.calls)).toContain(
        `/api/v1/trips/${tripId}/candidates/batch`,
      );
    });

    it("batchCreateCandidates sends items in the request body", async () => {
      // Arrange
      mockFetch.mockResolvedValue(makeResponse(batchResponse, 201));
      const items = [{ name: "Tower", category: "sightseeing" }];

      // Act
      await client.batchCreateCandidates(tripId, items);

      // Assert
      const body = getFirstCallBody(mockFetch.mock.calls);
      expect(body).toEqual({ items });
    });

    it("batchCreateCandidates includes onConflict when provided", async () => {
      // Arrange
      mockFetch.mockResolvedValue(makeResponse(batchResponse, 201));

      // Act
      await client.batchCreateCandidates(
        tripId,
        [{ name: "Tower", category: "sightseeing" }],
        "skip",
      );

      // Assert
      const body = getFirstCallBody(mockFetch.mock.calls);
      expect(body).toMatchObject({ onConflict: "skip" });
    });

    it("batchCreateCandidates omits onConflict when not provided", async () => {
      // Arrange
      mockFetch.mockResolvedValue(makeResponse(batchResponse, 201));

      // Act
      await client.batchCreateCandidates(tripId, [{ name: "Tower", category: "sightseeing" }]);

      // Assert
      const body = getFirstCallBody(mockFetch.mock.calls) as Record<string, unknown>;
      expect(body).not.toHaveProperty("onConflict");
    });

    it("batchCreateSouvenirs POSTs to /trips/:tripId/souvenirs/batch", async () => {
      // Arrange
      const souvenirBatchResponse = { created: [], skipped: [], _meta: { count: 0, max: 50 } };
      mockFetch.mockResolvedValue(makeResponse(souvenirBatchResponse, 201));

      // Act
      await client.batchCreateSouvenirs(tripId, [{ name: "KitKat" }]);

      // Assert
      expect(getFirstCallMethod(mockFetch.mock.calls)).toBe("POST");
      expect(getFirstCallUrl(mockFetch.mock.calls)).toContain(
        `/api/v1/trips/${tripId}/souvenirs/batch`,
      );
    });

    it("batchCreateSouvenirs sends items in the request body", async () => {
      // Arrange
      const souvenirBatchResponse = { created: [], skipped: [], _meta: { count: 0, max: 50 } };
      mockFetch.mockResolvedValue(makeResponse(souvenirBatchResponse, 201));
      const items = [{ name: "KitKat" }, { name: "Pocky" }];

      // Act
      await client.batchCreateSouvenirs(tripId, items);

      // Assert
      const body = getFirstCallBody(mockFetch.mock.calls);
      expect(body).toEqual({ items });
    });

    it("batchCreateSouvenirs includes onConflict when provided", async () => {
      // Arrange
      const souvenirBatchResponse = { created: [], skipped: [], _meta: { count: 0, max: 50 } };
      mockFetch.mockResolvedValue(makeResponse(souvenirBatchResponse, 201));

      // Act
      await client.batchCreateSouvenirs(tripId, [{ name: "KitKat" }], "skip");

      // Assert
      const body = getFirstCallBody(mockFetch.mock.calls);
      expect(body).toMatchObject({ onConflict: "skip" });
    });
  });

  describe("deleteCandidate — request assembly", () => {
    const tripId = "550e8400-e29b-41d4-a716-446655440000";
    const scheduleId = "550e8400-e29b-41d4-a716-446655440001";

    it("uses DELETE method", async () => {
      // Arrange
      mockFetch.mockResolvedValue(
        makeResponse({ id: scheduleId, deleted: true, remaining: { count: 0, max: 300 } }, 200),
      );

      // Act
      await client.deleteCandidate(tripId, scheduleId);

      // Assert
      expect(getFirstCallMethod(mockFetch.mock.calls)).toBe("DELETE");
    });

    it("sends to /api/v1/trips/:tripId/candidates/:scheduleId", async () => {
      // Arrange
      mockFetch.mockResolvedValue(
        makeResponse({ id: scheduleId, deleted: true, remaining: { count: 0, max: 300 } }, 200),
      );

      // Act
      await client.deleteCandidate(tripId, scheduleId);

      // Assert
      expect(getFirstCallUrl(mockFetch.mock.calls)).toContain(
        `/api/v1/trips/${tripId}/candidates/${scheduleId}`,
      );
    });

    it("does not send a Content-Type header (no body)", async () => {
      // Arrange
      mockFetch.mockResolvedValue(
        makeResponse({ id: scheduleId, deleted: false, remaining: { count: 0, max: 300 } }, 200),
      );

      // Act
      await client.deleteCandidate(tripId, scheduleId);

      // Assert
      const headers = getFirstCallHeaders(mockFetch.mock.calls);
      expect(headers["Content-Type"]).toBeUndefined();
    });
  });

  describe("deleteSouvenir — request assembly", () => {
    const tripId = "550e8400-e29b-41d4-a716-446655440000";
    const itemId = "550e8400-e29b-41d4-a716-446655440002";

    it("uses DELETE method", async () => {
      // Arrange
      mockFetch.mockResolvedValue(
        makeResponse({ id: itemId, deleted: true, remaining: { count: 0, max: 30 } }, 200),
      );

      // Act
      await client.deleteSouvenir(tripId, itemId);

      // Assert
      expect(getFirstCallMethod(mockFetch.mock.calls)).toBe("DELETE");
    });

    it("sends to /api/v1/trips/:tripId/souvenirs/:itemId", async () => {
      // Arrange
      mockFetch.mockResolvedValue(
        makeResponse({ id: itemId, deleted: true, remaining: { count: 0, max: 30 } }, 200),
      );

      // Act
      await client.deleteSouvenir(tripId, itemId);

      // Assert
      expect(getFirstCallUrl(mockFetch.mock.calls)).toContain(
        `/api/v1/trips/${tripId}/souvenirs/${itemId}`,
      );
    });
  });

  describe("deleteSchedule — request assembly", () => {
    const tripId = "550e8400-e29b-41d4-a716-446655440000";
    const scheduleId = "550e8400-e29b-41d4-a716-446655440003";

    it("uses DELETE method", async () => {
      // Arrange
      mockFetch.mockResolvedValue(
        makeResponse({ id: scheduleId, deleted: true, remaining: { count: 0, max: 300 } }, 200),
      );

      // Act
      await client.deleteSchedule(tripId, scheduleId);

      // Assert
      expect(getFirstCallMethod(mockFetch.mock.calls)).toBe("DELETE");
    });

    it("sends to /api/v1/trips/:tripId/schedules/:scheduleId", async () => {
      // Arrange
      mockFetch.mockResolvedValue(
        makeResponse({ id: scheduleId, deleted: true, remaining: { count: 0, max: 300 } }, 200),
      );

      // Act
      await client.deleteSchedule(tripId, scheduleId);

      // Assert
      expect(getFirstCallUrl(mockFetch.mock.calls)).toContain(
        `/api/v1/trips/${tripId}/schedules/${scheduleId}`,
      );
    });
  });

  describe("deleteExpense — request assembly", () => {
    const tripId = "550e8400-e29b-41d4-a716-446655440000";
    const expenseId = "550e8400-e29b-41d4-a716-446655440004";

    it("uses DELETE method", async () => {
      // Arrange
      mockFetch.mockResolvedValue(
        makeResponse({ id: expenseId, deleted: true, remaining: { count: 0, max: 200 } }, 200),
      );

      // Act
      await client.deleteExpense(tripId, expenseId);

      // Assert
      expect(getFirstCallMethod(mockFetch.mock.calls)).toBe("DELETE");
    });

    it("sends to /api/v1/trips/:tripId/expenses/:expenseId", async () => {
      // Arrange
      mockFetch.mockResolvedValue(
        makeResponse({ id: expenseId, deleted: true, remaining: { count: 0, max: 200 } }, 200),
      );

      // Act
      await client.deleteExpense(tripId, expenseId);

      // Assert
      expect(getFirstCallUrl(mockFetch.mock.calls)).toContain(
        `/api/v1/trips/${tripId}/expenses/${expenseId}`,
      );
    });
  });

  describe("deleteBookmark — request assembly", () => {
    const listId = "550e8400-e29b-41d4-a716-446655440010";
    const bookmarkId = "550e8400-e29b-41d4-a716-446655440011";

    it("uses DELETE method", async () => {
      // Arrange
      mockFetch.mockResolvedValue(
        makeResponse({ id: bookmarkId, deleted: true, remaining: { count: 0, max: 100 } }, 200),
      );

      // Act
      await client.deleteBookmark(listId, bookmarkId);

      // Assert
      expect(getFirstCallMethod(mockFetch.mock.calls)).toBe("DELETE");
    });

    it("sends to /api/v1/bookmark-lists/:listId/bookmarks/:bookmarkId", async () => {
      // Arrange
      mockFetch.mockResolvedValue(
        makeResponse({ id: bookmarkId, deleted: true, remaining: { count: 0, max: 100 } }, 200),
      );

      // Act
      await client.deleteBookmark(listId, bookmarkId);

      // Assert
      expect(getFirstCallUrl(mockFetch.mock.calls)).toContain(
        `/api/v1/bookmark-lists/${listId}/bookmarks/${bookmarkId}`,
      );
    });
  });

  describe("deleteBookmarkList — request assembly", () => {
    const listId = "550e8400-e29b-41d4-a716-446655440020";

    it("uses DELETE method", async () => {
      // Arrange
      mockFetch.mockResolvedValue(
        makeResponse({ id: listId, deleted: true, remaining: { count: 0, max: 10 } }, 200),
      );

      // Act
      await client.deleteBookmarkList(listId);

      // Assert
      expect(getFirstCallMethod(mockFetch.mock.calls)).toBe("DELETE");
    });

    it("sends to /api/v1/bookmark-lists/:listId", async () => {
      // Arrange
      mockFetch.mockResolvedValue(
        makeResponse({ id: listId, deleted: true, remaining: { count: 0, max: 10 } }, 200),
      );

      // Act
      await client.deleteBookmarkList(listId);

      // Assert
      expect(getFirstCallUrl(mockFetch.mock.calls)).toContain(`/api/v1/bookmark-lists/${listId}`);
    });
  });

  describe("deleteArticle — request assembly", () => {
    const articleId = "550e8400-e29b-41d4-a716-446655440030";

    it("uses DELETE method", async () => {
      // Arrange
      mockFetch.mockResolvedValue(
        makeResponse({ id: articleId, deleted: true, remaining: { count: 0, max: 50 } }, 200),
      );

      // Act
      await client.deleteArticle(articleId);

      // Assert
      expect(getFirstCallMethod(mockFetch.mock.calls)).toBe("DELETE");
    });

    it("sends to /api/v1/articles/:articleId", async () => {
      // Arrange
      mockFetch.mockResolvedValue(
        makeResponse({ id: articleId, deleted: true, remaining: { count: 0, max: 50 } }, 200),
      );

      // Act
      await client.deleteArticle(articleId);

      // Assert
      expect(getFirstCallUrl(mockFetch.mock.calls)).toContain(`/api/v1/articles/${articleId}`);
    });
  });

  describe("pattern methods — request assembly", () => {
    const tripId = "550e8400-e29b-41d4-a716-446655440000";
    const patternId = "660e8400-e29b-41d4-a716-446655440000";
    const sourcePatternId = "660e8400-e29b-41d4-a716-446655440001";
    const patternResponse = {
      id: patternId,
      label: "Rainy plan",
      isDefault: false,
      sortOrder: 1,
      createdAt: "2025-01-01T00:00:00.000Z",
    };

    it("createPattern POSTs to /trips/:tripId/days/:dayNumber/patterns with the label body", async () => {
      // Arrange
      mockFetch.mockResolvedValue(makeResponse(patternResponse, 201));

      // Act
      await client.createPattern(tripId, 2, { label: "Rainy plan" });

      // Assert
      expect(getFirstCallMethod(mockFetch.mock.calls)).toBe("POST");
      expect(getFirstCallUrl(mockFetch.mock.calls)).toContain(
        `/api/v1/trips/${tripId}/days/2/patterns`,
      );
      expect(getFirstCallBody(mockFetch.mock.calls)).toEqual({ label: "Rainy plan" });
    });

    it("updatePattern PATCHes /trips/:tripId/patterns/:patternId", async () => {
      // Arrange
      mockFetch.mockResolvedValue(makeResponse(patternResponse, 200));

      // Act
      await client.updatePattern(tripId, patternId, { label: "Updated plan" });

      // Assert
      expect(getFirstCallMethod(mockFetch.mock.calls)).toBe("PATCH");
      expect(getFirstCallUrl(mockFetch.mock.calls)).toContain(
        `/api/v1/trips/${tripId}/patterns/${patternId}`,
      );
    });

    it("deletePattern DELETEs /trips/:tripId/patterns/:patternId", async () => {
      // Arrange
      mockFetch.mockResolvedValue(makeResponse({ id: patternId, deleted: true }, 200));

      // Act
      await client.deletePattern(tripId, patternId);

      // Assert
      expect(getFirstCallMethod(mockFetch.mock.calls)).toBe("DELETE");
      expect(getFirstCallUrl(mockFetch.mock.calls)).toContain(
        `/api/v1/trips/${tripId}/patterns/${patternId}`,
      );
    });

    it("duplicatePattern POSTs to /trips/:tripId/patterns/:patternId/duplicate with no body", async () => {
      // Arrange
      mockFetch.mockResolvedValue(makeResponse(patternResponse, 201));

      // Act
      await client.duplicatePattern(tripId, patternId);

      // Assert
      expect(getFirstCallMethod(mockFetch.mock.calls)).toBe("POST");
      expect(getFirstCallUrl(mockFetch.mock.calls)).toContain(
        `/api/v1/trips/${tripId}/patterns/${patternId}/duplicate`,
      );
      const headers = getFirstCallHeaders(mockFetch.mock.calls);
      expect(headers["Content-Type"]).toBeUndefined();
      const [, initArg] = mockFetch.mock.calls[0];
      expect(initArg?.body).toBeUndefined();
    });

    it("overwritePattern POSTs to /trips/:tripId/patterns/:patternId/overwrite with sourcePatternId body", async () => {
      // Arrange
      mockFetch.mockResolvedValue(makeResponse(patternResponse, 200));

      // Act
      await client.overwritePattern(tripId, patternId, { sourcePatternId });

      // Assert
      expect(getFirstCallMethod(mockFetch.mock.calls)).toBe("POST");
      expect(getFirstCallUrl(mockFetch.mock.calls)).toContain(
        `/api/v1/trips/${tripId}/patterns/${patternId}/overwrite`,
      );
      expect(getFirstCallBody(mockFetch.mock.calls)).toEqual({ sourcePatternId });
    });
  });

  describe("schedule-assignment methods — request assembly", () => {
    const tripId = "550e8400-e29b-41d4-a716-446655440000";
    const scheduleId = "660e8400-e29b-41d4-a716-446655440000";
    const patternId = "660e8400-e29b-41d4-a716-446655440001";
    const scheduleResponse = { id: scheduleId, name: "Test schedule" };

    it("assignCandidate POSTs to /trips/:tripId/candidates/:scheduleId/assign with patternId body", async () => {
      // Arrange
      mockFetch.mockResolvedValue(makeResponse(scheduleResponse, 200));

      // Act
      await client.assignCandidate(tripId, scheduleId, { patternId });

      // Assert
      expect(getFirstCallMethod(mockFetch.mock.calls)).toBe("POST");
      expect(getFirstCallUrl(mockFetch.mock.calls)).toContain(
        `/api/v1/trips/${tripId}/candidates/${scheduleId}/assign`,
      );
      expect(getFirstCallBody(mockFetch.mock.calls)).toEqual({ patternId });
    });

    it("unassignSchedule POSTs to /trips/:tripId/schedules/:scheduleId/unassign with no body", async () => {
      // Arrange
      mockFetch.mockResolvedValue(makeResponse(scheduleResponse, 200));

      // Act
      await client.unassignSchedule(tripId, scheduleId);

      // Assert
      expect(getFirstCallMethod(mockFetch.mock.calls)).toBe("POST");
      expect(getFirstCallUrl(mockFetch.mock.calls)).toContain(
        `/api/v1/trips/${tripId}/schedules/${scheduleId}/unassign`,
      );
      const headers = getFirstCallHeaders(mockFetch.mock.calls);
      expect(headers["Content-Type"]).toBeUndefined();
      const [, initArg] = mockFetch.mock.calls[0];
      expect(initArg?.body).toBeUndefined();
    });

    it("moveSchedule POSTs to /trips/:tripId/schedules/:scheduleId/move with patternId body", async () => {
      // Arrange
      mockFetch.mockResolvedValue(makeResponse(scheduleResponse, 200));

      // Act
      await client.moveSchedule(tripId, scheduleId, { patternId });

      // Assert
      expect(getFirstCallMethod(mockFetch.mock.calls)).toBe("POST");
      expect(getFirstCallUrl(mockFetch.mock.calls)).toContain(
        `/api/v1/trips/${tripId}/schedules/${scheduleId}/move`,
      );
      expect(getFirstCallBody(mockFetch.mock.calls)).toEqual({ patternId });
    });
  });
});
