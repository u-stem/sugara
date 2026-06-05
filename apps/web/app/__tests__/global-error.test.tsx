import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import GlobalError from "../global-error";

describe("GlobalError", () => {
  afterEach(() => {
    cleanup();
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
