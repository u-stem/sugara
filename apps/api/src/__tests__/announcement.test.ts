import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestApp } from "./test-helpers";

const mockGet = vi.fn();

vi.mock("@vercel/global-config", () => ({
  get: (...args: unknown[]) => mockGet(...args),
}));

import { announcementRoutes } from "../routes/announcement";

function createApp() {
  return createTestApp(announcementRoutes, "/");
}

describe("GET /api/announcement", () => {
  const app = createApp();

  beforeEach(() => {
    delete process.env.GLOBAL_CONFIG;
    delete process.env.EDGE_CONFIG;
    mockGet.mockReset();
  });

  it("returns message: null when GLOBAL_CONFIG and EDGE_CONFIG are not set", async () => {
    const res = await app.request("/api/announcement");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ message: null });
  });

  it("returns message when set in Global Config", async () => {
    process.env.GLOBAL_CONFIG = "https://global-config.vercel.com/gcfg_x?token=x";
    mockGet.mockResolvedValue("メンテナンス中です");
    const res = await app.request("/api/announcement");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ message: "メンテナンス中です" });
  });

  it("returns message when only legacy EDGE_CONFIG is set", async () => {
    process.env.EDGE_CONFIG = "https://edge-config.vercel.com/ecfg_x?token=x";
    mockGet.mockResolvedValue("メンテナンス中です");
    const res = await app.request("/api/announcement");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ message: "メンテナンス中です" });
  });

  it("returns message: null when Global Config key is empty string", async () => {
    process.env.GLOBAL_CONFIG = "https://global-config.vercel.com/gcfg_x?token=x";
    mockGet.mockResolvedValue("");
    const res = await app.request("/api/announcement");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ message: null });
  });

  it("returns message: null when Global Config key is undefined", async () => {
    process.env.GLOBAL_CONFIG = "https://global-config.vercel.com/gcfg_x?token=x";
    mockGet.mockResolvedValue(undefined);
    const res = await app.request("/api/announcement");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ message: null });
  });
});
