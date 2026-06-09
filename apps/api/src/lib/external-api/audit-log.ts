import type { MiddlewareHandler } from "hono";
import { logger } from "../logger";
import type { V1Env } from "./errors";

// Emits a structured audit log entry for every v1 request. Must be the first
// middleware in v1App so it wraps the full request lifecycle.
//
// Hono's compose catches handler errors via onError at each dispatch level and
// sets context.res before returning — await next() here always resolves, never
// throws, even when requireApiKey or a route handler throws an ApiV1Error.
// This mirrors how the internal requestLogger middleware works.
//
// Authorization headers and raw tokens are NEVER logged. The fields below are
// derived only from the VerifiedApiKey object set by requireApiKey, so on 401
// (before requireApiKey sets the key) only observable transport fields are logged.
export function v1AuditLog(): MiddlewareHandler<V1Env> {
  return async (c, next) => {
    const start = Date.now();
    await next();
    const durationMs = Date.now() - start;
    const method = c.req.method;
    const path = c.req.path;
    const status = c.res.status;
    const apiKey = c.get("apiKey");

    if (apiKey !== undefined) {
      logger.info(
        {
          apiKeyId: apiKey.id,
          userId: apiKey.userId,
          scopes: apiKey.scopes,
          method,
          path,
          status,
          durationMs,
        },
        "external-api request",
      );
    } else {
      // apiKey was not set: auth failed (401) or rate-limited (429) before
      // requireApiKey ran. Log only observable transport fields to avoid any
      // chance of leaking credential material.
      logger.info({ method, path, status, durationMs }, "external-api request");
    }
  };
}
