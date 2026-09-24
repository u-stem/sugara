import { get } from "@vercel/global-config";
import { Hono } from "hono";
import { logger } from "../lib/logger";
import type { AppEnv } from "../types";

const announcementRoutes = new Hono<AppEnv>();

announcementRoutes.get("/api/announcement", async (c) => {
  // Vercel does not auto-migrate an existing project's EDGE_CONFIG env var to
  // GLOBAL_CONFIG, and the SDK itself reads GLOBAL_CONFIG first, falling back
  // to EDGE_CONFIG. Mirroring that order keeps announcements working across
  // deploys both before and after the env var is switched.
  if (!(process.env.GLOBAL_CONFIG ?? process.env.EDGE_CONFIG)) {
    return c.json({ message: null });
  }
  try {
    const value = await get<string>("announcement");
    return c.json({ message: value || null });
  } catch (err) {
    logger.error({ err }, "Global Config fetch failed");
    return c.json({ message: null });
  }
});

export { announcementRoutes };
