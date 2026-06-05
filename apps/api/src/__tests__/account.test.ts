import { ERROR_CODE } from "@sugara/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestApp } from "./test-helpers";

const { mockGetSession, mockDbQuery, mockDbDelete, mockVerifyPassword } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockDbQuery: {
    accounts: {
      findFirst: vi.fn(),
    },
  },
  mockDbDelete: vi.fn(),
  mockVerifyPassword: vi.fn(),
}));

vi.mock("../lib/auth", () => ({
  auth: {
    api: {
      getSession: (...args: unknown[]) => mockGetSession(...args),
    },
  },
}));

vi.mock("../db/index", () => ({
  db: {
    query: mockDbQuery,
    delete: (...args: unknown[]) => mockDbDelete(...args),
  },
}));

vi.mock("better-auth/crypto", () => ({
  verifyPassword: (...args: unknown[]) => mockVerifyPassword(...args),
}));

import { accountRoutes } from "../routes/account";

const userId = "00000000-0000-0000-0000-000000000001";
const fakeUser = { id: userId, name: "Test User", email: "test@sugara.local" };

describe("Account routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue({
      user: fakeUser,
      session: { id: "session-1" },
    });
  });

  it("returns 401 without auth", async () => {
    mockGetSession.mockResolvedValue(null);
    const app = createTestApp(accountRoutes, "/api");
    const res = await app.request("/api/account", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "test" }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 400 when password is missing", async () => {
    const app = createTestApp(accountRoutes, "/api");
    const res = await app.request("/api/account", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "" }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe(ERROR_CODE.VALIDATION);
  });

  it("returns 404 when credential account not found", async () => {
    mockDbQuery.accounts.findFirst.mockResolvedValue(undefined);
    const app = createTestApp(accountRoutes, "/api");
    const res = await app.request("/api/account", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "test" }),
    });
    expect(res.status).toBe(404);
  });

  it("returns 401 when password does not match", async () => {
    mockDbQuery.accounts.findFirst.mockResolvedValue({
      password: "hashed-password",
    });
    mockVerifyPassword.mockResolvedValue(false);
    const app = createTestApp(accountRoutes, "/api");
    const res = await app.request("/api/account", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "wrong-password" }),
    });
    expect(res.status).toBe(401);
    expect(mockVerifyPassword).toHaveBeenCalledWith({
      password: "wrong-password",
      hash: "hashed-password",
    });
  });

  it("returns 204 and deletes user when password is correct", async () => {
    mockDbQuery.accounts.findFirst.mockResolvedValue({
      password: "hashed-password",
    });
    mockVerifyPassword.mockResolvedValue(true);
    mockDbDelete.mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    });
    const app = createTestApp(accountRoutes, "/api");
    const res = await app.request("/api/account", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "correct-password" }),
    });
    expect(res.status).toBe(204);
    expect(mockDbDelete).toHaveBeenCalledOnce();
    expect(mockVerifyPassword).toHaveBeenCalledWith({
      password: "correct-password",
      hash: "hashed-password",
    });
  });
});
