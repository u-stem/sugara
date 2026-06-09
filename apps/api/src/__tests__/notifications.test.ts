import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockDbQuery, mockDbInsert, mockDbSelect, mockDbDelete, mockSendNotification } = vi.hoisted(
  () => ({
    mockDbQuery: {
      notificationPreferences: { findFirst: vi.fn() },
      pushSubscriptions: { findMany: vi.fn() },
      notifications: { findMany: vi.fn() },
      articleTrips: { findMany: vi.fn() },
      trips: { findFirst: vi.fn() },
      discordWebhooks: { findFirst: vi.fn() },
    },
    mockDbInsert: vi.fn(),
    mockDbSelect: vi.fn(),
    mockDbDelete: vi.fn(),
    mockSendNotification: vi.fn(),
  }),
);

vi.mock("../db/index", () => ({
  db: {
    query: mockDbQuery,
    insert: (...args: unknown[]) => mockDbInsert(...args),
    select: (...args: unknown[]) => mockDbSelect(...args),
    delete: (...args: unknown[]) => mockDbDelete(...args),
  },
}));

vi.mock("web-push", () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: (...args: unknown[]) => mockSendNotification(...args),
  },
}));

import { createNotification, notifyArticleOwnersOnMemberAdded } from "../lib/notifications";

const baseParams = {
  type: "member_added" as const,
  userId: "user-1",
  tripId: "trip-1",
  payload: { actorName: "田中", tripName: "京都旅行" },
};

describe("createNotification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbQuery.notificationPreferences.findFirst.mockResolvedValue(null); // no pref = default ON
    mockDbQuery.pushSubscriptions.findMany.mockResolvedValue([]);
    mockDbQuery.notifications.findMany.mockResolvedValue([]);
    mockDbInsert.mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });
    // pruneOldNotifications uses db.select().from().where() chain
    mockDbSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ count: 0 }]),
      }),
    });
    mockDbDelete.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
    mockSendNotification.mockResolvedValue({});
  });

  it("preferences が未設定の場合は in_app を DB に INSERT する", async () => {
    await createNotification(baseParams);
    expect(mockDbInsert).toHaveBeenCalled();
  });

  it("inApp が false の場合は DB INSERT しない", async () => {
    mockDbQuery.notificationPreferences.findFirst.mockResolvedValue({
      inApp: false,
    });
    await createNotification(baseParams);
    expect(mockDbInsert).not.toHaveBeenCalled();
  });

  it("push サブスクリプションがある場合は sendNotification を呼ぶ", async () => {
    mockDbQuery.pushSubscriptions.findMany.mockResolvedValue([
      { endpoint: "https://fcm.example.com/push/1", p256dh: "abc", auth: "xyz", preferences: {} },
    ]);
    await createNotification(baseParams); // member_added, default push=true
    await new Promise((r) => setTimeout(r, 10));
    expect(mockSendNotification).toHaveBeenCalled();
  });

  it("subscription の preferences[type] が false の場合は sendNotification をスキップする", async () => {
    mockDbQuery.pushSubscriptions.findMany.mockResolvedValue([
      {
        endpoint: "https://fcm.example.com/push/1",
        p256dh: "abc",
        auth: "xyz",
        preferences: { member_added: false },
      },
    ]);
    await createNotification(baseParams); // member_added
    await new Promise((r) => setTimeout(r, 10));
    expect(mockSendNotification).not.toHaveBeenCalled();
  });

  it("複数サブスクリプション: 有効なものだけ sendNotification を呼ぶ", async () => {
    mockDbQuery.pushSubscriptions.findMany.mockResolvedValue([
      {
        endpoint: "https://fcm.example.com/push/1",
        p256dh: "abc",
        auth: "xyz",
        preferences: { member_added: false },
      },
      {
        endpoint: "https://fcm.example.com/push/2",
        p256dh: "def",
        auth: "uvw",
        preferences: {},
      },
    ]);
    await createNotification(baseParams); // member_added, default push=true
    await new Promise((r) => setTimeout(r, 10));
    expect(mockSendNotification).toHaveBeenCalledTimes(1);
  });

  it("preferences が {} で NOTIFICATION_DEFAULTS.push=false の場合は sendNotification をスキップする", async () => {
    mockDbQuery.pushSubscriptions.findMany.mockResolvedValue([
      {
        endpoint: "https://fcm.example.com/push/1",
        p256dh: "abc",
        auth: "xyz",
        preferences: {},
      },
    ]);
    // schedule_created has push=false by default
    await createNotification({ ...baseParams, type: "schedule_created" });
    await new Promise((r) => setTimeout(r, 10));
    expect(mockSendNotification).not.toHaveBeenCalled();
  });

  it("410 エラーの場合は購読を削除する", async () => {
    const sub = {
      endpoint: "https://fcm.example.com/push/1",
      p256dh: "abc",
      auth: "xyz",
      preferences: {},
    };
    mockDbQuery.pushSubscriptions.findMany.mockResolvedValue([sub]);
    mockSendNotification.mockRejectedValue({ statusCode: 410 });

    const mockWhere = vi.fn().mockResolvedValue(undefined);
    mockDbDelete.mockReturnValue({ where: mockWhere });

    await createNotification({ ...baseParams, userId: "user-1" });
    await new Promise((r) => setTimeout(r, 50));

    expect(mockDbDelete).toHaveBeenCalledWith(expect.anything()); // pushSubscriptions テーブルを指定
    expect(mockWhere).toHaveBeenCalledOnce();
  });

  it("404 エラーの場合は購読を削除する", async () => {
    const sub = {
      endpoint: "https://fcm.example.com/push/2",
      p256dh: "abc",
      auth: "xyz",
      preferences: {},
    };
    mockDbQuery.pushSubscriptions.findMany.mockResolvedValue([sub]);
    mockSendNotification.mockRejectedValue({ statusCode: 404 });

    const mockWhere = vi.fn().mockResolvedValue(undefined);
    mockDbDelete.mockReturnValue({ where: mockWhere });

    await createNotification({ ...baseParams, userId: "user-1" });
    await new Promise((r) => setTimeout(r, 50));

    expect(mockDbDelete).toHaveBeenCalled();
    expect(mockWhere).toHaveBeenCalledOnce();
  });
});

describe("notifyArticleOwnersOnMemberAdded", () => {
  // notifyUsers() synchronously calls db.query.trips.findFirst once per owner it
  // notifies, so its call count == the number of owners that passed the filter.
  // This lets us assert the helper's filtering without flushing the deep async
  // createNotification chain.
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbQuery.trips.findFirst.mockResolvedValue({ title: "京都旅行" });
    mockDbQuery.discordWebhooks.findFirst.mockResolvedValue(null);
    mockDbQuery.notificationPreferences.findFirst.mockResolvedValue(null);
    mockDbQuery.pushSubscriptions.findMany.mockResolvedValue([]);
    mockDbQuery.notifications.findMany.mockResolvedValue([]);
    mockDbInsert.mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });
    mockDbSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([{ count: 0 }]) }),
    });
    mockDbDelete.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
  });

  it("非公開記事のオーナーに通知し、public 記事はスキップする", async () => {
    mockDbQuery.articleTrips.findMany.mockResolvedValue([
      { article: { id: "a1", ownerId: "owner-1", title: "tip1", visibility: "private" } },
      { article: { id: "a2", ownerId: "owner-2", title: "tip2", visibility: "public" } },
    ]);

    await notifyArticleOwnersOnMemberAdded({ tripId: "trip-1", addedUserIds: ["new-1"] });

    // Only the private article's owner is notified.
    expect(mockDbQuery.trips.findFirst).toHaveBeenCalledTimes(1);
  });

  it("追加されたユーザー自身が所有する記事には通知しない", async () => {
    mockDbQuery.articleTrips.findMany.mockResolvedValue([
      { article: { id: "a1", ownerId: "new-1", title: "tip1", visibility: "private" } },
    ]);

    await notifyArticleOwnersOnMemberAdded({ tripId: "trip-1", addedUserIds: ["new-1"] });

    expect(mockDbQuery.trips.findFirst).not.toHaveBeenCalled();
  });

  it("excludeOwnerId に一致するオーナーには通知しない(actor 自己通知の抑制)", async () => {
    mockDbQuery.articleTrips.findMany.mockResolvedValue([
      { article: { id: "a1", ownerId: "actor-1", title: "tip1", visibility: "friends_only" } },
    ]);

    await notifyArticleOwnersOnMemberAdded({
      tripId: "trip-1",
      addedUserIds: ["new-1"],
      excludeOwnerId: "actor-1",
    });

    expect(mockDbQuery.trips.findFirst).not.toHaveBeenCalled();
  });

  it("addedUserIds が空なら記事を照会しない", async () => {
    await notifyArticleOwnersOnMemberAdded({ tripId: "trip-1", addedUserIds: [] });

    expect(mockDbQuery.articleTrips.findMany).not.toHaveBeenCalled();
  });
});
