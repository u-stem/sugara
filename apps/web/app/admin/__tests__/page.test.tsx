import { afterEach, describe, expect, it, vi } from "vitest";

const NOT_FOUND = "NEXT_NOT_FOUND";

vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ toString: () => "session=abc" }),
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error(NOT_FOUND);
  },
}));

vi.mock("../_components/admin-client", () => ({
  default: () => null,
}));

import AdminPage from "../page";

function mockFetchStatus(status: number) {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(new Response(null, { status }))),
  );
}

describe("AdminPage server-side authorization", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders the client shell when stats returns 200", async () => {
    mockFetchStatus(200);
    await expect(AdminPage()).resolves.toBeDefined();
  });

  it.each([401, 403, 429, 500, 503])(
    "calls notFound() when stats returns %i (fail-closed)",
    async (status) => {
      mockFetchStatus(status);
      await expect(AdminPage()).rejects.toThrow(NOT_FOUND);
    },
  );

  it("calls notFound() when the stats fetch throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("network down"))),
    );
    await expect(AdminPage()).rejects.toThrow(NOT_FOUND);
  });
});
