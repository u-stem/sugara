import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient, type FetchLike } from "../client.js";

function makeResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
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
      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      const headers = init.headers as Record<string, string>;
      expect(headers["Authorization"]).toBe("Bearer sk_test_key");
    });

    it("does not include the API key in error messages on 401", async () => {
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
      expect(errorMessage).not.toContain("sk_test_key");
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
      const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toContain("limit=10");
    });

    it("appends offset to list_trips request", async () => {
      // Arrange
      mockFetch.mockResolvedValue(makeResponse({ data: [], pagination: {} }, 200));

      // Act
      await client.listTrips({ offset: 20 });

      // Assert
      const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toContain("offset=20");
    });

    it("appends scope to list_trips request", async () => {
      // Arrange
      mockFetch.mockResolvedValue(makeResponse({ data: [], pagination: {} }, 200));

      // Act
      await client.listTrips({ scope: "owned" });

      // Assert
      const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toContain("scope=owned");
    });
  });
});
