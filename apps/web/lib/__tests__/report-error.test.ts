import { afterEach, describe, expect, it, vi } from "vitest";

const captureException = vi.fn();
vi.mock("@sentry/nextjs", () => ({
  captureException: (...args: unknown[]) => captureException(...args),
}));

describe("reportError", () => {
  afterEach(() => {
    captureException.mockClear();
  });

  it("forwards the error to Sentry.captureException", async () => {
    const { reportError } = await import("../report-error");
    const err = new Error("boom");
    reportError(err);
    expect(captureException).toHaveBeenCalledWith(err, undefined);
  });

  it("passes context as Sentry extra", async () => {
    const { reportError } = await import("../report-error");
    const err = new Error("boom");
    reportError(err, { tripId: "t1" });
    expect(captureException).toHaveBeenCalledWith(err, { extra: { tripId: "t1" } });
  });
});
