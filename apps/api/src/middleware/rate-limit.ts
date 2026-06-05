import type { Context, Next } from "hono";
import { ERROR_MSG } from "../lib/constants";
import { logger } from "../lib/logger";
import { getRedis } from "../lib/redis";

type RateLimitEntry = { count: number; resetAt: number };

// In-memory fallback for local dev / tests. In Vercel's serverless runtime
// this is per-instance and not shared, so production must set UPSTASH_*.
// Cache keyed by "window:max" prevents duplicate setIntervals.
const inMemoryCache = new Map<string, Map<string, RateLimitEntry>>();

function getInMemoryStore(window: number, max: number): Map<string, RateLimitEntry> {
  const cacheKey = `${window}:${max}`;
  let store = inMemoryCache.get(cacheKey);
  if (store) return store;

  store = new Map<string, RateLimitEntry>();
  inMemoryCache.set(cacheKey, store);

  const storeRef = store;
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of storeRef) {
      if (entry.resetAt <= now) storeRef.delete(key);
    }
  }, window * 1000).unref();

  return store;
}

function resolveIp(c: Context): string {
  // Prefer x-real-ip (Vercel sets it from the upstream edge, not spoofable by clients).
  // Fall back to the *last* entry of x-forwarded-for — the rightmost hop is the one
  // added by the trusted proxy; the leftmost is client-controlled.
  return (
    c.req.header("x-real-ip")?.trim() ||
    c.req.header("x-forwarded-for")?.split(",").at(-1)?.trim() ||
    "unknown"
  );
}

export function rateLimitByIp(opts: { window: number; max: number }) {
  return async (c: Context, next: Next) => {
    const ip = resolveIp(c);
    const redis = getRedis();

    if (redis) {
      const key = `rl:${opts.window}:${opts.max}:${ip}`;
      try {
        // SET NX EX + INCR in one pipeline so the TTL is set atomically with
        // initialization. Without `nx`, a long-running window would have its TTL
        // refreshed every request and never expire.
        const pipe = redis.pipeline();
        pipe.set(key, 0, { nx: true, ex: opts.window });
        pipe.incr(key);
        const [, count] = await pipe.exec<["OK" | null, number]>();
        if (count > opts.max) {
          return c.json({ error: ERROR_MSG.TOO_MANY_REQUESTS }, 429);
        }
        return next();
      } catch (err) {
        // Fail-open by design: if Upstash is unreachable, blocking legitimate
        // traffic because of an upstream cache outage is worse than the leak
        // window. Surface in logs so monitoring can detect prolonged outages.
        logger.error({ err, ip }, "rate-limit redis error; falling open");
        return next();
      }
    }

    const store = getInMemoryStore(opts.window, opts.max);
    const now = Date.now();
    const entry = store.get(ip);

    if (!entry || entry.resetAt <= now) {
      store.set(ip, { count: 1, resetAt: now + opts.window * 1000 });
      return next();
    }

    entry.count++;
    if (entry.count > opts.max) {
      return c.json({ error: ERROR_MSG.TOO_MANY_REQUESTS }, 429);
    }
    return next();
  };
}
