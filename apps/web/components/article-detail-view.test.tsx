/**
 * Regression test for Issue 3: editing an article must invalidate the article
 * list cache so the list page reflects the updated title/visibility immediately.
 */
import type { ArticleResponse } from "@sugara/shared";
import { useQuery } from "@tanstack/react-query";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithIntl } from "@/lib/test-utils";

// --- hoisted mocks (accessible inside vi.mock factories) ---------------------

const { mockRefetch, mockInvalidateQueries } = vi.hoisted(() => ({
  mockRefetch: vi.fn().mockResolvedValue(undefined),
  mockInvalidateQueries: vi.fn(),
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
  likeCount: 0,
  likedByMe: false,
  tripIds: [],
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

// ArticleDetailView calls useQuery twice:
//   1st = article detail, 2nd = ownedTrips (enabled=false when tripIds=[])
function setupQueryMocks() {
  vi.mocked(useQuery)
    .mockReturnValueOnce({
      data: articleData,
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
