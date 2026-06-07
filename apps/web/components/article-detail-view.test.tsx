/**
 * Tests for ArticleDetailView layout changes and cache invalidation behaviour.
 */
import type { ArticleResponse } from "@sugara/shared";
import { useQuery } from "@tanstack/react-query";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithIntl } from "@/lib/test-utils";

// --- hoisted mocks (accessible inside vi.mock factories) ---------------------

const { mockRefetch, mockInvalidateQueries, mockToggleLike } = vi.hoisted(() => ({
  mockRefetch: vi.fn().mockResolvedValue(undefined),
  mockInvalidateQueries: vi.fn(),
  mockToggleLike: vi.fn().mockResolvedValue(undefined),
}));

// --- module mocks ------------------------------------------------------------

vi.mock("@tanstack/react-query", () => ({
  useQuery: vi.fn(),
  useQueryClient: () => ({ invalidateQueries: mockInvalidateQueries }),
  useIsRestoring: vi.fn(() => false),
}));

vi.mock("@/lib/auth-client", () => ({
  useSession: () => ({ data: { user: { id: "u1" } } }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/lib/api", () => ({
  api: vi.fn(),
  apiVoid: vi.fn(),
  getApiErrorMessage: vi.fn((_e: unknown, fallback: string) => fallback),
}));

vi.mock("@/lib/markdown", () => ({
  MarkdownRenderer: ({ content }: { content: string }) => <p>{content}</p>,
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("@/lib/hooks/use-article-like", () => ({
  useArticleLike: () => ({ toggleLike: mockToggleLike }),
}));

// Capture onSaved so tests can trigger it and assert side-effects.
let capturedOnSaved: (() => void) | undefined;
vi.mock("@/components/article-editor-dialog", () => ({
  ArticleEditorDialog: ({
    onSaved,
  }: {
    onSaved: () => void;
    open: boolean;
    onOpenChange: (v: boolean) => void;
    article: ArticleResponse;
  }) => {
    capturedOnSaved = onSaved;
    return null;
  },
}));

// Suppress Radix responsive-alert-dialog (not needed in this test).
vi.mock("@/components/ui/responsive-alert-dialog", () => ({
  ResponsiveAlertDialog: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  ResponsiveAlertDialogContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  ResponsiveAlertDialogHeader: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  ResponsiveAlertDialogTitle: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  ResponsiveAlertDialogDescription: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  ResponsiveAlertDialogFooter: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  ResponsiveAlertDialogCancel: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  ResponsiveAlertDialogDestructiveAction: ({
    children,
    onClick,
    disabled,
  }: {
    children: React.ReactNode;
    onClick: () => void;
    disabled: boolean;
  }) => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}));

import { ArticleDetailView } from "./article-detail-view";

// --- fixtures ----------------------------------------------------------------

const articleData: ArticleResponse = {
  id: "a1",
  ownerId: "u1",
  title: "My article",
  content: "# Hello",
  tags: [],
  visibility: "private",
  sortOrder: 0,
  likeCount: 5,
  likedByMe: false,
  tripIds: [],
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

// ArticleDetailView calls useQuery twice:
//   1st = article detail, 2nd = ownedTrips (enabled=false when tripIds=[])
function setupQueryMocks(overrideArticle?: Partial<ArticleResponse>) {
  vi.mocked(useQuery)
    .mockReturnValueOnce({
      data: { ...articleData, ...overrideArticle },
      isLoading: false,
      error: null,
      refetch: mockRefetch,
    } as unknown as ReturnType<typeof useQuery>)
    .mockReturnValueOnce({
      data: [] as ArticleResponse[],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useQuery>);
}

// --- tests -------------------------------------------------------------------

describe("ArticleDetailView – onSaved list-cache invalidation (Issue 3)", () => {
  beforeEach(() => {
    capturedOnSaved = undefined;
    setupQueryMocks();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("calls refetch and invalidates the article list cache when onSaved fires", () => {
    // isOwner=true because session.user.id === article.ownerId ("u1").
    // ArticleEditorDialog is rendered unconditionally when isOwner=true,
    // so capturedOnSaved is set during the first render pass.
    renderWithIntl(<ArticleDetailView articleId="a1" />);

    expect(capturedOnSaved).toBeDefined();

    // Simulate the dialog calling onSaved after a successful edit.
    capturedOnSaved?.();

    expect(mockRefetch).toHaveBeenCalledTimes(1);
    expect(mockInvalidateQueries).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ["articles", "list"] }),
    );
  });
});

describe("ArticleDetailView – new layout (A)", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("does not render a back link to the article list", () => {
    setupQueryMocks();
    renderWithIntl(<ArticleDetailView articleId="a1" />);
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("renders a like button with aria-label in the title area", () => {
    setupQueryMocks();
    renderWithIntl(<ArticleDetailView articleId="a1" />);
    expect(screen.getByRole("button", { name: /いいね/ })).toBeDefined();
  });

  it("like button has aria-pressed=false when article is not liked", () => {
    setupQueryMocks();
    renderWithIntl(<ArticleDetailView articleId="a1" />);
    const btn = screen.getByRole("button", { name: /いいね/ });
    expect(btn.getAttribute("aria-pressed")).toBe("false");
  });

  it("like button has aria-pressed=true when article is already liked", () => {
    setupQueryMocks({ likedByMe: true });
    renderWithIntl(<ArticleDetailView articleId="a1" />);
    const btn = screen.getByRole("button", { name: /いいね/ });
    expect(btn.getAttribute("aria-pressed")).toBe("true");
  });

  it("clicking the like button calls toggleLike", () => {
    setupQueryMocks();
    renderWithIntl(<ArticleDetailView articleId="a1" />);
    fireEvent.click(screen.getByRole("button", { name: /いいね/ }));
    expect(mockToggleLike).toHaveBeenCalledTimes(1);
  });

  it("displays the like count next to the like button", () => {
    setupQueryMocks();
    renderWithIntl(<ArticleDetailView articleId="a1" />);
    expect(screen.getByText("5")).toBeDefined();
  });

  it("renders tags when the article has tags", () => {
    setupQueryMocks({ tags: ["kyoto", "coffee"] });
    renderWithIntl(<ArticleDetailView articleId="a1" />);
    expect(screen.getByText("kyoto")).toBeDefined();
  });

  it("does not render the tag row when tags are empty", () => {
    setupQueryMocks();
    renderWithIntl(<ArticleDetailView articleId="a1" />);
    // articleData.tags = [] — no tag badge should appear
    expect(screen.queryByText("kyoto")).toBeNull();
  });
});
