import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetSession, mockDbQuery, mockDbInsert, mockValidateWebhookUrl } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockDbQuery: {
    discordWebhooks: { findFirst: vi.fn() },
    tripMembers: { findFirst: vi.fn() },
  },
  mockDbInsert: vi.fn(),
  mockValidateWebhookUrl: vi.fn(),
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
    insert: (...args: unknown[]) => mockDbInsert(...args),
  },
}));

vi.mock("../lib/discord", () => ({
  validateWebhookUrl: (...args: unknown[]) => mockValidateWebhookUrl(...args),
  sendDiscordWebhook: vi.fn(),
}));

import { discordWebhookRoutes } from "../routes/discord-webhook";
import { createTestApp, TEST_USER } from "./test-helpers";

const fakeUser = TEST_USER;
const tripId = "trip-1";
const basePath = `/api/trips/${tripId}/discord-webhook`;

const validBody = {
  webhookUrl: "https://discord.com/api/webhooks/123456/abcdef",
  enabledTypes: ["member_added"],
};

describe("Discord webhook routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue({
      user: fakeUser,
      session: { id: "session-1" },
    });
    mockDbQuery.tripMembers.findFirst.mockResolvedValue({
      tripId,
      userId: fakeUser.id,
      role: "owner",
    });
  });

  describe(`POST ${basePath}`, () => {
    it("creates a webhook when none exists", async () => {
      mockDbQuery.discordWebhooks.findFirst.mockResolvedValue(undefined);
      mockValidateWebhookUrl.mockResolvedValue(true);
      mockDbInsert.mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([
            {
              id: "wh-1",
              tripId,
              webhookUrl: validBody.webhookUrl,
              enabledTypes: validBody.enabledTypes,
              locale: "ja",
              isActive: true,
              createdBy: fakeUser.id,
            },
          ]),
        }),
      });

      const app = createTestApp(discordWebhookRoutes, "/api/trips");
      const res = await app.request(basePath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validBody),
      });

      expect(res.status).toBe(201);
    });

    it("returns 409 when a webhook already exists", async () => {
      mockDbQuery.discordWebhooks.findFirst.mockResolvedValue({ id: "wh-1", tripId });

      const app = createTestApp(discordWebhookRoutes, "/api/trips");
      const res = await app.request(basePath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validBody),
      });

      expect(res.status).toBe(409);
    });

    // A concurrent create can slip past the findFirst pre-check and hit the
    // tripId unique constraint; the resulting 23505 must map to 409, not 500.
    it("returns 409 when a concurrent insert violates the unique constraint", async () => {
      mockDbQuery.discordWebhooks.findFirst.mockResolvedValue(undefined);
      mockValidateWebhookUrl.mockResolvedValue(true);
      mockDbInsert.mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi
            .fn()
            .mockRejectedValue(Object.assign(new Error("duplicate key"), { code: "23505" })),
        }),
      });

      const app = createTestApp(discordWebhookRoutes, "/api/trips");
      const res = await app.request(basePath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validBody),
      });

      expect(res.status).toBe(409);
    });
  });
});
