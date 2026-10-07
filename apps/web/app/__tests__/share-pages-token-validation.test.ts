import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// notFound() throws in Next.js; mirror that so the page stops before fetching.
class NotFoundError extends Error {}
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new NotFoundError("NEXT_NOT_FOUND");
  },
}));

// The client components pulled in by the pages create a Supabase client at import time.
vi.mock("@/lib/supabase", () => ({ supabase: {} }));

vi.mock("next-intl/server", () => ({
  getLocale: async () => "ja",
  getTranslations: async () => (key: string) => key,
}));

import QuickPollPage, { generateMetadata as quickPollMetadata } from "../p/[token]/page";
import SharedPollPage, {
  generateMetadata as sharedPollMetadata,
} from "../polls/shared/[token]/page";
import SharedTripPage, { generateMetadata as sharedTripMetadata } from "../shared/[token]/page";

// 32 random bytes as base64url, the format generateShareToken() produces
const VALID_TOKEN = "Zm9vYmFyYmF6cXV4Zm9vYmFyYmF6cXV4Zm9vYmFyYmE";
const TRAVERSAL_TOKEN = "../admin/users";

const pages = [
  { name: "shared trip", Page: SharedTripPage, metadata: sharedTripMetadata },
  { name: "quick poll", Page: QuickPollPage, metadata: quickPollMetadata },
  { name: "date poll", Page: SharedPollPage, metadata: sharedPollMetadata },
];

describe.each(pages)("$name page token validation", ({ Page, metadata }) => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockResolvedValue({ ok: false });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it("responds with not found for a path-traversal token", async () => {
    await expect(Page({ params: Promise.resolve({ token: TRAVERSAL_TOKEN }) })).rejects.toThrow(
      NotFoundError,
    );
  });

  it("does not call the API for a path-traversal token", async () => {
    await Page({ params: Promise.resolve({ token: TRAVERSAL_TOKEN }) }).catch(() => undefined);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not call the API when building metadata for a malformed token", async () => {
    await metadata({ params: Promise.resolve({ token: TRAVERSAL_TOKEN }) });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not call the API for a token that is too short", async () => {
    await Page({ params: Promise.resolve({ token: "abc" }) }).catch(() => undefined);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("calls the API for a well-formed token", async () => {
    await Page({ params: Promise.resolve({ token: VALID_TOKEN }) }).catch(() => undefined);

    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
