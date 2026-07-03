import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestApp, TEST_USER } from "./test-helpers";

const { mockGetSession, mockDbQuery, mockDbInsert, mockDbUpdate, mockDbDelete, mockDbTransaction } =
  vi.hoisted(() => ({
    mockGetSession: vi.fn(),
    mockDbQuery: {
      quickPolls: {
        findMany: vi.fn(),
        findFirst: vi.fn(),
      },
      quickPollOptions: {
        findMany: vi.fn(),
      },
      quickPollVotes: {
        findMany: vi.fn(),
      },
    },
    mockDbInsert: vi.fn(),
    mockDbUpdate: vi.fn(),
    mockDbDelete: vi.fn(),
    mockDbTransaction: vi.fn(),
  }));

vi.mock("../lib/auth", () => ({
  auth: {
    api: {
      getSession: (...args: unknown[]) => mockGetSession(...args),
    },
  },
}));

vi.mock("../db/index", () => {
  const tx = {
    query: mockDbQuery,
    insert: (...args: unknown[]) => mockDbInsert(...args),
    update: (...args: unknown[]) => mockDbUpdate(...args),
    delete: (...args: unknown[]) => mockDbDelete(...args),
  };
  mockDbTransaction.mockImplementation((fn: (t: typeof tx) => unknown) => fn(tx));
  return {
    db: { ...tx, transaction: (...args: unknown[]) => mockDbTransaction(...args) },
  };
});

import { Hono } from "hono";
import { quickPollShareRoutes } from "../routes/quick-poll-share";
import { quickPollRoutes } from "../routes/quick-polls";

const fakeUser = TEST_USER;
const app = createTestApp(quickPollRoutes, "/api/quick-polls");

const shareApp = new Hono();
shareApp.route("/", quickPollShareRoutes);

describe("Quick Poll routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue({
      user: fakeUser,
      session: { id: "session-1" },
    });
  });

  describe("POST /api/quick-polls", () => {
    it("should create a poll with options", async () => {
      mockDbQuery.quickPolls.findMany.mockResolvedValue([]);
      const mockReturning = vi.fn().mockResolvedValue([{ id: "poll-1", shareToken: "abc123" }]);
      const mockValues = vi.fn().mockReturnValue({ returning: mockReturning });
      mockDbInsert.mockReturnValue({ values: mockValues });

      const res = await app.request("/api/quick-polls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: "Sushi or Ramen?",
          options: [{ label: "Sushi" }, { label: "Ramen" }],
        }),
      });

      expect(res.status).toBe(201);
    });

    // poll + options must be one atomic unit — a failed options insert must
    // not leave behind an orphaned poll with zero options.
    it("should create poll and options within a single transaction", async () => {
      mockDbQuery.quickPolls.findMany.mockResolvedValue([]);
      const mockReturning = vi.fn().mockResolvedValue([{ id: "poll-1", shareToken: "abc123" }]);
      const mockValues = vi.fn().mockReturnValue({ returning: mockReturning });
      mockDbInsert.mockReturnValue({ values: mockValues });

      await app.request("/api/quick-polls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: "Sushi or Ramen?",
          options: [{ label: "Sushi" }, { label: "Ramen" }],
        }),
      });

      expect(mockDbTransaction).toHaveBeenCalledTimes(1);
    });

    it("should reject with less than 2 options", async () => {
      const res = await app.request("/api/quick-polls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: "Only one?",
          options: [{ label: "Solo" }],
        }),
      });

      expect(res.status).toBe(400);
    });

    it("should return 401 without auth", async () => {
      mockGetSession.mockResolvedValue(null);

      const res = await app.request("/api/quick-polls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: "Q?",
          options: [{ label: "A" }, { label: "B" }],
        }),
      });

      expect(res.status).toBe(401);
    });
  });

  describe("GET /api/quick-polls", () => {
    it("should return user's polls", async () => {
      mockDbQuery.quickPolls.findMany.mockResolvedValue([
        {
          id: "poll-1",
          question: "A or B?",
          status: "open",
          shareToken: "abc",
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + 86400000),
          options: [{ id: "o1", label: "A", sortOrder: 0 }],
          votes: [],
        },
      ]);

      const res = await app.request("/api/quick-polls");

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveLength(1);
    });
  });

  describe("PATCH /api/quick-polls/:id", () => {
    it("should close a poll", async () => {
      mockDbQuery.quickPolls.findFirst.mockResolvedValue({
        id: "poll-1",
        creatorId: fakeUser.id,
        status: "open",
      });
      const mockReturning = vi.fn().mockResolvedValue([{ id: "poll-1" }]);
      const mockWhere = vi.fn().mockReturnValue({ returning: mockReturning });
      const mockSet = vi.fn().mockReturnValue({ where: mockWhere });
      mockDbUpdate.mockReturnValue({ set: mockSet });

      const res = await app.request("/api/quick-polls/poll-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "closed" }),
      });

      expect(res.status).toBe(200);
    });

    it("should reject non-creator", async () => {
      mockDbQuery.quickPolls.findFirst.mockResolvedValue(null);

      const res = await app.request("/api/quick-polls/poll-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "closed" }),
      });

      expect(res.status).toBe(404);
    });
  });

  describe("DELETE /api/quick-polls/:id", () => {
    it("should delete creator's poll", async () => {
      mockDbQuery.quickPolls.findFirst.mockResolvedValue({
        id: "poll-1",
        creatorId: fakeUser.id,
      });
      const mockWhere = vi.fn().mockResolvedValue(undefined);
      mockDbDelete.mockReturnValue({ where: mockWhere });

      const res = await app.request("/api/quick-polls/poll-1", {
        method: "DELETE",
      });

      expect(res.status).toBe(204);
    });
  });
});

describe("Quick Poll Share routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /api/shared/quick-polls/:shareToken", () => {
    it("should return poll by share token", async () => {
      const now = new Date();
      mockDbQuery.quickPolls.findFirst.mockResolvedValue({
        id: "poll-1",
        creatorId: "user-1",
        question: "A or B?",
        allowMultiple: false,
        showResultsBeforeVote: true,
        status: "open",
        expiresAt: new Date(Date.now() + 86400000),
        createdAt: now,
        options: [
          { id: "o1", label: "A", sortOrder: 0 },
          { id: "o2", label: "B", sortOrder: 1 },
        ],
        votes: [],
      });

      const res = await shareApp.request("/api/shared/quick-polls/abc123");

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.question).toBe("A or B?");
      expect(body.options).toHaveLength(2);
    });

    it("should return 404 for expired poll", async () => {
      mockDbQuery.quickPolls.findFirst.mockResolvedValue({
        id: "poll-1",
        status: "open",
        expiresAt: new Date(Date.now() - 1000),
        options: [],
        votes: [],
      });

      const res = await shareApp.request("/api/shared/quick-polls/expired");

      expect(res.status).toBe(404);
    });

    it("should return 404 for non-existent token", async () => {
      mockDbQuery.quickPolls.findFirst.mockResolvedValue(null);

      const res = await shareApp.request("/api/shared/quick-polls/nonexistent");

      expect(res.status).toBe(404);
    });
  });

  describe("POST /api/shared/quick-polls/:shareToken/vote", () => {
    const OPT_ID_1 = "11111111-1111-4111-8111-111111111111";
    const OPT_ID_2 = "22222222-2222-4222-8222-222222222222";
    const ANON_ID = "00000000-0000-4000-8000-000000000001";

    it("should accept a vote from anonymous user", async () => {
      mockDbQuery.quickPolls.findFirst.mockResolvedValue({
        id: "poll-1",
        status: "open",
        allowMultiple: false,
        expiresAt: new Date(Date.now() + 86400000),
        options: [{ id: OPT_ID_1 }, { id: OPT_ID_2 }],
      });
      const mockWhere = vi.fn().mockResolvedValue(undefined);
      mockDbDelete.mockReturnValue({ where: mockWhere });
      const mockReturning = vi.fn().mockResolvedValue([{ id: "vote-1" }]);
      const mockValues = vi.fn().mockReturnValue({ returning: mockReturning });
      mockDbInsert.mockReturnValue({ values: mockValues });

      const res = await shareApp.request("/api/shared/quick-polls/abc123/vote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          optionIds: [OPT_ID_1],
          anonymousId: ANON_ID,
        }),
      });

      expect(res.status).toBe(200);
    });

    it("should reject vote on closed poll", async () => {
      mockDbQuery.quickPolls.findFirst.mockResolvedValue({
        id: "poll-1",
        status: "closed",
        allowMultiple: false,
        expiresAt: new Date(Date.now() + 86400000),
        options: [{ id: OPT_ID_1 }],
      });

      const res = await shareApp.request("/api/shared/quick-polls/abc123/vote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          optionIds: [OPT_ID_1],
          anonymousId: ANON_ID,
        }),
      });

      expect(res.status).toBe(400);
    });

    it("should reject multiple options when allowMultiple is false", async () => {
      mockDbQuery.quickPolls.findFirst.mockResolvedValue({
        id: "poll-1",
        status: "open",
        allowMultiple: false,
        expiresAt: new Date(Date.now() + 86400000),
        options: [{ id: OPT_ID_1 }, { id: OPT_ID_2 }],
      });

      const res = await shareApp.request("/api/shared/quick-polls/abc123/vote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          optionIds: [OPT_ID_1, OPT_ID_2],
          anonymousId: ANON_ID,
        }),
      });

      expect(res.status).toBe(400);
    });
  });
});
