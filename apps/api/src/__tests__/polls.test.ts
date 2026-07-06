import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetSession,
  mockDbSelect,
  mockDbInsert,
  mockDbUpdate,
  mockFindPollAsOwner,
  mockDbQuery,
  mockCreateNotification,
  mockNotifyArticleOwnersOnMemberAdded,
  mockLoggerError,
} = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockDbSelect: vi.fn(),
  mockDbInsert: vi.fn(),
  mockDbUpdate: vi.fn(),
  mockFindPollAsOwner: vi.fn(),
  mockDbQuery: {
    users: { findFirst: vi.fn(), findMany: vi.fn() },
    trips: { findFirst: vi.fn() },
    tripMembers: { findFirst: vi.fn(), findMany: vi.fn() },
    schedulePollParticipants: { findFirst: vi.fn(), findMany: vi.fn() },
    schedulePolls: { findFirst: vi.fn() },
    schedulePollOptions: { findFirst: vi.fn() },
  },
  mockCreateNotification: vi.fn(),
  mockNotifyArticleOwnersOnMemberAdded: vi.fn(),
  mockLoggerError: vi.fn(),
}));

vi.mock("../lib/logger", () => ({
  logger: {
    error: (...args: unknown[]) => mockLoggerError(...args),
    info: vi.fn(),
    warn: vi.fn(),
  },
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
    select: (...args: unknown[]) => mockDbSelect(...args),
    insert: (...args: unknown[]) => mockDbInsert(...args),
    update: (...args: unknown[]) => mockDbUpdate(...args),
    // No-op advisory-lock executor. polls.ts derives sort order via tx, so the
    // tx proxy below is what actually runs it; kept here defensively.
    execute: async () => undefined,
    // transaction delegates to the callback with a tx proxy so tests can
    // control every query/mutation inside the transaction boundary.
    transaction: (fn: (t: unknown) => unknown) =>
      fn({
        query: mockDbQuery,
        insert: (...args: unknown[]) => mockDbInsert(...args),
        update: (...args: unknown[]) => mockDbUpdate(...args),
        select: (...args: unknown[]) => mockDbSelect(...args),
        execute: async () => undefined,
      }),
  },
}));

vi.mock("../lib/notifications", () => ({
  createNotification: (...args: unknown[]) => mockCreateNotification(...args),
  notifyArticleOwnersOnMemberAdded: (...args: unknown[]) =>
    mockNotifyArticleOwnersOnMemberAdded(...args),
}));

vi.mock("../lib/poll-access", () => ({
  findPollAsOwner: (...args: unknown[]) => mockFindPollAsOwner(...args),
}));

vi.mock("../lib/activity-logger", () => ({
  logActivity: vi.fn().mockResolvedValue(undefined),
  formatShortDateRange: vi.fn().mockReturnValue("2/5〜2/7"),
}));

vi.mock("../lib/trip-days", () => ({
  createInitialTripDays: vi.fn().mockResolvedValue(undefined),
}));

import { ERROR_MSG } from "../lib/constants";
import { pollRoutes } from "../routes/polls";
import { createTestApp, TEST_USER } from "./test-helpers";

const fakeUser = TEST_USER;

describe("Poll routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue({
      user: fakeUser,
      session: { id: "session-1" },
    });
    mockDbQuery.trips.findFirst.mockResolvedValue({ title: "テスト旅行" });
    mockCreateNotification.mockResolvedValue(undefined);
    mockNotifyArticleOwnersOnMemberAdded.mockResolvedValue(undefined);
  });

  describe("POST /api/polls/:pollId/options", () => {
    it("returns 409 when option with same dates already exists", async () => {
      mockFindPollAsOwner.mockResolvedValue({
        id: "poll-1",
        status: "open",
        tripId: "trip-1",
        trip: { ownerId: fakeUser.id },
      });

      // First select: option count
      mockDbSelect.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ count: 2 }]),
        }),
      });
      // Second select: duplicate check
      mockDbSelect.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ id: "existing-opt" }]),
        }),
      });

      const app = createTestApp(pollRoutes, "/api/polls");
      const res = await app.request("/api/polls/poll-1/options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startDate: "2026-02-05",
          endDate: "2026-02-07",
        }),
      });

      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error).toBe(ERROR_MSG.POLL_OPTION_DUPLICATE);
    });

    it("returns 201 when dates are unique", async () => {
      mockFindPollAsOwner.mockResolvedValue({
        id: "poll-1",
        status: "open",
        tripId: "trip-1",
        trip: { ownerId: fakeUser.id },
      });

      // First select: option count
      mockDbSelect.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ count: 1 }]),
        }),
      });
      // Second select: duplicate check - no match
      mockDbSelect.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      });
      // Third select: COALESCE(MAX(sortOrder), -1) for gap-safe numbering (#143)
      mockDbSelect.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ max: 1 }]),
        }),
      });

      const insertValues = vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([
          {
            id: "new-opt",
            pollId: "poll-1",
            startDate: "2026-02-05",
            endDate: "2026-02-07",
            sortOrder: 2,
          },
        ]),
      });
      mockDbInsert.mockReturnValue({ values: insertValues });

      mockDbUpdate.mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined),
        }),
      });

      const app = createTestApp(pollRoutes, "/api/polls");
      const res = await app.request("/api/polls/poll-1/options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startDate: "2026-02-05",
          endDate: "2026-02-07",
        }),
      });

      expect(res.status).toBe(201);
      // MAX(sortOrder)=1 → next option gets 2 (gap-safe MAX+1, not COUNT)
      expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({ sortOrder: 2 }));
    });
  });

  describe("POST /api/polls/:pollId/participants", () => {
    it("sends poll_started notification when participant is added", async () => {
      mockFindPollAsOwner.mockResolvedValue({
        id: "poll-1",
        status: "open",
        tripId: "trip-1",
        trip: { ownerId: fakeUser.id },
      });
      mockDbSelect.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ count: 0 }]),
        }),
      });
      mockDbQuery.users.findFirst.mockResolvedValue({
        id: "00000000-0000-0000-0000-000000000002",
        name: "New Participant",
        image: null,
      });
      mockDbQuery.tripMembers.findFirst.mockResolvedValue({
        tripId: "trip-1",
        userId: "00000000-0000-0000-0000-000000000002",
        role: "editor",
      });
      mockDbQuery.schedulePollParticipants.findFirst.mockResolvedValue(undefined);
      mockDbInsert.mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi
            .fn()
            .mockResolvedValue([
              { id: "part-1", pollId: "poll-1", userId: "00000000-0000-0000-0000-000000000002" },
            ]),
        }),
      });
      mockDbUpdate.mockReturnValue({
        set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
      });

      const app = createTestApp(pollRoutes, "/api/polls");
      const res = await app.request("/api/polls/poll-1/participants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: "00000000-0000-0000-0000-000000000002" }),
      });

      expect(res.status).toBe(201);
      expect(mockCreateNotification).toHaveBeenCalledWith(
        expect.objectContaining({ type: "poll_started" }),
      );
    });

    // The poll_started notification is fire-and-forget; a failing trip lookup
    // (e.g. connection killed after the response on serverless) must be caught
    // instead of surfacing as an unhandled rejection (Sentry noise).
    it("does not leave an unhandled rejection when the trip lookup fails", async () => {
      mockFindPollAsOwner.mockResolvedValue({
        id: "poll-1",
        status: "open",
        tripId: "trip-1",
        trip: { ownerId: fakeUser.id },
      });
      mockDbSelect.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ count: 0 }]),
        }),
      });
      mockDbQuery.users.findFirst.mockResolvedValue({
        id: "00000000-0000-0000-0000-000000000002",
        name: "New Participant",
        image: null,
      });
      mockDbQuery.tripMembers.findFirst.mockResolvedValue({
        tripId: "trip-1",
        userId: "00000000-0000-0000-0000-000000000002",
        role: "editor",
      });
      mockDbQuery.schedulePollParticipants.findFirst.mockResolvedValue(undefined);
      mockDbInsert.mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi
            .fn()
            .mockResolvedValue([
              { id: "part-1", pollId: "poll-1", userId: "00000000-0000-0000-0000-000000000002" },
            ]),
        }),
      });
      mockDbUpdate.mockReturnValue({
        set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
      });
      mockDbQuery.trips.findFirst.mockRejectedValue(new Error("Failed query"));

      const rejections: unknown[] = [];
      const onRejection = (reason: unknown) => {
        rejections.push(reason);
      };
      process.on("unhandledRejection", onRejection);
      try {
        const app = createTestApp(pollRoutes, "/api/polls");
        await app.request("/api/polls/poll-1/participants", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: "00000000-0000-0000-0000-000000000002" }),
        });
        // Unhandled rejections are emitted after the microtask queue drains.
        await new Promise((resolve) => setImmediate(resolve));
      } finally {
        process.off("unhandledRejection", onRejection);
      }

      expect(rejections).toEqual([]);
    });

    // The .catch must record the failure via logger.error, not swallow it
    // silently — mirrors the coverage notifications.test.ts has for notifyUsers.
    it("logs the error when the trip lookup for the notification fails", async () => {
      mockFindPollAsOwner.mockResolvedValue({
        id: "poll-1",
        status: "open",
        tripId: "trip-1",
        trip: { ownerId: fakeUser.id },
      });
      mockDbSelect.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ count: 0 }]),
        }),
      });
      mockDbQuery.users.findFirst.mockResolvedValue({
        id: "00000000-0000-0000-0000-000000000002",
        name: "New Participant",
        image: null,
      });
      mockDbQuery.tripMembers.findFirst.mockResolvedValue({
        tripId: "trip-1",
        userId: "00000000-0000-0000-0000-000000000002",
        role: "editor",
      });
      mockDbQuery.schedulePollParticipants.findFirst.mockResolvedValue(undefined);
      mockDbInsert.mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi
            .fn()
            .mockResolvedValue([
              { id: "part-1", pollId: "poll-1", userId: "00000000-0000-0000-0000-000000000002" },
            ]),
        }),
      });
      mockDbUpdate.mockReturnValue({
        set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
      });
      mockDbQuery.trips.findFirst.mockRejectedValue(new Error("Failed query"));

      const app = createTestApp(pollRoutes, "/api/polls");
      await app.request("/api/polls/poll-1/participants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: "00000000-0000-0000-0000-000000000002" }),
      });
      await new Promise((resolve) => setImmediate(resolve));

      expect(mockLoggerError).toHaveBeenCalledWith(
        expect.objectContaining({ tripId: "trip-1" }),
        "Failed to dispatch poll notification",
      );
    });

    // A concurrent duplicate add can slip past the findFirst pre-check and hit
    // the DB unique index; the resulting 23505 must map to 409, not 500.
    it("returns 409 when a concurrent insert violates the unique constraint", async () => {
      mockFindPollAsOwner.mockResolvedValue({
        id: "poll-1",
        status: "open",
        tripId: "trip-1",
        trip: { ownerId: fakeUser.id },
      });
      mockDbSelect.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ count: 0 }]),
        }),
      });
      mockDbQuery.users.findFirst.mockResolvedValue({
        id: "00000000-0000-0000-0000-000000000002",
        name: "New Participant",
        image: null,
      });
      mockDbQuery.tripMembers.findFirst.mockResolvedValue({
        tripId: "trip-1",
        userId: "00000000-0000-0000-0000-000000000002",
        role: "editor",
      });
      mockDbQuery.schedulePollParticipants.findFirst.mockResolvedValue(undefined);
      mockDbInsert.mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi
            .fn()
            .mockRejectedValue(Object.assign(new Error("duplicate key"), { code: "23505" })),
        }),
      });

      const app = createTestApp(pollRoutes, "/api/polls");
      const res = await app.request("/api/polls/poll-1/participants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: "00000000-0000-0000-0000-000000000002" }),
      });

      expect(res.status).toBe(409);
    });
  });

  describe("POST /api/polls/:pollId/confirm", () => {
    const newParticipantId = "00000000-0000-0000-0000-000000000099";
    const pollId = "poll-1";
    const tripId = "trip-1";
    const optionId = "00000000-0000-0000-0000-000000000001";
    const confirmedPoll = {
      id: pollId,
      tripId,
      note: null,
      status: "confirmed",
      deadline: null,
      confirmedOptionId: optionId,
      createdAt: new Date("2026-01-01"),
      updatedAt: new Date("2026-06-07"),
    };
    const confirmedTrip = {
      ownerId: fakeUser.id,
      title: "Test Trip",
      destination: null,
    };

    it("calls notifyArticleOwnersOnMemberAdded for auto-joined poll participants", async () => {
      // Arrange
      mockFindPollAsOwner.mockResolvedValue({
        id: pollId,
        status: "open",
        tripId,
        trip: { ownerId: fakeUser.id },
      });
      // Option lookup (outside transaction)
      mockDbQuery.schedulePollOptions.findFirst.mockResolvedValue({
        id: optionId,
        startDate: "2026-02-05",
        endDate: "2026-02-07",
      });
      // Inside transaction: re-check poll status
      mockDbQuery.schedulePolls.findFirst.mockResolvedValue({ status: "open" });
      // Inside transaction: trip update (no returning)
      mockDbUpdate
        .mockReturnValueOnce({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(undefined),
          }),
        })
        // Inside transaction: schedulePolls update with returning
        .mockReturnValueOnce({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([confirmedPoll]),
            }),
          }),
        });
      // Inside transaction: participants list — includes new participant not yet in trip
      mockDbQuery.schedulePollParticipants.findMany
        .mockResolvedValueOnce([{ pollId, userId: newParticipantId }])
        // After transaction: for poll_closed notifications
        .mockResolvedValueOnce([{ userId: newParticipantId }]);
      // Inside transaction: existing trip members (only the owner)
      mockDbQuery.tripMembers.findMany.mockResolvedValue([{ userId: fakeUser.id }]);
      // After transaction: resolve auto-joined member names for the notification
      mockDbQuery.users.findMany.mockResolvedValue([{ name: "New Member" }]);
      // Inside transaction: insert new member (no returning needed)
      mockDbInsert.mockReturnValue({
        values: vi.fn().mockResolvedValue(undefined),
      });
      // After transaction: trip lookup for response
      mockDbQuery.trips.findFirst.mockResolvedValue(confirmedTrip);

      // Act
      const app = createTestApp(pollRoutes, "/api/polls");
      const res = await app.request(`/api/polls/${pollId}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ optionId }),
      });

      // Assert
      expect(res.status).toBe(200);
      expect(mockNotifyArticleOwnersOnMemberAdded).toHaveBeenCalledWith(
        expect.objectContaining({
          tripId,
          addedUserIds: [newParticipantId],
        }),
      );
    });

    it("does not call notifyArticleOwnersOnMemberAdded when no new members are auto-joined", async () => {
      // Arrange
      mockFindPollAsOwner.mockResolvedValue({
        id: pollId,
        status: "open",
        tripId,
        trip: { ownerId: fakeUser.id },
      });
      mockDbQuery.schedulePollOptions.findFirst.mockResolvedValue({
        id: optionId,
        startDate: "2026-02-05",
        endDate: "2026-02-07",
      });
      mockDbQuery.schedulePolls.findFirst.mockResolvedValue({ status: "open" });
      mockDbUpdate
        .mockReturnValueOnce({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(undefined),
          }),
        })
        .mockReturnValueOnce({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([confirmedPoll]),
            }),
          }),
        });
      // All participants are already trip members — no auto-join needed
      mockDbQuery.schedulePollParticipants.findMany
        .mockResolvedValueOnce([{ pollId, userId: fakeUser.id }])
        .mockResolvedValueOnce([{ userId: fakeUser.id }]);
      mockDbQuery.tripMembers.findMany.mockResolvedValue([{ userId: fakeUser.id }]);
      mockDbInsert.mockReturnValue({
        values: vi.fn().mockResolvedValue(undefined),
      });
      mockDbQuery.trips.findFirst.mockResolvedValue(confirmedTrip);

      // Act
      const app = createTestApp(pollRoutes, "/api/polls");
      const res = await app.request(`/api/polls/${pollId}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ optionId }),
      });

      // Assert
      expect(res.status).toBe(200);
      expect(mockNotifyArticleOwnersOnMemberAdded).not.toHaveBeenCalled();
    });
  });
});
