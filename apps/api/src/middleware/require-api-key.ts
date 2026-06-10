import type { ApiKeyScope } from "@sugara/shared";
import type { MiddlewareHandler } from "hono";
import { verifyApiKey } from "../lib/external-api/api-key";
import { ApiV1Error, type V1Env } from "../lib/external-api/errors";

// Extracts and validates the Bearer token, verifies it against the DB, and
// checks that the key holds the required scope (fail-closed: scope is mandatory).
// All invalid-key cases (missing, bad format, expired, unknown) map to the same
// 401 so response differences cannot be used to enumerate valid keys.
// scope is typed as ApiKeyScope so typos in callers are caught at compile time.
export function requireApiKey(scope: ApiKeyScope): MiddlewareHandler<V1Env> {
  return async (c, next) => {
    const authHeader = c.req.header("Authorization");
    const match = authHeader?.match(/^Bearer\s+(\S+)$/);
    if (!match) {
      throw new ApiV1Error(401, "unauthorized", "Missing or malformed Authorization header");
    }

    // match[1] is guaranteed by the regex to be a non-empty, non-whitespace token.
    const token = match[1];
    const key = await verifyApiKey(token);
    if (!key) {
      throw new ApiV1Error(401, "unauthorized", "Invalid or expired API key");
    }

    if (!key.scopes.includes(scope)) {
      throw new ApiV1Error(
        403,
        "insufficient_scope",
        `This operation requires the '${scope}' scope`,
      );
    }

    c.set("apiKey", key);
    await next();
  };
}
