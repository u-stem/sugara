import { describe, expect, it } from "vitest";
import {
  AppError,
  ConflictError,
  ERROR_CODE,
  ErrorResponseSchema,
  NotFoundError,
  PermissionError,
  RateLimitError,
  UnauthorizedError,
  ValidationError,
} from "../index";

describe("AppError", () => {
  it("is an instance of Error", () => {
    const err = new AppError("boom", ERROR_CODE.INTERNAL, 500);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(AppError);
  });

  it("carries code, httpStatus and message", () => {
    const err = new AppError("boom", ERROR_CODE.INTERNAL, 500);
    expect(err.code).toBe(ERROR_CODE.INTERNAL);
    expect(err.httpStatus).toBe(500);
    expect(err.message).toBe("boom");
  });

  it("serializes to a response body without details when none given", () => {
    const err = new AppError("boom", ERROR_CODE.INTERNAL, 500);
    expect(err.toResponse()).toEqual({ code: ERROR_CODE.INTERNAL, message: "boom" });
  });

  it("includes details in the response body when provided", () => {
    const details = { fieldErrors: { title: ["Required"] } };
    const err = new ValidationError("invalid", details);
    expect(err.toResponse()).toEqual({
      code: ERROR_CODE.VALIDATION,
      message: "invalid",
      details,
    });
  });
});

describe("concrete error types", () => {
  it("ValidationError maps to 400 / VALIDATION", () => {
    const err = new ValidationError("bad");
    expect(err.httpStatus).toBe(400);
    expect(err.code).toBe(ERROR_CODE.VALIDATION);
  });

  it("UnauthorizedError maps to 401 / UNAUTHORIZED", () => {
    const err = new UnauthorizedError("nope");
    expect(err.httpStatus).toBe(401);
    expect(err.code).toBe(ERROR_CODE.UNAUTHORIZED);
  });

  it("PermissionError maps to 403 / PERMISSION", () => {
    const err = new PermissionError("forbidden");
    expect(err.httpStatus).toBe(403);
    expect(err.code).toBe(ERROR_CODE.PERMISSION);
  });

  it("NotFoundError maps to 404 / NOT_FOUND", () => {
    const err = new NotFoundError("gone");
    expect(err.httpStatus).toBe(404);
    expect(err.code).toBe(ERROR_CODE.NOT_FOUND);
  });

  it("ConflictError maps to 409 / CONFLICT", () => {
    const err = new ConflictError("conflict");
    expect(err.httpStatus).toBe(409);
    expect(err.code).toBe(ERROR_CODE.CONFLICT);
  });

  it("RateLimitError maps to 429 / RATE_LIMIT", () => {
    const err = new RateLimitError("slow down");
    expect(err.httpStatus).toBe(429);
    expect(err.code).toBe(ERROR_CODE.RATE_LIMIT);
  });

  it("all concrete types are AppError instances", () => {
    const errors = [
      new ValidationError("a"),
      new UnauthorizedError("b"),
      new PermissionError("c"),
      new NotFoundError("d"),
      new ConflictError("e"),
      new RateLimitError("f"),
    ];
    for (const err of errors) {
      expect(err).toBeInstanceOf(AppError);
    }
  });
});

describe("ErrorResponseSchema", () => {
  it("accepts a minimal { code, message } body", () => {
    const result = ErrorResponseSchema.safeParse({
      code: ERROR_CODE.NOT_FOUND,
      message: "Trip not found",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a body with details", () => {
    const result = ErrorResponseSchema.safeParse({
      code: ERROR_CODE.VALIDATION,
      message: "invalid",
      details: { fieldErrors: { title: ["Required"] } },
    });
    expect(result.success).toBe(true);
  });

  it("rejects a body missing code", () => {
    const result = ErrorResponseSchema.safeParse({ message: "oops" });
    expect(result.success).toBe(false);
  });

  it("matches what AppError.toResponse produces", () => {
    const err = new NotFoundError("Trip not found");
    const result = ErrorResponseSchema.safeParse(err.toResponse());
    expect(result.success).toBe(true);
  });
});
