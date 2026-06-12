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
});
