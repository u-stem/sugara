import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetSession, mockDbQuery, mockDbUpdate, mockFindPollAsOwner } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockDbQuery: {
    schedulePolls: {
      findFirst: vi.fn(),
    },
  },
  mockDbUpdate: vi.fn(),
  mockFindPollAsOwner: vi.fn(),
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
    update: (...args: unknown[]) => mockDbUpdate(...args),
  },
}));

vi.mock("../lib/poll-access", () => ({
  findPollAsOwner: (...args: unknown[]) => mockFindPollAsOwner(...args),
}));

import { pollShareRoutes } from "../routes/poll-share";
import { pollRoutes } from "../routes/polls";
import { createTestApp, TEST_USER } from "./test-helpers";

const fakeUser = TEST_USER;

describe("Poll share routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue({
      user: fakeUser,
      session: { id: "session-1" },
    });
  });

  describe("POST /api/polls/:pollId/share", () => {
    it("returns existing token when not expired", async () => {
      const expiresAt = new Date("2030-01-01T00:00:00.000Z");
      mockFindPollAsOwner.mockResolvedValue({
        id: "poll-1",
        ownerId: fakeUser.id,
        shareToken: "existing-token",
        shareTokenExpiresAt: expiresAt,
      });

      const app = createTestApp(pollRoutes, "/api/polls");
      const res = await app.request("/api/polls/poll-1/share", { method: "POST" });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.shareToken).toBe("existing-token");
      expect(body.shareTokenExpiresAt).toBe(expiresAt.toISOString());
    });

    it("generates new token for legacy token without expiry", async () => {
      const newExpiresAt = new Date("2030-02-01T00:00:00.000Z");
      mockFindPollAsOwner.mockResolvedValue({
        id: "poll-1",
        ownerId: fakeUser.id,
        shareToken: "legacy-token",
        shareTokenExpiresAt: null,
      });

      mockDbUpdate.mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi
              .fn()
              .mockResolvedValue([{ shareToken: "new-token", shareTokenExpiresAt: newExpiresAt }]),
          }),
        }),
      });

      const app = createTestApp(pollRoutes, "/api/polls");
      const res = await app.request("/api/polls/poll-1/share", { method: "POST" });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.shareToken).toBe("new-token");
      expect(body.shareTokenExpiresAt).toBe(newExpiresAt.toISOString());
    });

    it("generates new token when expired", async () => {
      const newExpiresAt = new Date("2030-02-01T00:00:00.000Z");
      mockFindPollAsOwner.mockResolvedValue({
        id: "poll-1",
        ownerId: fakeUser.id,
        shareToken: "old-token",
        shareTokenExpiresAt: new Date("2020-01-01"),
      });

      mockDbUpdate.mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi
              .fn()
              .mockResolvedValue([{ shareToken: "new-token", shareTokenExpiresAt: newExpiresAt }]),
          }),
        }),
      });

      const app = createTestApp(pollRoutes, "/api/polls");
      const res = await app.request("/api/polls/poll-1/share", { method: "POST" });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.shareToken).toBe("new-token");
      expect(body.shareTokenExpiresAt).toBe(newExpiresAt.toISOString());
    });

    it("generates new token when none exists", async () => {
      const expiresAt = new Date("2030-01-01T00:00:00.000Z");
      mockFindPollAsOwner.mockResolvedValue({
        id: "poll-1",
        ownerId: fakeUser.id,
        shareToken: null,
        shareTokenExpiresAt: null,
      });

      mockDbUpdate.mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi
              .fn()
              .mockResolvedValue([
                { shareToken: "generated-token", shareTokenExpiresAt: expiresAt },
              ]),
          }),
        }),
      });

      const app = createTestApp(pollRoutes, "/api/polls");
      const res = await app.request("/api/polls/poll-1/share", { method: "POST" });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.shareToken).toBe("generated-token");
      expect(body.shareTokenExpiresAt).toBe(expiresAt.toISOString());
    });

    it("returns 404 when not owner", async () => {
      mockFindPollAsOwner.mockResolvedValue(null);

      const app = createTestApp(pollRoutes, "/api/polls");
      const res = await app.request("/api/polls/poll-1/share", { method: "POST" });

      expect(res.status).toBe(404);
    });
  });

  describe("PUT /api/polls/:pollId/share", () => {
    it("regenerates share token", async () => {
      const expiresAt = new Date("2030-01-01T00:00:00.000Z");
      mockFindPollAsOwner.mockResolvedValue({
        id: "poll-1",
        ownerId: fakeUser.id,
      });

      mockDbUpdate.mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi
              .fn()
              .mockResolvedValue([
                { shareToken: "regenerated-token", shareTokenExpiresAt: expiresAt },
              ]),
          }),
        }),
      });

      const app = createTestApp(pollRoutes, "/api/polls");
      const res = await app.request("/api/polls/poll-1/share", { method: "PUT" });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.shareToken).toBe("regenerated-token");
      expect(body.shareTokenExpiresAt).toBe(expiresAt.toISOString());
    });

    it("returns 404 when not owner", async () => {
      mockFindPollAsOwner.mockResolvedValue(null);

      const app = createTestApp(pollRoutes, "/api/polls");
      const res = await app.request("/api/polls/poll-1/share", { method: "PUT" });

      expect(res.status).toBe(404);
    });
  });

  describe("GET /api/shared/polls/:token", () => {
    it("returns poll data for valid token", async () => {
      mockDbQuery.schedulePolls.findFirst.mockResolvedValue({
        id: "poll-1",
        trip: { title: "Trip Poll", destination: "Kyoto" },
        note: null,
        status: "open",
        deadline: null,
        confirmedOptionId: null,
        shareTokenExpiresAt: new Date("2030-01-01"),
        createdAt: new Date("2026-01-01"),
        updatedAt: new Date("2026-01-01"),
        options: [],
        participants: [],
      });

      const app = createTestApp(pollShareRoutes, "/");
      const res = await app.request("/api/shared/polls/valid-token");
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.title).toBe("Trip Poll");
      expect(body.shareExpiresAt).toBe(new Date("2030-01-01").toISOString());
      expect(body.ownerId).toBeUndefined();
    });

    it("returns 404 for expired token", async () => {
      mockDbQuery.schedulePolls.findFirst.mockResolvedValue({
        id: "poll-1",
        trip: { title: "Trip Poll", destination: "Kyoto" },
        note: null,
        status: "open",
        deadline: null,
        confirmedOptionId: null,
        shareTokenExpiresAt: new Date("2020-01-01"),
        createdAt: new Date("2026-01-01"),
        updatedAt: new Date("2026-01-01"),
        options: [],
        participants: [],
      });

      const app = createTestApp(pollShareRoutes, "/");
      const res = await app.request("/api/shared/polls/expired-token");

      expect(res.status).toBe(404);
    });

    it("returns 404 for a legacy token without an expiry", async () => {
      mockDbQuery.schedulePolls.findFirst.mockResolvedValue({
        id: "poll-1",
        trip: { title: "Trip Poll", destination: "Kyoto" },
        note: null,
        status: "open",
        deadline: null,
        confirmedOptionId: null,
        shareTokenExpiresAt: null,
        createdAt: new Date("2026-01-01"),
        updatedAt: new Date("2026-01-01"),
        options: [],
        participants: [],
      });

      const app = createTestApp(pollShareRoutes, "/");
      const res = await app.request("/api/shared/polls/legacy-token");

      expect(res.status).toBe(404);
    });

    it("returns 404 for invalid token", async () => {
      mockDbQuery.schedulePolls.findFirst.mockResolvedValue(undefined);

      const app = createTestApp(pollShareRoutes, "/");
      const res = await app.request("/api/shared/polls/invalid-token");

      expect(res.status).toBe(404);
    });

    it("does not require authentication", async () => {
      mockGetSession.mockResolvedValue(null);
      mockDbQuery.schedulePolls.findFirst.mockResolvedValue({
        id: "poll-1",
        trip: { title: "Trip Poll", destination: null },
        note: null,
        status: "open",
        deadline: null,
        confirmedOptionId: null,
        shareTokenExpiresAt: new Date("2099-01-01"),
        createdAt: new Date("2026-01-01"),
        updatedAt: new Date("2026-01-01"),
        options: [],
        participants: [],
      });

      const app = createTestApp(pollShareRoutes, "/");
      const res = await app.request("/api/shared/polls/valid-token");

      expect(res.status).toBe(200);
    });
  });

  describe("GET /api/shared/polls/:token rate limiting", () => {
    it("returns 429 after 30 requests from the same IP", async () => {
      mockDbQuery.schedulePolls.findFirst.mockResolvedValue({
        id: "poll-1",
        trip: { title: "Trip Poll", destination: "Kyoto" },
        note: null,
        status: "open",
        deadline: null,
        confirmedOptionId: null,
        shareTokenExpiresAt: new Date("2099-01-01"),
        options: [],
        participants: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const app = createTestApp(pollShareRoutes, "/");
      const headers = { "x-forwarded-for": "10.0.0.2" };

      for (let i = 0; i < 30; i++) {
        await app.request("/api/shared/polls/valid-token", { headers });
      }

      const res = await app.request("/api/shared/polls/valid-token", { headers });
      expect(res.status).toBe(429);
    });
  });
});
