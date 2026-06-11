import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, api, apiVoid, getApiErrorMessage } from "../api";

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("api", () => {
  it("sends GET request with credentials", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ data: "test" }),
    });

    const result = await api("/api/trips");

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/trips",
      expect.objectContaining({
        credentials: "include",
        headers: {},
      }),
    );
    expect(result).toEqual({ data: "test" });
  });

  it("appends query params to URL", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve([]),
    });

    await api("/api/trips", { params: { status: "active" } });

    expect(mockFetch).toHaveBeenCalledWith("/api/trips?status=active", expect.any(Object));
  });

  it("throws ApiError on non-ok response", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      json: () => Promise.resolve({ error: "Trip not found" }),
    });

    await expect(api("/api/trips/123")).rejects.toThrow(ApiError);
    await expect(api("/api/trips/123")).rejects.toMatchObject({
      message: "Trip not found",
      status: 404,
    });
  });

  it("handles non-JSON error response", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.reject(new Error("not json")),
    });

    await expect(api("/api/trips")).rejects.toMatchObject({
      message: "Unknown error",
      status: 500,
    });
  });

  it("throws ApiError for 204 responses to surface the type lie", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 204,
    });

    await expect(api("/api/trips/123")).rejects.toMatchObject({
      status: 204,
      message: expect.stringContaining("apiVoid"),
    });
  });

  it("sends POST request with body", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 201,
      json: () => Promise.resolve({ id: "new-trip" }),
    });

    const body = JSON.stringify({ title: "Test" });
    await api("/api/trips", { method: "POST", body });

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/trips",
      expect.objectContaining({
        method: "POST",
        body,
        headers: expect.objectContaining({
          "Content-Type": "application/json",
        }),
      }),
    );
  });
});

describe("apiVoid", () => {
  it("resolves on 204 responses without parsing a body", async () => {
    const json = vi.fn();
    mockFetch.mockResolvedValue({ ok: true, status: 204, json });

    await expect(apiVoid("/api/account", { method: "DELETE" })).resolves.toBeUndefined();
    expect(json).not.toHaveBeenCalled();
  });

  it("throws ApiError on non-ok response", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 403,
      json: () => Promise.resolve({ error: "Forbidden" }),
    });

    await expect(apiVoid("/api/account", { method: "DELETE" })).rejects.toMatchObject({
      message: "Forbidden",
      status: 403,
    });
  });
});

describe("ApiError", () => {
  it("has correct name and status", () => {
    const error = new ApiError("Not found", 404);
    expect(error.name).toBe("ApiError");
    expect(error.message).toBe("Not found");
    expect(error.status).toBe(404);
    expect(error).toBeInstanceOf(Error);
  });

  it("optionally carries a code and details", () => {
    const error = new ApiError("invalid", 400, "VALIDATION", { f: ["x"] });
    expect(error.code).toBe("VALIDATION");
    expect(error.details).toEqual({ f: ["x"] });
  });
});

describe("getApiErrorMessage", () => {
  it("returns the fallback for internal guard errors with non-error statuses", () => {
    const guardError = new ApiError(
      "Expected JSON body from /api/x but got 204 No Content. Use apiVoid() for endpoints that return no body.",
      204,
    );

    expect(getApiErrorMessage(guardError, "削除に失敗しました")).toBe("削除に失敗しました");
  });

  it("returns the notFound message for 404 when provided", () => {
    const error = new ApiError("Souvenir not found", 404);

    expect(getApiErrorMessage(error, "fallback", { notFound: "対象が見つかりません" })).toBe(
      "対象が見つかりません",
    );
  });
});

describe("fetchApi error shape parsing", () => {
  it("parses the standardized { code, message, details } shape", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      json: () =>
        Promise.resolve({
          code: "VALIDATION",
          message: "入力内容を確認してください",
          details: { fieldErrors: { title: ["Required"] } },
        }),
    });

    await expect(apiVoid("/api/x", { method: "POST" })).rejects.toMatchObject({
      status: 400,
      code: "VALIDATION",
      message: "入力内容を確認してください",
      details: { fieldErrors: { title: ["Required"] } },
    });
  });

  it("keeps a legacy object { error } (Zod flatten) as details instead of swallowing it", async () => {
    const flatten = { formErrors: [], fieldErrors: { title: ["Required"] } };
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ error: flatten }),
    });

    const err = await apiVoid("/api/x", { method: "POST" }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(400);
    expect(err.details).toEqual(flatten);
    expect(err.message).toContain("400");
  });
});
