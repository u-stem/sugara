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

// Fine-grained machine-readable reason carried alongside the coarse `code`.
// The top-level `code` set is frozen for backward compatibility (consumers
// branch on it), so new distinctions are expressed as an additive `reason`
// instead of new top-level codes. Every `*_limit_reached` reason ships a
// `details: { max }` payload; `trip_has_no_days` carries no details.
export type ApiV1ErrorReason =
  | "trip_limit_reached"
  | "schedule_limit_reached"
  | "expense_limit_reached"
  | "bookmark_list_limit_reached"
  | "bookmark_limit_reached"
  | "article_limit_reached"
  | "souvenir_limit_reached"
  | "trip_has_no_days"
  | "pattern_limit_reached"
  | "cannot_delete_default_pattern";

export type ApiV1ErrorOptions = {
  reason?: ApiV1ErrorReason;
  // Serialized verbatim into the public error response by v1ErrorHandler —
  // must contain only externally safe values (no internal ids, constraint
  // names, or other infrastructure detail).
  details?: unknown;
};

export class ApiV1Error extends Error {
  readonly reason?: ApiV1ErrorReason;
  readonly details?: unknown;

  constructor(
    public readonly status: ContentfulStatusCode,
    public readonly code: ApiV1ErrorCode,
    message: string,
    options?: ApiV1ErrorOptions,
  ) {
    super(message);
    this.name = "ApiV1Error";
    this.reason = options?.reason;
    this.details = options?.details;
  }
}

export type ApiV1ErrorBody = {
  error: {
    code: ApiV1ErrorCode;
    message: string;
    reason?: ApiV1ErrorReason;
    details?: unknown;
  };
};

export function apiV1ErrorBody(
  code: ApiV1ErrorCode,
  message: string,
  options?: ApiV1ErrorOptions,
): ApiV1ErrorBody {
  const body: ApiV1ErrorBody = { error: { code, message } };
  if (options?.reason !== undefined) body.error.reason = options.reason;
  if (options?.details !== undefined) body.error.details = options.details;
  return body;
}

// Isolated error handler for v1App. Must not inherit or delegate to the global
// handleError so that internal AppError messages, details, and Postgres error
// strings are never exposed to external callers.
export const v1ErrorHandler: ErrorHandler<V1Env> = (err, c) => {
  if (err instanceof ApiV1Error) {
    return c.json(
      apiV1ErrorBody(err.code, err.message, { reason: err.reason, details: err.details }),
      err.status,
    );
  }
  // All other exceptions — DB errors, unexpected throws, etc. — are collapsed
  // to 500 internal_error with no detail leak.
  logger.error({ err }, "v1 unhandled error");
  return c.json(apiV1ErrorBody("internal_error", "An internal error occurred"), 500);
};
