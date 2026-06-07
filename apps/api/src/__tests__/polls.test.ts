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
} = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockDbSelect: vi.fn(),
  mockDbInsert: vi.fn(),
  mockDbUpdate: vi.fn(),
  mockFindPollAsOwner: vi.fn(),
  mockDbQuery: {
    users: { findFirst: vi.fn() },
    trips: { findFirst: vi.fn() },
    tripMembers: { findFirst: vi.fn(), findMany: vi.fn() },
    schedulePollParticipants: { findFirst: vi.fn(), findMany: vi.fn() },
    schedulePolls: { findFirst: vi.fn() },
    schedulePollOptions: { findFirst: vi.fn() },
  },
  mockCreateNotification: vi.fn(),
  mockNotifyArticleOwnersOnMemberAdded: vi.fn(),
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
    // transaction delegates to the callback with a tx proxy so tests can
    // control every query/mutation inside the transaction boundary.
    transaction: (fn: (t: unknown) => unknown) =>
      fn({
        query: mockDbQuery,
        insert: (...args: unknown[]) => mockDbInsert(...args),
        update: (...args: unknown[]) => mockDbUpdate(...args),
        select: (...args: unknown[]) => mockDbSelect(...args),
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

      mockDbInsert.mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([
            {
              id: "new-opt",
              pollId: "poll-1",
              startDate: "2026-02-05",
              endDate: "2026-02-07",
              sortOrder: 1,
            },
          ]),
        }),
      });

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
