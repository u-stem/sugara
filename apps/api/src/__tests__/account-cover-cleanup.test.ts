import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestApp } from "./test-helpers";

const { mockGetSession, mockDbQuery, mockDbDelete, mockVerifyPassword, mockStorageRemove } =
  vi.hoisted(() => ({
    mockGetSession: vi.fn(),
    mockDbQuery: {
      accounts: { findFirst: vi.fn() },
      trips: { findMany: vi.fn() },
    },
    mockDbDelete: vi.fn(),
    mockVerifyPassword: vi.fn(),
    mockStorageRemove: vi.fn(),
  }));

vi.mock("../lib/auth", () => ({
  auth: { api: { getSession: (...args: unknown[]) => mockGetSession(...args) } },
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

// The in-memory limiter allows 5 deletions per window; this file issues more.
vi.mock("../middleware/rate-limit", () => ({
  rateLimitByIp: () => async (_c: unknown, next: () => Promise<void>) => next(),
}));

// Mock the Supabase client rather than ../lib/storage so the route is exercised
// together with the real best-effort error handling of the Storage helper.
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    storage: { from: () => ({ remove: (...args: unknown[]) => mockStorageRemove(...args) }) },
  }),
}));

process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";

import { accountRoutes } from "../routes/account";

const coverUrl = (path: string) =>
  `https://xxx.supabase.co/storage/v1/object/public/trip-covers/${path}`;

function arrangeDeletableAccount() {
  mockDbQuery.accounts.findFirst.mockResolvedValue({ password: "hashed-password" });
  mockVerifyPassword.mockResolvedValue(true);
  mockDbDelete.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
  mockDbQuery.trips.findMany.mockResolvedValue([
    { coverImageUrl: coverUrl("trip-1/1.jpg") },
    { coverImageUrl: coverUrl("trip-2/2.png") },
  ]);
}

function requestDelete() {
  const app = createTestApp(accountRoutes, "/api");
  return app.request("/api/account", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "correct-password" }),
  });
}

describe("DELETE /api/account cover image cleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue({
      user: { id: "user-1", name: "Test User", email: "test@example.com" },
      session: { id: "session-1" },
    });
    mockStorageRemove.mockResolvedValue({ data: [], error: null });
  });

  it("removes the cover images of the user's trips from Storage", async () => {
    arrangeDeletableAccount();

    await requestDelete();

    expect(mockStorageRemove).toHaveBeenCalledExactlyOnceWith(["trip-1/1.jpg", "trip-2/2.png"]);
  });

  it("does not call Storage when the user has no cover images", async () => {
    arrangeDeletableAccount();
    mockDbQuery.trips.findMany.mockResolvedValue([]);

    await requestDelete();

    expect(mockStorageRemove).not.toHaveBeenCalled();
  });

  it("still returns 204 when Storage deletion fails", async () => {
    arrangeDeletableAccount();
    mockStorageRemove.mockResolvedValue({ data: null, error: { message: "storage down" } });

    const res = await requestDelete();

    expect(res.status).toBe(204);
  });

  it("still returns 204 when the Storage call throws", async () => {
    arrangeDeletableAccount();
    mockStorageRemove.mockRejectedValue(new Error("network down"));

    const res = await requestDelete();

    expect(res.status).toBe(204);
  });

  it("keeps the cover images when the DB deletion fails", async () => {
    arrangeDeletableAccount();
    mockDbDelete.mockReturnValue({ where: vi.fn().mockRejectedValue(new Error("db down")) });

    await requestDelete();

    expect(mockStorageRemove).not.toHaveBeenCalled();
  });
});
