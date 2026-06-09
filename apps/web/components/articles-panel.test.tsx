import type { ArticleListItem } from "@sugara/shared";
import { useQuery } from "@tanstack/react-query";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithIntl } from "@/lib/test-utils";
import { ArticlesPanel } from "./articles-panel";

vi.mock("@/lib/api", () => ({
  api: vi.fn(),
  getApiErrorMessage: vi.fn((_e: unknown, fallback: string) => fallback),
}));

// Isolate the panel from the inline embed dialog (tested separately).
vi.mock("@/components/article-embed-dialog", () => ({
  ArticleEmbedDialog: () => null,
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: vi.fn(() => ({ data: [], isLoading: false, error: null })),
  useQueryClient: vi.fn(() => ({})),
  useIsRestoring: vi.fn(() => false),
}));

const article: ArticleListItem = {
  id: "a1",
  ownerId: "u1",
  title: "Kyoto trip notes",
  tags: ["kyoto"],
  visibility: "private",
  sortOrder: 0,
  likeCount: 2,
  likedByMe: false,
  createdAt: "2026-06-06T00:00:00.000Z",
  updatedAt: "2026-06-06T00:00:00.000Z",
};

describe("ArticlesPanel", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows the empty state when no articles are linked", () => {
    renderWithIntl(<ArticlesPanel tripId="trip-1" />);
    expect(screen.getByText("この旅行に紐づく記事はありません")).toBeDefined();
  });

  it("lists linked articles with title, tag and like count", () => {
    vi.mocked(useQuery).mockReturnValue({
      data: [article],
      isLoading: false,
      error: null,
    } as ReturnType<typeof useQuery>);

    renderWithIntl(<ArticlesPanel tripId="trip-1" />);

    expect(screen.getByText("Kyoto trip notes")).toBeDefined();
    expect(screen.getByText("kyoto")).toBeDefined();
    expect(screen.getByText("2")).toBeDefined();
    // The item is a button that opens the inline embed (no navigation).
    expect(screen.getByRole("button", { name: /Kyoto trip notes/ })).toBeDefined();
  });
});
