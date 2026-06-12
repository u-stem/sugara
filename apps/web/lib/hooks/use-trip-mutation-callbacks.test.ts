import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Mocks ---

const mockInvalidateQueries = vi.fn();

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    invalidateQueries: mockInvalidateQueries,
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

  // Reproduction for #123: the add-schedule dialog has already written the
  // server-confirmed schedule into the cache. An immediate trip-detail refetch
  // can return a stale snapshot and clobber that entry, so the schedule-added
  // callback must NOT trigger one.
  it("onScheduleAdded does not refetch the trip detail", async () => {
    const { result } = setup();

    await act(() => result.current.onScheduleAdded());

    expect(invalidateTrip).not.toHaveBeenCalled();
  });

  it("onScheduleAdded does not invalidate the trip detail query key", async () => {
    const { result } = setup();

    await act(() => result.current.onScheduleAdded());

    expect(mockInvalidateQueries).not.toHaveBeenCalledWith({
      queryKey: ["trips", "t1"],
    });
  });

  it("onScheduleAdded broadcasts the change to other clients", async () => {
    const { result } = setup();

    await act(() => result.current.onScheduleAdded());

    expect(broadcastChange).toHaveBeenCalledTimes(1);
  });

  it("onScheduleAdded invalidates the activity logs", async () => {
    const { result } = setup();

    await act(() => result.current.onScheduleAdded());

    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: ["trips", "t1", "activity-logs"],
    });
  });
});
