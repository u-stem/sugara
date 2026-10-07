import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestApp, TEST_USER } from "./test-helpers";

const mockGetSession = vi.fn();
const mockDbSelect = vi.fn();
const mockDbUpdate = vi.fn();
const mockHashPassword = vi.fn();
const mockTxUpdate = vi.fn();
const mockTxDelete = vi.fn();
const mockRevokeApiKeysByUserId = vi.fn();

vi.mock("../lib/auth", () => ({
  auth: {
    api: {
      getSession: (...args: unknown[]) => mockGetSession(...args),
    },
  },
}));

vi.mock("../db/index", () => ({
  db: {
    select: (...args: unknown[]) => mockDbSelect(...args),
    update: (...args: unknown[]) => mockDbUpdate(...args),
    transaction: (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        update: (...args: unknown[]) => mockTxUpdate(...args),
        delete: (...args: unknown[]) => mockTxDelete(...args),
      }),
  },
}));

vi.mock("../lib/password", () => ({
  hashPassword: (...args: unknown[]) => mockHashPassword(...args),
}));

vi.mock("../lib/external-api/api-key", () => ({
  revokeApiKeysByUserId: (...args: unknown[]) => mockRevokeApiKeysByUserId(...args),
}));

import { sessions } from "../db/schema";
import { adminRoutes } from "../routes/admin";

const ADMIN_USER = {
  ...TEST_USER,
  username: "adminuser",
  isAnonymous: false,
  guestExpiresAt: null,
};

const REGULAR_USER = {
  ...TEST_USER,
  id: "user-2",
  username: "regularuser",
  isAnonymous: false,
  guestExpiresAt: null,
};

function createApp() {
  return createTestApp(adminRoutes, "/");
}

describe("GET /api/admin/users", () => {
  const app = createApp();

  beforeEach(() => {
    process.env.ADMIN_USERNAME = "adminuser";
  });

  it("非管理者なら 403 を返す", async () => {
    mockGetSession.mockResolvedValue({
      user: REGULAR_USER,
      session: { id: "session-1" },
    });
    const res = await app.request("/api/admin/users");
    expect(res.status).toBe(403);
  });

  it("管理者ならユーザー一覧を返す", async () => {
    mockGetSession.mockResolvedValue({
      user: ADMIN_USER,
      session: { id: "session-1" },
    });
    const mockUsers = [
      {
        id: "user-1",
        username: "alice",
        displayUsername: "Alice",
        email: "alice@gmail.com",
        emailVerified: true,
        tripLimit: null,
        createdAt: new Date("2026-01-01"),
        tripCount: 3,
      },
    ];
    mockDbSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        leftJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            groupBy: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockResolvedValue(mockUsers),
            }),
          }),
        }),
      }),
    });
    const res = await app.request("/api/admin/users");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.users)).toBe(true);
    expect(body.users[0]).toMatchObject({
      id: "user-1",
      username: expect.any(String),
      hasRealEmail: expect.any(Boolean),
      tripCount: 3,
      // null override falls back to the global default
      tripLimit: 10,
    });
  });
});

describe("PATCH /api/admin/users/:userId/trip-limit", () => {
  const app = createApp();

  beforeEach(() => {
    process.env.ADMIN_USERNAME = "adminuser";
  });

  it("非管理者なら 403 を返す", async () => {
    mockGetSession.mockResolvedValue({
      user: REGULAR_USER,
      session: { id: "session-1" },
    });
    const res = await app.request("/api/admin/users/user-target/trip-limit", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tripLimit: 20 }),
    });
    expect(res.status).toBe(403);
  });

  it("不正な値なら 400 を返す", async () => {
    mockGetSession.mockResolvedValue({
      user: ADMIN_USER,
      session: { id: "session-1" },
    });
    const res = await app.request("/api/admin/users/user-target/trip-limit", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tripLimit: 0 }),
    });
    expect(res.status).toBe(400);
  });

  it("存在しないユーザーなら 404 を返す", async () => {
    mockGetSession.mockResolvedValue({
      user: ADMIN_USER,
      session: { id: "session-1" },
    });
    mockDbUpdate.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([]),
        }),
      }),
    });
    const res = await app.request("/api/admin/users/non-existent-id/trip-limit", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tripLimit: 20 }),
    });
    expect(res.status).toBe(404);
  });

  it("管理者なら上限を更新する", async () => {
    mockGetSession.mockResolvedValue({
      user: ADMIN_USER,
      session: { id: "session-1" },
    });
    mockDbUpdate.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: "user-target", tripLimit: 20 }]),
        }),
      }),
    });
    const res = await app.request("/api/admin/users/user-target/trip-limit", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tripLimit: 20 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tripLimit).toBe(20);
  });
});

describe("POST /api/admin/users/:userId/temp-password", () => {
  const app = createApp();

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ADMIN_USERNAME = "adminuser";
    mockHashPassword.mockResolvedValue("hashed-password");
    mockGetSession.mockResolvedValue({
      user: ADMIN_USER,
      session: { id: "session-1" },
    });
    mockDbSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{ id: "user-target" }]),
        }),
      }),
    });
    mockTxUpdate.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: "account-1" }]),
        }),
      }),
    });
    mockTxDelete.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
    mockRevokeApiKeysByUserId.mockResolvedValue(undefined);
  });

  it("非管理者なら 403 を返す", async () => {
    mockGetSession.mockResolvedValue({
      user: REGULAR_USER,
      session: { id: "session-1" },
    });
    const res = await app.request("/api/admin/users/some-user-id/temp-password", {
      method: "POST",
    });
    expect(res.status).toBe(403);
  });

  it("存在しないユーザーなら 404 を返す", async () => {
    mockGetSession.mockResolvedValue({
      user: ADMIN_USER,
      session: { id: "session-1" },
    });
    mockDbSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    });
    const res = await app.request("/api/admin/users/non-existent-id/temp-password", {
      method: "POST",
    });
    expect(res.status).toBe(404);
  });

  it("管理者なら一時パスワードを返す", async () => {
    mockGetSession.mockResolvedValue({
      user: ADMIN_USER,
      session: { id: "session-1" },
    });
    mockDbSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{ id: "user-target" }]),
        }),
      }),
    });
    const res = await app.request("/api/admin/users/user-target/temp-password", {
      method: "POST",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tempPassword).toMatch(/^[A-Za-z0-9]{12}$/);
  });

  it("対象ユーザーの全セッションを削除する", async () => {
    await app.request("/api/admin/users/user-target/temp-password", { method: "POST" });
    expect(mockTxDelete).toHaveBeenCalledWith(sessions);
  });

  it("対象ユーザーの API キーを全て失効させる", async () => {
    await app.request("/api/admin/users/user-target/temp-password", { method: "POST" });
    expect(mockRevokeApiKeysByUserId).toHaveBeenCalledWith("user-target");
  });

  it("セッション削除に失敗したら 500 を返す", async () => {
    mockTxDelete.mockReturnValue({ where: vi.fn().mockRejectedValue(new Error("db down")) });
    const res = await app.request("/api/admin/users/user-target/temp-password", {
      method: "POST",
    });
    expect(res.status).toBe(500);
  });

  it("API キー失効に失敗したら 500 を返す", async () => {
    mockRevokeApiKeysByUserId.mockRejectedValue(new Error("db down"));
    const res = await app.request("/api/admin/users/user-target/temp-password", {
      method: "POST",
    });
    expect(res.status).toBe(500);
  });

  it("API キー失効に失敗したら一時パスワードを返さない", async () => {
    mockRevokeApiKeysByUserId.mockRejectedValue(new Error("db down"));
    const res = await app.request("/api/admin/users/user-target/temp-password", {
      method: "POST",
    });
    expect(await res.text()).not.toContain("tempPassword");
  });

  it("credential アカウントが無ければ 404 を返し、セッションを削除しない", async () => {
    mockTxUpdate.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([]),
        }),
      }),
    });
    await app.request("/api/admin/users/user-target/temp-password", { method: "POST" });
    expect(mockTxDelete).not.toHaveBeenCalled();
  });

  it("credential アカウントが無ければ API キーを失効させない", async () => {
    mockTxUpdate.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([]),
        }),
      }),
    });
    await app.request("/api/admin/users/user-target/temp-password", { method: "POST" });
    expect(mockRevokeApiKeysByUserId).not.toHaveBeenCalled();
  });
});
