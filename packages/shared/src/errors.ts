import { z } from "zod";

// ─── Error code taxonomy ──────────────────────────────────────────────────────
// HTTP-semantic classification of API errors + frontend domain codes.
// The human-readable detail stays in ERROR_MSG (messages.ts) and is carried in
// the `message` field; `code` lets the frontend branch on the *kind* of error
// without parsing message strings.

export const ERROR_CODE = {
  VALIDATION: "VALIDATION",
  UNAUTHORIZED: "UNAUTHORIZED",
  PERMISSION: "PERMISSION",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  RATE_LIMIT: "RATE_LIMIT",
  INTERNAL: "INTERNAL",
  INVALID_JSON: "INVALID_JSON",
  INVALID_ID_FORMAT: "INVALID_ID_FORMAT",
  // Domain-specific codes for limit and membership conflicts.
  // Carried in the `code` field so the frontend can show context-specific messages
  // (e.g. per-user limit value from `details.max`) without parsing message strings.
  LIMIT_TRIPS: "LIMIT_TRIPS",
  LIMIT_MEMBERS: "LIMIT_MEMBERS",
  ALREADY_MEMBER: "ALREADY_MEMBER",
  LIMIT_GROUP_MEMBERS: "LIMIT_GROUP_MEMBERS",
  ALREADY_GROUP_MEMBER: "ALREADY_GROUP_MEMBER",
} as const;

export type ErrorCode = (typeof ERROR_CODE)[keyof typeof ERROR_CODE];

// Fixed set of HTTP statuses an AppError can carry. Kept as a literal union so it
// can be passed directly to Hono's c.json(body, status) without a cast.
export type HttpErrorStatus = 400 | 401 | 403 | 404 | 409 | 429 | 500;

// ─── Standardized error response body ─────────────────────────────────────────

export const ErrorResponseSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
});

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

// ─── Limit error details ──────────────────────────────────────────────────────
// Attached as `details` when throwing AppError for limit-reached codes
// (LIMIT_TRIPS, LIMIT_MEMBERS, LIMIT_GROUP_MEMBERS). The `max` value is the
// effective cap resolved at request time (may be a per-user override).

export const LimitDetailsSchema = z.object({ max: z.number().int().positive() });
export type LimitDetails = z.infer<typeof LimitDetailsSchema>;

// ─── AppError hierarchy ───────────────────────────────────────────────────────
// Throw an AppError from a route to have app.onError serialize it into the
// standardized { code, message, details? } body with the right HTTP status.

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: HttpErrorStatus;
  readonly details?: unknown;

  constructor(message: string, code: ErrorCode, httpStatus: HttpErrorStatus, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = details;
  }

  toResponse(): ErrorResponse {
    const body: ErrorResponse = { code: this.code, message: this.message };
    if (this.details !== undefined) body.details = this.details;
    return body;
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, ERROR_CODE.VALIDATION, 400, details);
    this.name = "ValidationError";
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, ERROR_CODE.UNAUTHORIZED, 401, details);
    this.name = "UnauthorizedError";
  }
}

export class PermissionError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, ERROR_CODE.PERMISSION, 403, details);
    this.name = "PermissionError";
  }
}

export class NotFoundError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, ERROR_CODE.NOT_FOUND, 404, details);
    this.name = "NotFoundError";
  }
}

export class ConflictError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, ERROR_CODE.CONFLICT, 409, details);
    this.name = "ConflictError";
  }
}

export class RateLimitError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, ERROR_CODE.RATE_LIMIT, 429, details);
    this.name = "RateLimitError";
  }
}
