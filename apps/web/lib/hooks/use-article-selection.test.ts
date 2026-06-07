import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Mocks ---

const mockCancelQueries = vi.fn().mockResolvedValue(undefined);
const mockGetQueryData = vi.fn();
const mockSetQueryData = vi.fn();
const mockInvalidateQueries = vi.fn();

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    cancelQueries: mockCancelQueries,
    getQueryData: mockGetQueryData,
    setQueryData: mockSetQueryData,
    invalidateQueries: mockInvalidateQueries,
  }),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, _params?: unknown) => key,
}));

const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
  },
}));

const mockApi = vi.fn();
vi.mock("@/lib/api", () => ({
  api: (...args: unknown[]) => mockApi(...args),
  getApiErrorMessage: vi.fn((_e: unknown, fallback: string) => fallback),
}));

import { useArticleSelection } from "./use-article-selection";

const articleId1 = "00000000-0000-0000-0000-000000000001";
const articleId2 = "00000000-0000-0000-0000-000000000002";

const fakeArticle = (id: string) => ({
  id,
  ownerId: "u1",
  title: `Article ${id}`,
  tags: [],
  visibility: "private" as const,
  sortOrder: 0,
  likeCount: 0,
  likedByMe: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

describe("useArticleSelection", () => {
  const invalidateArticles = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockCancelQueries.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
  });

  function renderSel(articleIds = [articleId1, articleId2]) {
    return renderHook(() => useArticleSelection({ articleIds, invalidateArticles }));
  }

  // --- optimistic delete removes items from cache ---
  it("optimistically removes selected articles from the list cache", async () => {
    const prevArticles = [fakeArticle(articleId1), fakeArticle(articleId2)];
    mockGetQueryData.mockReturnValue(prevArticles);
    mockApi.mockResolvedValue({ ok: true, deleted: 1 });

    const { result } = renderSel();

    // Enter selection mode and select articleId1
    act(() => result.current.enter());
    act(() => result.current.toggle(articleId1));

    await act(() => result.current.handleBatchDelete());

    // setQueryData should have been called with the list minus the selected item
    const setDataCall = mockSetQueryData.mock.calls[0];
    const updatedList = setDataCall[1];
    expect(updatedList).toHaveLength(1);
    expect(updatedList[0].id).toBe(articleId2);
  });

  // --- API call sends correct body ---
  it("calls POST /api/articles/batch-delete with the selected article IDs", async () => {
    mockGetQueryData.mockReturnValue([]);
    mockApi.mockResolvedValue({ ok: true, deleted: 1 });

    const { result } = renderSel();

    act(() => result.current.enter());
    act(() => result.current.toggle(articleId1));

    await act(() => result.current.handleBatchDelete());

    expect(mockApi).toHaveBeenCalledWith(
      "/api/articles/batch-delete",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ articleIds: [articleId1] }),
      }),
    );
  });

  // --- failure rolls back cache ---
  it("restores the previous cache when the API call fails", async () => {
    const prevArticles = [fakeArticle(articleId1), fakeArticle(articleId2)];
    mockGetQueryData.mockReturnValue(prevArticles);
    mockApi.mockRejectedValue(new Error("network error"));

    const { result } = renderSel();

    act(() => result.current.enter());
    act(() => result.current.toggle(articleId1));

    await act(() => result.current.handleBatchDelete());

    // The last setQueryData call should restore the original list
    const calls = mockSetQueryData.mock.calls;
    const lastCall = calls[calls.length - 1];
    expect(lastCall[1]).toEqual(prevArticles);
  });

  // --- success toasts ---
  it("shows a success toast with the deleted count", async () => {
    mockGetQueryData.mockReturnValue([]);
    mockApi.mockResolvedValue({ ok: true, deleted: 2 });

    const { result } = renderSel();

    act(() => result.current.enter());
    act(() => result.current.toggle(articleId1));
    act(() => result.current.toggle(articleId2));

    await act(() => result.current.handleBatchDelete());

    expect(mockToastSuccess).toHaveBeenCalledTimes(1);
  });

  // --- selectAll fills selectedIds with all articleIds ---
  it("selectAll sets selectedIds to every articleId passed to the hook", () => {
    const { result } = renderSel();

    act(() => result.current.selectAll());

    expect(result.current.selectedIds).toEqual(new Set([articleId1, articleId2]));
  });

  // --- deselectAll empties selectedIds ---
  it("deselectAll clears all selected IDs", () => {
    const { result } = renderSel();
    act(() => result.current.toggle(articleId1));

    act(() => result.current.deselectAll());

    expect(result.current.selectedIds.size).toBe(0);
  });

  // --- select replaces selectedIds with exactly the given ids ---
  it("select sets selectedIds to only the provided ids", () => {
    const { result } = renderSel();
    act(() => result.current.toggle(articleId2));

    act(() => result.current.select([articleId1]));

    expect(result.current.selectedIds).toEqual(new Set([articleId1]));
  });

  // --- exit clears selection ---
  it("exits selection mode and clears selected IDs on exit", () => {
    const { result } = renderSel();

    act(() => result.current.enter());
    act(() => result.current.toggle(articleId1));
    expect(result.current.selectedIds.size).toBe(1);

    act(() => result.current.exit());
    expect(result.current.selectionMode).toBe(false);
    expect(result.current.selectedIds.size).toBe(0);
  });
});
