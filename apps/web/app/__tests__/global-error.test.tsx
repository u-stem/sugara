import { captureException } from "@sentry/nextjs";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

import GlobalError from "../global-error";

describe("GlobalError", () => {
  afterEach(() => {
    cleanup();
    vi.mocked(captureException).mockClear();
  });

  it("reports the error to Sentry on mount", () => {
    const error = new Error("boom");
    render(<GlobalError error={error} reset={vi.fn()} />);
    expect(captureException).toHaveBeenCalledWith(error, undefined);
  });

  it("renders a fallback message and a retry button", () => {
    render(<GlobalError error={new Error("boom")} reset={vi.fn()} />);
    expect(screen.getByRole("heading", { name: /エラーが発生しました/ })).toBeDefined();
    expect(screen.getByRole("button", { name: /Retry/ })).toBeDefined();
  });

  it("calls reset when the retry button is clicked", () => {
    const reset = vi.fn();
    render(<GlobalError error={new Error("boom")} reset={reset} />);
    fireEvent.click(screen.getByRole("button", { name: /Retry/ }));
    expect(reset).toHaveBeenCalledTimes(1);
  });
});
