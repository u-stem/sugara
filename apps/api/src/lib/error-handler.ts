import {
  AppError,
  ERROR_CODE,
  ERROR_MSG,
  type ErrorCode,
  type HttpErrorStatus,
} from "@sugara/shared";
import type { Context } from "hono";
import { reportError } from "./error-reporter";
import { logger } from "./logger";

// Standardized error body { code, message, details? }. The legacy `error` string
// alias is kept during the transition so frontends that still read body.error keep
// working until they consume { code, message }. Remove once the frontend migrates.
function errorBody(code: ErrorCode, message: string, details?: unknown) {
  return details === undefined
    ? { code, message, error: message }
    : { code, message, error: message, details };
}

/**
 * Global Hono error handler. Serializes AppError into the standardized response
 * shape with its HTTP status; maps known low-level errors (malformed JSON,
 * Postgres uuid syntax) to 400; falls back to 500 for everything else.
 */
export function handleError(err: Error, c: Context) {
  const requestId = c.get("requestId");
  if (err instanceof AppError) {
    if (err.httpStatus >= 500) {
      logger.error({ err, requestId }, "AppError (server)");
      reportError(err, { requestId });
    }
    return c.json(errorBody(err.code, err.message, err.details), err.httpStatus);
  }
  if (err instanceof SyntaxError) {
    return c.json(errorBody(ERROR_CODE.INVALID_JSON, ERROR_MSG.INVALID_JSON), 400);
  }
  if (err.message?.includes("invalid input syntax for type uuid")) {
    return c.json(errorBody(ERROR_CODE.INVALID_ID_FORMAT, ERROR_MSG.INVALID_ID_FORMAT), 400);
  }
  // Unexpected error: log and forward to the injected reporter (Sentry in prod).
  logger.error({ err, requestId }, "Unhandled error");
  reportError(err, { requestId });
  const status: HttpErrorStatus = 500;
  return c.json(errorBody(ERROR_CODE.INTERNAL, ERROR_MSG.INTERNAL_ERROR), status);
}
