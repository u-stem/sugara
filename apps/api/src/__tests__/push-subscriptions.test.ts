import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestApp } from "./test-helpers";

const { mockGetSession, mockDbInsert, mockDbDelete, mockDbSelect, mockDbQuery, mockDbUpdate } =
  vi.hoisted(() => ({
    mockGetSession: vi.fn(),
    mockDbInsert: vi.fn(),
    mockDbDelete: vi.fn(),
    mockDbSelect: vi.fn(),
    mockDbQuery: {
      pushSubscriptions: { findFirst: vi.fn() },
    },
    mockDbUpdate: vi.fn(),
  }));

vi.mock("../lib/auth", () => ({
  auth: { api: { getSession: (...args: unknown[]) => mockGetSession(...args) } },
}));

vi.mock("../db/index", () => {
  const tx = {
    insert: (...args: unknown[]) => mockDbInsert(...args),
    delete: (...args: unknown[]) => mockDbDelete(...args),
    select: (...args: unknown[]) => mockDbSelect(...args),
    query: mockDbQuery,
    update: (...args: unknown[]) => mockDbUpdate(...args),
  };
  return {
    db: { ...tx, transaction: (fn: (t: typeof tx) => unknown) => fn(tx) },
  };
});

import { pushSubscriptionRoutes } from "../routes/push-subscriptions";

const fakeUser = { id: "user-1", name: "Test" };
const validBody = {
  endpoint: "https://fcm.googleapis.com/push/1",
  p256dh: "abc123",
  auth: "xyz789",
};

describe("Push subscription routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue({ user: fakeUser, session: { id: "s1" } });
    mockDbInsert.mockReturnValue({
      values: vi
        .fn()
        .mockReturnValue({ onConflictDoNothing: vi.fn().mockResolvedValue(undefined) }),
    });
    mockDbDelete.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
    mockDbSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([{ count: 3 }]) }),
    });
    mockDbQuery.pushSubscriptions.findFirst.mockResolvedValue(null);
    mockDbUpdate.mockReturnValue({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
    });
  });

  it("POST /api/push-subscriptions はサブスクリプションを保存する", async () => {
    const app = createTestApp(pushSubscriptionRoutes, "/api/push-subscriptions");
    const res = await app.request("/api/push-subscriptions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validBody),
    });
    expect(res.status).toBe(201);
    expect(mockDbInsert).toHaveBeenCalled();
  });

  it("DELETE /api/push-subscriptions はサブスクリプションを削除する", async () => {
    const app = createTestApp(pushSubscriptionRoutes, "/api/push-subscriptions");
    const res = await app.request("/api/push-subscriptions", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: validBody.endpoint }),
    });
    expect(res.status).toBe(200);
    expect(mockDbDelete).toHaveBeenCalled();
  });

  describe("GET /api/push-subscriptions/preferences", () => {
    it("既存サブスクリプションの preferences を全 type 展開して返す", async () => {
      mockDbQuery.pushSubscriptions.findFirst.mockResolvedValue({
        id: "sub-1",
        preferences: { member_added: false },
      });

      const app = createTestApp(pushSubscriptionRoutes, "/api/push-subscriptions");
      const endpoint = encodeURIComponent("https://fcm.googleapis.com/push/1");
      const res = await app.request(`/api/push-subscriptions/preferences?endpoint=${endpoint}`);

      expect(res.status).toBe(200);
      const body = await res.json();
      // member_added explicitly set to false
      expect(body.member_added).toBe(false);
      // member_removed not set → falls back to NOTIFICATION_DEFAULTS (true)
      expect(body.member_removed).toBe(true);
      // All 15 types present (includes candidate_created/deleted/reaction + discord_webhook_disabled + article_shared_member_added)
      expect(Object.keys(body).length).toBe(15);
    });

    it("endpoint が存在しない場合は 404 を返す", async () => {
      mockDbQuery.pushSubscriptions.findFirst.mockResolvedValue(null);

      const app = createTestApp(pushSubscriptionRoutes, "/api/push-subscriptions");
      const endpoint = encodeURIComponent("https://unknown.example.com/push/1");
      const res = await app.request(`/api/push-subscriptions/preferences?endpoint=${endpoint}`);

      expect(res.status).toBe(404);
    });

    it("endpoint クエリパラメータがない場合は 400 を返す", async () => {
      const app = createTestApp(pushSubscriptionRoutes, "/api/push-subscriptions");
      const res = await app.request("/api/push-subscriptions/preferences");

      expect(res.status).toBe(400);
    });
  });

  describe("PUT /api/push-subscriptions/preferences", () => {
    it("サブスクリプションの preferences を更新する", async () => {
      mockDbQuery.pushSubscriptions.findFirst.mockResolvedValue({
        id: "sub-1",
        preferences: {},
      });

      const app = createTestApp(pushSubscriptionRoutes, "/api/push-subscriptions");
      const res = await app.request("/api/push-subscriptions/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint: "https://fcm.googleapis.com/push/1",
          type: "member_added",
          enabled: false,
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(mockDbUpdate).toHaveBeenCalled();
    });

    it("endpoint が存在しない場合は 404 を返す", async () => {
      mockDbQuery.pushSubscriptions.findFirst.mockResolvedValue(null);

      const app = createTestApp(pushSubscriptionRoutes, "/api/push-subscriptions");
      const res = await app.request("/api/push-subscriptions/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint: "https://unknown.example.com/push/1",
          type: "member_added",
          enabled: false,
        }),
      });

      expect(res.status).toBe(404);
    });
  });
});
