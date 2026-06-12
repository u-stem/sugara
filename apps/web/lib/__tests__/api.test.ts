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

  it("never exposes the raw English server message for 404 without opts", () => {
    const error = new ApiError("Souvenir not found", 404);

    expect(getApiErrorMessage(error, "削除に失敗しました")).toBe("削除に失敗しました");
  });

  it("never exposes the raw English server message for 400 without opts", () => {
    const error = new ApiError("Invalid request body", 400);

    expect(getApiErrorMessage(error, "保存に失敗しました")).toBe("保存に失敗しました");
  });

  it("never exposes the raw English server message for 409 without opts", () => {
    const error = new ApiError("Already a member", 409);

    expect(getApiErrorMessage(error, "追加に失敗しました")).toBe("追加に失敗しました");
  });

  it("returns the conflict message for 409 when provided", () => {
    const error = new ApiError("Already a member", 409);

    expect(getApiErrorMessage(error, "fallback", { conflict: "すでにメンバーです" })).toBe(
      "すでにメンバーです",
    );
  });

  it("never exposes the raw English server message for 403", () => {
    const error = new ApiError("Forbidden", 403);

    expect(getApiErrorMessage(error, "権限がありません")).toBe("権限がありません");
  });

  it("returns the fallback for non-ApiError errors instead of technical messages", () => {
    const error = new TypeError("Failed to fetch");

    expect(getApiErrorMessage(error, "通信に失敗しました")).toBe("通信に失敗しました");
  });

  it("byCode string value takes priority over conflict opts", () => {
    const error = new ApiError("Already a member", 409, "ALREADY_MEMBER");

    expect(
      getApiErrorMessage(error, "fallback", {
        conflict: "conflict msg",
        byCode: { ALREADY_MEMBER: "すでにメンバーです" },
      }),
    ).toBe("すでにメンバーです");
  });

  it("byCode function receives details.max when present", () => {
    const error = new ApiError("limit", 409, "LIMIT_MEMBERS", { max: 20 });
    const handler = vi.fn().mockReturnValue("20人まで");

    getApiErrorMessage(error, "fallback", { byCode: { LIMIT_MEMBERS: handler } });

    expect(handler).toHaveBeenCalledWith(20);
  });

  it("byCode function receives undefined when details are missing", () => {
    const error = new ApiError("limit", 409, "LIMIT_MEMBERS");
    const handler = vi.fn().mockReturnValue("上限に達しました");

    getApiErrorMessage(error, "fallback", { byCode: { LIMIT_MEMBERS: handler } });

    expect(handler).toHaveBeenCalledWith(undefined);
  });

  it("falls back to conflict opts when code is not in byCode map", () => {
    const error = new ApiError("Already a member", 409, "ALREADY_MEMBER");

    expect(
      getApiErrorMessage(error, "fallback", {
        conflict: "conflict msg",
        byCode: { LIMIT_MEMBERS: "limit msg" },
      }),
    ).toBe("conflict msg");
  });

  it("returns fallback when neither byCode nor status opts match", () => {
    const error = new ApiError("Already a member", 409, "ALREADY_MEMBER");

    expect(getApiErrorMessage(error, "fallback", { byCode: { LIMIT_MEMBERS: "limit msg" } })).toBe(
      "fallback",
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
