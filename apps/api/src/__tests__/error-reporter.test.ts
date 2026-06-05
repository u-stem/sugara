import { afterEach, describe, expect, it, vi } from "vitest";
import { reportError, setErrorReporter } from "../lib/error-reporter";

describe("error-reporter", () => {
  afterEach(() => {
    setErrorReporter(null);
  });

  it("does nothing when no reporter is registered", () => {
    expect(() => reportError(new Error("boom"))).not.toThrow();
  });

  it("forwards the error and context to the registered reporter", () => {
    const spy = vi.fn();
    setErrorReporter(spy);
    const err = new Error("boom");
    reportError(err, { requestId: "req-1" });
    expect(spy).toHaveBeenCalledWith(err, { requestId: "req-1" });
  });

  it("becomes a no-op again after the reporter is cleared", () => {
    const spy = vi.fn();
    setErrorReporter(spy);
    setErrorReporter(null);
    reportError(new Error("boom"));
    expect(spy).not.toHaveBeenCalled();
  });
});
