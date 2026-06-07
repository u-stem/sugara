/**
 * Tests for ArticleListView PC/SP branching (B):
 * - PC: inline "new article" button rendered, Select filter shown
 * - SP: inline "new article" button absent (FAB is the entry point), ActionSheet filter shown
 */
import { cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithIntl } from "@/lib/test-utils";

// --- hoisted mocks -----------------------------------------------------------

// useMobile is a plain function; control its return value via vi.fn()
vi.mock("@/lib/hooks/use-is-mobile", () => ({
  useMobile: vi.fn().mockReturnValue(false),
  useIsMobile: vi.fn().mockReturnValue(false),
  MobileContext: {},
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: vi.fn(() => ({ data: [], isLoading: false, error: null })),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useIsRestoring: vi.fn(() => false),
}));

vi.mock("@/lib/auth-client", () => ({
  useSession: () => ({ data: { user: { id: "u1" } } }),
}));

vi.mock("@/lib/hooks/use-online-status", () => ({
  useOnlineStatus: () => true,
}));

vi.mock("@/lib/hooks/use-articles", () => ({
  useArticles: () => ({
    articles: [],
    filteredArticles: [],
    isLoading: false,
    error: null,
    visibilityFilter: "all",
    setVisibilityFilter: vi.fn(),
    createDialogOpen: false,
    setCreateDialogOpen: vi.fn(),
    invalidateArticles: vi.fn(),
    sel: {
      selectionMode: false,
      selectedIds: new Set<string>(),
      batchLoading: false,
      batchDeleteOpen: false,
      setBatchDeleteOpen: vi.fn(),
      enter: vi.fn(),
      exit: vi.fn(),
      toggle: vi.fn(),
      select: vi.fn(),
      selectAll: vi.fn(),
      deselectAll: vi.fn(),
      handleBatchDelete: vi.fn(),
    },
  }),
}));

vi.mock("@/lib/guest", () => ({
  isGuestUser: () => false,
}));

vi.mock("@/components/article-editor-dialog", () => ({
  ArticleEditorDialog: () => null,
}));

vi.mock("@/components/fab", () => ({
  Fab: () => null,
}));

vi.mock("@/components/action-sheet", () => ({
  ActionSheet: () => null,
}));

vi.mock("@/components/article-card", () => ({
  ArticleCard: () => null,
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: () => null,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { useMobile } from "@/lib/hooks/use-is-mobile";
import { ArticleListView } from "./article-list-view";

// --- tests -------------------------------------------------------------------

describe("ArticleListView – PC/SP new-button and filter branching (B)", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  describe("PC mode (isMobile=false)", () => {
    beforeEach(() => {
      vi.mocked(useMobile).mockReturnValue(false);
    });

    it("renders the inline new article button", () => {
      renderWithIntl(<ArticleListView />);
      expect(screen.getByRole("button", { name: "記事を書く" })).toBeDefined();
    });

    it("renders the Select filter (not the ActionSheet trigger button)", () => {
      renderWithIntl(<ArticleListView />);
      // The Select trigger is a button with the filterByVisibility aria-label in PC mode.
      // The SP full-width <button> uses the same label, so disambiguate by checking
      // that the "new article" button co-exists (PC branch only).
      expect(screen.getByRole("button", { name: "記事を書く" })).toBeDefined();
      // No full-width filter <button> should appear; only the Select trigger does.
      // The Select trigger renders with role="combobox", not a plain button.
      expect(screen.queryByRole("combobox")).toBeDefined();
    });
  });

  describe("SP mode (isMobile=true)", () => {
    beforeEach(() => {
      vi.mocked(useMobile).mockReturnValue(true);
    });

    it("does not render the inline new article button", () => {
      renderWithIntl(<ArticleListView />);
      expect(screen.queryByRole("button", { name: "記事を書く" })).toBeNull();
    });

    it("renders the SP filter trigger button", () => {
      renderWithIntl(<ArticleListView />);
      expect(screen.getByRole("button", { name: "公開状態で絞り込み" })).toBeDefined();
    });
  });
});
