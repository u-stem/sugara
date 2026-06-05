import { captureException } from "@sentry/nextjs";
import { cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithIntl } from "@/lib/test-utils";

vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

import ErrorPage from "../error";

describe("ErrorPage", () => {
  afterEach(() => {
    cleanup();
    vi.mocked(captureException).mockClear();
  });

  it("reports the error to Sentry on mount", () => {
    const error = new Error("boom");
    renderWithIntl(<ErrorPage error={error} reset={vi.fn()} />);
    expect(captureException).toHaveBeenCalledWith(error, undefined);
  });
});
