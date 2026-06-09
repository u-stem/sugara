import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Mocks ---

const mockInvalidateQueries = vi.fn();
const mockCancelQueries = vi.fn().mockResolvedValue(undefined);
const mockGetQueryData = vi.fn().mockReturnValue(undefined);
const mockSetQueryData = vi.fn();

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    cancelQueries: mockCancelQueries,
    getQueryData: mockGetQueryData,
    setQueryData: mockSetQueryData,
    invalidateQueries: mockInvalidateQueries,
  }),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn() },
}));

const mockApi = vi.fn();
vi.mock("@/lib/api", () => ({
  api: (...args: unknown[]) => mockApi(...args),
  getApiErrorMessage: vi.fn((_e: unknown, fallback: string) => fallback),
}));

import { useArticleLike } from "./use-article-like";

describe("useArticleLike", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCancelQueries.mockResolvedValue(undefined);
    mockGetQueryData.mockReturnValue(undefined);
  });

  afterEach(() => {
    cleanup();
  });

  it("calls invalidateQueries for byTrip prefix after a successful like", async () => {
    mockApi.mockResolvedValue({ liked: true, likeCount: 1 });

    const { result } = renderHook(() => useArticleLike());
    await act(() => result.current.toggleLike({ id: "article-1", likedByMe: false }));

    // Should invalidate the byTrip prefix so ArticlesPanel reflects new state.
    expect(mockInvalidateQueries).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: expect.arrayContaining(["articles", "trip"]),
      }),
    );
  });

  it("calls invalidateQueries for byTrip prefix after a successful unlike", async () => {
    mockApi.mockResolvedValue({ liked: false, likeCount: 0 });

    const { result } = renderHook(() => useArticleLike());
    await act(() => result.current.toggleLike({ id: "article-1", likedByMe: true }));

    expect(mockInvalidateQueries).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: expect.arrayContaining(["articles", "trip"]),
      }),
    );
  });

  it("does not call invalidateQueries for byTrip when the API call fails", async () => {
    mockApi.mockRejectedValue(new Error("network error"));

    const { result } = renderHook(() => useArticleLike());
    await act(() => result.current.toggleLike({ id: "article-1", likedByMe: false }));

    const byTripCalls = mockInvalidateQueries.mock.calls.filter((args) => {
      const key = (args[0] as { queryKey?: unknown[] }).queryKey;
      return Array.isArray(key) && key.includes("trip");
    });
    expect(byTripCalls).toHaveLength(0);
  });
});
