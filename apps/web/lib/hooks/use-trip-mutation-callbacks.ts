"use client";

import type { ScheduleResponse, TripResponse } from "@sugara/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { queryKeys } from "@/lib/query-keys";
import {
  assignCandidateToPattern,
  reorderCandidates,
  reorderSchedulesInPattern,
  type ScheduleAnchorUpdate,
} from "@/lib/trip-cache";

/**
 * Shared post-mutation callbacks for the trip detail pages (desktop / SP).
 *
 * `onMutate` is the default: refetch the trip, broadcast to other clients,
 * and refresh the activity logs.
 *
 * `onCacheWritten` is for mutations that have already written the
 * server-confirmed result into the trip cache themselves (add / edit /
 * delete dialogs, candidate panel, status change). Refetching the trip
 * right after can return a stale GET (Supavisor read-after-write lag, SW or
 * IndexedDB snapshots) that clobbers the just-written entry (#123 / #155),
 * so this variant skips the trip-detail invalidation and only broadcasts +
 * refreshes the activity logs.
 *
 * `onSchedulesReordered` / `onCandidatesReordered` apply the same principle
 * to the reorder endpoints (#166): the client already knows the confirmed
 * order, so it is written into the cache directly instead of refetched —
 * an immediate GET after the PATCH can return a stale read that visually
 * reverts the reorder. Reordering writes no activity log, so unlike
 * `onCacheWritten` there is nothing else to refresh.
 */
export function useTripMutationCallbacks({
  tripId,
  invalidateTrip,
  broadcastChange,
}: {
  tripId: string;
  invalidateTrip: () => Promise<void>;
  broadcastChange: () => void;
}) {
  const queryClient = useQueryClient();

  // invalidateTrip's ["trips", tripId] key prefix-matches the activity-logs
  // key, so no separate invalidation is needed here (it would refetch the
  // logs a second time).
  const onMutate = useCallback(async () => {
    await invalidateTrip();
    broadcastChange();
  }, [invalidateTrip, broadcastChange]);

  const onCacheWritten = useCallback(async () => {
    broadcastChange();
    await queryClient.invalidateQueries({ queryKey: queryKeys.trips.activityLogs(tripId) });
  }, [broadcastChange, queryClient, tripId]);

  const onSchedulesReordered = useCallback(
    async (args: {
      dayId: string;
      patternId: string;
      scheduleIds: string[];
      anchors: ScheduleAnchorUpdate[];
    }) => {
      const cacheKey = queryKeys.trips.detail(tripId);
      // Stop any in-flight trip GET: it could resolve after setQueryData with
      // a stale snapshot and overwrite the just-confirmed order (#123 / #166).
      await queryClient.cancelQueries({ queryKey: cacheKey });
      const prev = queryClient.getQueryData<TripResponse>(cacheKey);
      if (prev) {
        queryClient.setQueryData(
          cacheKey,
          reorderSchedulesInPattern(
            prev,
            args.dayId,
            args.patternId,
            args.scheduleIds,
            args.anchors,
          ),
        );
      } else {
        await invalidateTrip();
      }
      broadcastChange();
    },
    [queryClient, tripId, invalidateTrip, broadcastChange],
  );

  const onCandidatesReordered = useCallback(
    async (scheduleIds: string[]) => {
      const cacheKey = queryKeys.trips.detail(tripId);
      await queryClient.cancelQueries({ queryKey: cacheKey });
      const prev = queryClient.getQueryData<TripResponse>(cacheKey);
      if (prev) {
        queryClient.setQueryData(cacheKey, reorderCandidates(prev, scheduleIds));
      } else {
        await invalidateTrip();
      }
      broadcastChange();
    },
    [queryClient, tripId, invalidateTrip, broadcastChange],
  );

  // Candidate→timeline assign (drag-drop): same #166 cache-write principle as
  // the reorder callbacks. The assign+reorder PATCHes are confirmed, so the
  // resulting order is written into the cache directly. Refetching here can
  // return a stale read that leaves the just-assigned schedule at assign's
  // nextOrder (= end of list), reverting the drop position.
  const onCandidateAssigned = useCallback(
    async (args: {
      candidateId: string;
      dayId: string;
      patternId: string;
      scheduleIds: string[];
      anchors: ScheduleAnchorUpdate[];
      serverData?: ScheduleResponse;
    }) => {
      const cacheKey = queryKeys.trips.detail(tripId);
      await queryClient.cancelQueries({ queryKey: cacheKey });
      const prev = queryClient.getQueryData<TripResponse>(cacheKey);
      if (prev) {
        queryClient.setQueryData(
          cacheKey,
          assignCandidateToPattern(
            prev,
            args.candidateId,
            args.dayId,
            args.patternId,
            args.scheduleIds,
            args.anchors,
            args.serverData,
          ),
        );
      } else {
        await invalidateTrip();
      }
      broadcastChange();
    },
    [queryClient, tripId, invalidateTrip, broadcastChange],
  );

  return {
    onMutate,
    onCacheWritten,
    onSchedulesReordered,
    onCandidatesReordered,
    onCandidateAssigned,
  };
}
