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
});
