import { z } from "zod";

// ─── Error code taxonomy ──────────────────────────────────────────────────────
// HTTP-semantic classification of API errors. The human-readable detail stays in
// ERROR_MSG (messages.ts) and is carried in the `message` field; `code` lets the
// frontend branch on the *kind* of error without parsing message strings.

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
} as const;

export type ErrorCode = (typeof ERROR_CODE)[keyof typeof ERROR_CODE];

// ─── Standardized error response body ─────────────────────────────────────────

export const ErrorResponseSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
});

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

// ─── AppError hierarchy ───────────────────────────────────────────────────────
// Throw an AppError from a route to have app.onError serialize it into the
// standardized { code, message, details? } body with the right HTTP status.

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly details?: unknown;

  constructor(message: string, code: ErrorCode, httpStatus: number, details?: unknown) {
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
