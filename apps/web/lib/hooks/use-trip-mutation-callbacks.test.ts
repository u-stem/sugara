import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Mocks ---

const mockInvalidateQueries = vi.fn();
const mockCancelQueries = vi.fn();
const mockGetQueryData = vi.fn();
const mockSetQueryData = vi.fn();

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    invalidateQueries: mockInvalidateQueries,
    cancelQueries: mockCancelQueries,
    getQueryData: mockGetQueryData,
    setQueryData: mockSetQueryData,
  }),
}));

import { useTripMutationCallbacks } from "./use-trip-mutation-callbacks";

describe("useTripMutationCallbacks", () => {
  const invalidateTrip = vi.fn();
  const broadcastChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    invalidateTrip.mockResolvedValue(undefined);
  });

  afterEach(cleanup);

  function setup() {
    return renderHook(() =>
      useTripMutationCallbacks({ tripId: "t1", invalidateTrip, broadcastChange }),
    );
  }

  it("onMutate refetches the trip detail", async () => {
    const { result } = setup();

    await act(() => result.current.onMutate());

    expect(invalidateTrip).toHaveBeenCalledTimes(1);
  });

  it("onMutate broadcasts the change to other clients", async () => {
    const { result } = setup();

    await act(() => result.current.onMutate());

    expect(broadcastChange).toHaveBeenCalledTimes(1);
  });

  // invalidateTrip's ["trips", tripId] key prefix-matches the activity-logs
  // key, so a separate invalidation would refetch the logs a second time.
  it("onMutate does not invalidate the activity logs separately", async () => {
    const { result } = setup();

    await act(() => result.current.onMutate());

    expect(mockInvalidateQueries).not.toHaveBeenCalled();
  });

  // Reproduction for #123 / #155: the caller has already written the
  // server-confirmed result into the cache. An immediate trip-detail refetch
  // can return a stale snapshot and clobber that entry, so the cache-written
  // callback must NOT trigger one.
  it("onCacheWritten does not refetch the trip detail", async () => {
    const { result } = setup();

    await act(() => result.current.onCacheWritten());

    expect(invalidateTrip).not.toHaveBeenCalled();
  });

  it("onCacheWritten does not invalidate the trip detail query key", async () => {
    const { result } = setup();

    await act(() => result.current.onCacheWritten());

    expect(mockInvalidateQueries).not.toHaveBeenCalledWith({
      queryKey: ["trips", "t1"],
    });
  });

  it("onCacheWritten broadcasts the change to other clients", async () => {
    const { result } = setup();

    await act(() => result.current.onCacheWritten());

    expect(broadcastChange).toHaveBeenCalledTimes(1);
  });

  it("onCacheWritten invalidates the activity logs", async () => {
    const { result } = setup();

    await act(() => result.current.onCacheWritten());

    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: ["trips", "t1", "activity-logs"],
    });
  });

  // The reorder endpoints return no body, but the client already knows the
  // confirmed order — write it into the cache instead of refetching, because
  // an immediate GET can return a stale read that reverts the reorder (#166,
  // same mechanism as #123).
  describe("onSchedulesReordered", () => {
    const cachedTrip = {
      id: "t1",
      candidates: [],
      days: [
        {
          id: "d1",
          patterns: [
            {
              id: "p1",
              schedules: [
                { id: "s1", sortOrder: 0 },
                { id: "s2", sortOrder: 1 },
              ],
            },
          ],
        },
      ],
    };

    const args = {
      dayId: "d1",
      patternId: "p1",
      scheduleIds: ["s2", "s1"],
      anchors: [],
    };

    it("writes the confirmed order into the trip detail cache", async () => {
      mockGetQueryData.mockReturnValue(cachedTrip);
      const { result } = setup();

      await act(() => result.current.onSchedulesReordered(args));

      const written = mockSetQueryData.mock.calls[0];
      expect(written[0]).toEqual(["trips", "t1"]);
      expect(written[1].days[0].patterns[0].schedules.map((s: { id: string }) => s.id)).toEqual([
        "s2",
        "s1",
      ]);
    });

    it("cancels in-flight trip queries before writing", async () => {
      mockGetQueryData.mockReturnValue(cachedTrip);
      const { result } = setup();

      await act(() => result.current.onSchedulesReordered(args));

      expect(mockCancelQueries).toHaveBeenCalledWith({ queryKey: ["trips", "t1"] });
    });

    it("does not refetch the trip detail when the cache holds the trip", async () => {
      mockGetQueryData.mockReturnValue(cachedTrip);
      const { result } = setup();

      await act(() => result.current.onSchedulesReordered(args));

      expect(invalidateTrip).not.toHaveBeenCalled();
    });

    it("broadcasts the change to other clients", async () => {
      mockGetQueryData.mockReturnValue(cachedTrip);
      const { result } = setup();

      await act(() => result.current.onSchedulesReordered(args));

      expect(broadcastChange).toHaveBeenCalledTimes(1);
    });

    it("falls back to a refetch when the cache has no trip", async () => {
      mockGetQueryData.mockReturnValue(undefined);
      const { result } = setup();

      await act(() => result.current.onSchedulesReordered(args));

      expect(invalidateTrip).toHaveBeenCalledTimes(1);
      expect(mockSetQueryData).not.toHaveBeenCalled();
    });
  });

  describe("onCandidatesReordered", () => {
    const cachedTrip = {
      id: "t1",
      days: [],
      candidates: [
        { id: "c1", sortOrder: 0 },
        { id: "c2", sortOrder: 1 },
      ],
    };

    it("writes the confirmed candidate order into the cache", async () => {
      mockGetQueryData.mockReturnValue(cachedTrip);
      const { result } = setup();

      await act(() => result.current.onCandidatesReordered(["c2", "c1"]));

      const written = mockSetQueryData.mock.calls[0];
      expect(written[0]).toEqual(["trips", "t1"]);
      expect(written[1].candidates.map((c: { id: string }) => c.id)).toEqual(["c2", "c1"]);
    });

    it("broadcasts the change to other clients", async () => {
      mockGetQueryData.mockReturnValue(cachedTrip);
      const { result } = setup();

      await act(() => result.current.onCandidatesReordered(["c2", "c1"]));

      expect(broadcastChange).toHaveBeenCalledTimes(1);
    });

    it("falls back to a refetch when the cache has no trip", async () => {
      mockGetQueryData.mockReturnValue(undefined);
      const { result } = setup();

      await act(() => result.current.onCandidatesReordered(["c2", "c1"]));

      expect(invalidateTrip).toHaveBeenCalledTimes(1);
      expect(mockSetQueryData).not.toHaveBeenCalled();
    });
  });

  // Candidate→timeline assign (drag-drop): same #166 cache-write principle.
  // Refetching after assign+reorder can return a stale read that leaves the
  // assigned schedule at assign's nextOrder (= end of list).
  describe("onCandidateAssigned", () => {
    const cachedTrip = {
      id: "t1",
      candidates: [{ id: "c1", sortOrder: 0, likeCount: 0, hmmCount: 0, myReaction: null }],
      days: [
        {
          id: "d1",
          patterns: [
            {
              id: "p1",
              schedules: [
                { id: "s1", sortOrder: 0 },
                { id: "s2", sortOrder: 1 },
              ],
            },
          ],
        },
      ],
    };

    const args = {
      candidateId: "c1",
      dayId: "d1",
      patternId: "p1",
      scheduleIds: ["s1", "c1", "s2"],
      anchors: [],
    };

    it("writes the assigned candidate at the drop index into the cache", async () => {
      mockGetQueryData.mockReturnValue(cachedTrip);
      const { result } = setup();

      await act(() => result.current.onCandidateAssigned(args));

      const written = mockSetQueryData.mock.calls[0];
      expect(written[0]).toEqual(["trips", "t1"]);
      expect(written[1].candidates).toEqual([]);
      expect(
        written[1].days[0].patterns[0].schedules.map((s: { id: string; sortOrder: number }) => [
          s.id,
          s.sortOrder,
        ]),
      ).toEqual([
        ["s1", 0],
        ["c1", 1],
        ["s2", 2],
      ]);
    });

    it("does not refetch the trip detail when the cache holds the trip", async () => {
      mockGetQueryData.mockReturnValue(cachedTrip);
      const { result } = setup();

      await act(() => result.current.onCandidateAssigned(args));

      expect(invalidateTrip).not.toHaveBeenCalled();
    });

    it("falls back to a refetch when the cache has no trip", async () => {
      mockGetQueryData.mockReturnValue(undefined);
      const { result } = setup();

      await act(() => result.current.onCandidateAssigned(args));

      expect(invalidateTrip).toHaveBeenCalledTimes(1);
      expect(mockSetQueryData).not.toHaveBeenCalled();
    });
  });

  // Schedule→candidates unassign (drag-drop): mirror of onCandidateAssigned's
  // #166 cache-write principle. Refetching after unassign(+reorder) can
  // return a stale read that leaves the unassigned schedule in the pattern.
  describe("onScheduleUnassigned", () => {
    const cachedTrip = {
      id: "t1",
      candidates: [{ id: "c1", sortOrder: 0, likeCount: 0, hmmCount: 0, myReaction: null }],
      days: [
        {
          id: "d1",
          patterns: [
            {
              id: "p1",
              schedules: [{ id: "s1", sortOrder: 0 }],
            },
          ],
        },
      ],
    };

    const args = {
      scheduleId: "s1",
      dayId: "d1",
      patternId: "p1",
      candidateIds: ["s1", "c1"],
    };

    it("writes the unassigned schedule at the drop index into candidates", async () => {
      mockGetQueryData.mockReturnValue(cachedTrip);
      const { result } = setup();

      await act(() => result.current.onScheduleUnassigned(args));

      const written = mockSetQueryData.mock.calls[0];
      expect(written[0]).toEqual(["trips", "t1"]);
      expect(written[1].days[0].patterns[0].schedules).toEqual([]);
      expect(
        written[1].candidates.map((c: { id: string; sortOrder: number }) => [c.id, c.sortOrder]),
      ).toEqual([
        ["s1", 0],
        ["c1", 1],
      ]);
    });

    it("does not refetch the trip detail when the cache holds the trip", async () => {
      mockGetQueryData.mockReturnValue(cachedTrip);
      const { result } = setup();

      await act(() => result.current.onScheduleUnassigned(args));

      expect(invalidateTrip).not.toHaveBeenCalled();
    });

    it("falls back to a refetch when the cache has no trip", async () => {
      mockGetQueryData.mockReturnValue(undefined);
      const { result } = setup();

      await act(() => result.current.onScheduleUnassigned(args));

      expect(invalidateTrip).toHaveBeenCalledTimes(1);
      expect(mockSetQueryData).not.toHaveBeenCalled();
    });

    it("broadcasts the change to other clients", async () => {
      mockGetQueryData.mockReturnValue(cachedTrip);
      const { result } = setup();

      await act(() => result.current.onScheduleUnassigned(args));

      expect(broadcastChange).toHaveBeenCalledTimes(1);
    });
  });
});
