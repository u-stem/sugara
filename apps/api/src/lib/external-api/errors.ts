import type { Context, ErrorHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { logger } from "../logger";
import type { VerifiedApiKey } from "./api-key";

// Hono env for v1 routes — only the api key is available, not the full AuthUser.
// apiKey is optional so that middleware earlier in the chain (audit log) can safely
// read it before requireApiKey runs; routes use getApiKey() to get a narrowed value.
export type V1Env = {
  Variables: {
    apiKey?: VerifiedApiKey;
  };
};

// Narrows the optional apiKey from context or throws 401. Route handlers call
// this instead of c.get("apiKey") directly to preserve the non-undefined invariant
// that holds after requireApiKey has run. No `as` cast is needed because the
// undefined check narrows the type at compile time.
export function getApiKey(c: Context<V1Env>): VerifiedApiKey {
  const key = c.get("apiKey");
  if (key === undefined) {
    throw new ApiV1Error(401, "unauthorized", "API key not present in context");
  }
  return key;
}

export type ApiV1ErrorCode =
  | "invalid_request"
  | "unauthorized"
  | "insufficient_scope"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "internal_error";

export class ApiV1Error extends Error {
  constructor(
    public readonly status: ContentfulStatusCode,
    public readonly code: ApiV1ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ApiV1Error";
  }
}

export function apiV1ErrorBody(code: ApiV1ErrorCode, message: string) {
  return { error: { code, message } };
}

// Isolated error handler for v1App. Must not inherit or delegate to the global
// handleError so that internal AppError messages, details, and Postgres error
// strings are never exposed to external callers.
export const v1ErrorHandler: ErrorHandler<V1Env> = (err, c) => {
  if (err instanceof ApiV1Error) {
    return c.json(apiV1ErrorBody(err.code, err.message), err.status);
  }
  // All other exceptions — DB errors, unexpected throws, etc. — are collapsed
  // to 500 internal_error with no detail leak.
  logger.error({ err }, "v1 unhandled error");
  return c.json(apiV1ErrorBody("internal_error", "An internal error occurred"), 500);
};
