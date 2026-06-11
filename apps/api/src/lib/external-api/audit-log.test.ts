import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { logger } from "../logger";
import { v1AuditLog } from "./audit-log";
import type { V1Env } from "./errors";

function appWithAudit() {
  const app = new Hono<V1Env>();
  app.use("*", v1AuditLog());
  return app;
}

describe("v1AuditLog", () => {
  it("logs transport fields when no api key is set", async () => {
    const spy = vi.spyOn(logger, "info").mockImplementation(() => {});
    const app = appWithAudit();
    app.get("/x", (c) => c.text("ok"));

    await app.request("/x");

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ method: "GET", path: "/x", status: 200 }),
      "external-api request",
    );
    spy.mockRestore();
  });

  it("never includes the authorization header in the log payload", async () => {
    const spy = vi.spyOn(logger, "info").mockImplementation(() => {});
    const app = appWithAudit();
    app.get("/x", (c) => c.text("ok"));

    await app.request("/x", { headers: { Authorization: "Bearer super-secret" } });

    expect(JSON.stringify(spy.mock.calls[0]?.[0])).not.toContain("super-secret");
    spy.mockRestore();
  });

  it("includes api key id, user and scopes when set upstream", async () => {
    const spy = vi.spyOn(logger, "info").mockImplementation(() => {});
    const app = appWithAudit();
    app.use("*", async (c, next) => {
      c.set("apiKey", {
        id: "key-1",
        userId: "user-1",
        scopes: ["trips:read"],
        expiresAt: new Date(),
      });
      await next();
    });
    app.get("/x", (c) => c.text("ok"));

    await app.request("/x");

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ apiKeyId: "key-1", userId: "user-1", scopes: ["trips:read"] }),
      "external-api request",
    );
    spy.mockRestore();
  });
});
