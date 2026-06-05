import { AppError, ERROR_CODE, ERROR_MSG, NotFoundError, ValidationError } from "@sugara/shared";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { handleError } from "../lib/error-handler";
import { setErrorReporter } from "../lib/error-reporter";

function appThatThrows(err: unknown) {
  const app = new Hono();
  app.get("/boom", () => {
    throw err;
  });
  app.onError(handleError);
  return app;
}

describe("handleError error reporting", () => {
  afterEach(() => {
    setErrorReporter(null);
  });

  it("reports unexpected (500) errors to the injected reporter", async () => {
    const spy = vi.fn();
    setErrorReporter(spy);
    await appThatThrows(new Error("boom")).request("/boom");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("does not report expected client (4xx) errors", async () => {
    const spy = vi.fn();
    setErrorReporter(spy);
    await appThatThrows(new NotFoundError(ERROR_MSG.TRIP_NOT_FOUND)).request("/boom");
    expect(spy).not.toHaveBeenCalled();
  });

  it("reports 5xx AppErrors to the injected reporter", async () => {
    const spy = vi.fn();
    setErrorReporter(spy);
    await appThatThrows(new AppError(ERROR_MSG.INTERNAL_ERROR, ERROR_CODE.INTERNAL, 500)).request(
      "/boom",
    );
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("handleError", () => {
  it("serializes an AppError to { code, message } with its httpStatus", async () => {
    const res = await appThatThrows(new NotFoundError(ERROR_MSG.TRIP_NOT_FOUND)).request("/boom");
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe(ERROR_CODE.NOT_FOUND);
    expect(body.message).toBe(ERROR_MSG.TRIP_NOT_FOUND);
  });

  it("includes details for a ValidationError", async () => {
    const details = { fieldErrors: { title: ["Required"] } };
    const res = await appThatThrows(new ValidationError(ERROR_MSG.INVALID_INPUT, details)).request(
      "/boom",
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe(ERROR_CODE.VALIDATION);
    expect(body.details).toEqual(details);
  });

  it("keeps a legacy `error` alias equal to message for transition back-compat", async () => {
    const res = await appThatThrows(new NotFoundError(ERROR_MSG.TRIP_NOT_FOUND)).request("/boom");
    expect((await res.json()).error).toBe(ERROR_MSG.TRIP_NOT_FOUND);
  });

  it("maps SyntaxError to 400 INVALID_JSON", async () => {
    const res = await appThatThrows(new SyntaxError("bad json")).request("/boom");
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe(ERROR_CODE.INVALID_JSON);
  });

  it("maps a Postgres uuid syntax error to 400 INVALID_ID_FORMAT", async () => {
    const res = await appThatThrows(new Error('invalid input syntax for type uuid: "x"')).request(
      "/boom",
    );
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe(ERROR_CODE.INVALID_ID_FORMAT);
  });

  it("maps an unknown error to 500 INTERNAL", async () => {
    const res = await appThatThrows(new Error("boom")).request("/boom");
    expect(res.status).toBe(500);
    expect((await res.json()).code).toBe(ERROR_CODE.INTERNAL);
  });
});
