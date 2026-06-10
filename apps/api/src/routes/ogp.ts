import { ogpRequestSchema } from "@sugara/shared";
import { Hono } from "hono";
import { fetchOgpTitle } from "../lib/ogp";
import { requireAuth } from "../middleware/auth";
import type { AppEnv } from "../types";

const ogpRoutes = new Hono<AppEnv>();

// requireAuth is attached per-route, NOT via use("*"): this router is mounted
// under the broad "/api" prefix, so a wildcard middleware here would also run
// for every /api/* sibling registered later — including /api/v1, whose Bearer
// auth must never be preempted by the cookie-session requireAuth.
ogpRoutes.get("/ogp", requireAuth, async (c) => {
  const url = c.req.query("url") ?? "";
  const parsed = ogpRequestSchema.safeParse({ url });
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  const title = await fetchOgpTitle(parsed.data.url);
  return c.json({ title });
});

export { ogpRoutes };
