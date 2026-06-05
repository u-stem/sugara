import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rateLimitByIp } from "../middleware/rate-limit";

vi.mock("../lib/redis", () => ({
  getRedis: vi.fn(() => null),
}));

const { getRedis } = await import("../lib/redis");

describe("rateLimitByIp middleware", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows requests within the limit", async () => {
    const app = new Hono();
    app.use("*", rateLimitByIp({ window: 60, max: 3 }));
    app.get("/test", (c) => c.json({ ok: true }));

    const res = await app.request("/test", {
      headers: { "x-forwarded-for": "1.2.3.4" },
    });

    expect(res.status).toBe(200);
  });

  it("returns 429 when exceeding the limit", async () => {
    const app = new Hono();
    app.use("*", rateLimitByIp({ window: 60, max: 2 }));
    app.get("/test", (c) => c.json({ ok: true }));

    const headers = { "x-forwarded-for": "1.2.3.4" };

    await app.request("/test", { headers });
    await app.request("/test", { headers });
    const res = await app.request("/test", { headers });

    expect(res.status).toBe(429);
  });

  it("returns error body on 429", async () => {
    const app = new Hono();
    app.use("*", rateLimitByIp({ window: 60, max: 1 }));
    app.get("/test", (c) => c.json({ ok: true }));

    const headers = { "x-forwarded-for": "1.2.3.4" };

    await app.request("/test", { headers });
    const res = await app.request("/test", { headers });
    const body = await res.json();

    expect(body).toEqual({ error: "Too many requests" });
  });

  it("resets after the window expires", async () => {
    const app = new Hono();
    app.use("*", rateLimitByIp({ window: 60, max: 1 }));
    app.get("/test", (c) => c.json({ ok: true }));

    const headers = { "x-forwarded-for": "1.2.3.4" };

    await app.request("/test", { headers });
    const blocked = await app.request("/test", { headers });
    expect(blocked.status).toBe(429);

    vi.advanceTimersByTime(60_000);

    const res = await app.request("/test", { headers });
    expect(res.status).toBe(200);
  });

  it("tracks IPs independently", async () => {
    const app = new Hono();
    app.use("*", rateLimitByIp({ window: 60, max: 1 }));
    app.get("/test", (c) => c.json({ ok: true }));

    await app.request("/test", {
      headers: { "x-forwarded-for": "1.1.1.1" },
    });
    const res = await app.request("/test", {
      headers: { "x-forwarded-for": "2.2.2.2" },
    });

    expect(res.status).toBe(200);
  });

  it("prefers x-real-ip over x-forwarded-for to prevent spoofing", async () => {
    const app = new Hono();
    app.use("*", rateLimitByIp({ window: 60, max: 1 }));
    app.get("/test", (c) => c.json({ ok: true }));

    await app.request("/test", {
      headers: { "x-real-ip": "9.9.9.9", "x-forwarded-for": "1.1.1.1" },
    });
    // Client tries to evade by spoofing x-forwarded-for to a fresh value, but x-real-ip is still 9.9.9.9
    const res = await app.request("/test", {
      headers: { "x-real-ip": "9.9.9.9", "x-forwarded-for": "2.2.2.2" },
    });

    expect(res.status).toBe(429);
  });

  it("uses the last entry of x-forwarded-for (trusted proxy hop)", async () => {
    const app = new Hono();
    app.use("*", rateLimitByIp({ window: 60, max: 1 }));
    app.get("/test", (c) => c.json({ ok: true }));

    // Attacker controls the leftmost value; the trusted proxy appends the real client IP on the right.
    await app.request("/test", {
      headers: { "x-forwarded-for": "evil-spoof, 7.7.7.7" },
    });
    const res = await app.request("/test", {
      headers: { "x-forwarded-for": "different-spoof, 7.7.7.7" },
    });

    expect(res.status).toBe(429);
  });
});

describe("rateLimitByIp middleware (Upstash Redis path)", () => {
  type MockPipeline = {
    set: ReturnType<typeof vi.fn>;
    incr: ReturnType<typeof vi.fn>;
    exec: ReturnType<typeof vi.fn>;
  };
  type MockRedis = { pipeline: () => MockPipeline };
  let pipeline: MockPipeline;

  beforeEach(() => {
    pipeline = {
      set: vi.fn(),
      incr: vi.fn(),
      exec: vi.fn(),
    };
    const redis: MockRedis = { pipeline: () => pipeline };
    vi.mocked(getRedis).mockReturnValue(redis as never);
  });

  afterEach(() => {
    vi.mocked(getRedis).mockReturnValue(null);
  });

  it("uses SET NX EX + INCR in one pipeline so TTL is set atomically", async () => {
    pipeline.exec.mockResolvedValue(["OK", 1]);
    const app = new Hono();
    app.use("*", rateLimitByIp({ window: 60, max: 3 }));
    app.get("/test", (c) => c.json({ ok: true }));

    const res = await app.request("/test", {
      headers: { "x-forwarded-for": "1.2.3.4" },
    });

    expect(res.status).toBe(200);
    expect(pipeline.set).toHaveBeenCalledWith("rl:60:3:1.2.3.4", 0, { nx: true, ex: 60 });
    expect(pipeline.incr).toHaveBeenCalledWith("rl:60:3:1.2.3.4");
    expect(pipeline.exec).toHaveBeenCalledTimes(1);
  });

  it("returns 429 when INCR exceeds the max", async () => {
    pipeline.exec.mockResolvedValue([null, 4]);
    const app = new Hono();
    app.use("*", rateLimitByIp({ window: 60, max: 3 }));
    app.get("/test", (c) => c.json({ ok: true }));

    const res = await app.request("/test", {
      headers: { "x-forwarded-for": "1.2.3.4" },
    });

    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "Too many requests" });
  });

  it("does not refresh TTL on subsequent requests (SET NX is a no-op)", async () => {
    // First request: key created, TTL set (SET NX returns "OK")
    pipeline.exec.mockResolvedValueOnce(["OK", 1]);
    // Second request: key exists, SET NX returns null (no-op), INCR still works
    pipeline.exec.mockResolvedValueOnce([null, 2]);
    const app = new Hono();
    app.use("*", rateLimitByIp({ window: 60, max: 3 }));
    app.get("/test", (c) => c.json({ ok: true }));

    await app.request("/test", { headers: { "x-forwarded-for": "1.2.3.4" } });
    const res = await app.request("/test", { headers: { "x-forwarded-for": "1.2.3.4" } });

    expect(res.status).toBe(200);
    // SET should be called both times, but the second is a no-op at Redis level
    expect(pipeline.set).toHaveBeenCalledTimes(2);
  });

  it("fails open when the pipeline rejects (Redis unreachable)", async () => {
    pipeline.exec.mockRejectedValue(new Error("ECONNREFUSED"));
    const app = new Hono();
    app.use("*", rateLimitByIp({ window: 60, max: 3 }));
    app.get("/test", (c) => c.json({ ok: true }));

    const res = await app.request("/test", {
      headers: { "x-forwarded-for": "1.2.3.4" },
    });

    expect(res.status).toBe(200);
  });
});
