"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { queryKeys } from "@/lib/query-keys";

/**
 * Shared post-mutation callbacks for the trip detail pages (desktop / SP).
 *
 * `onMutate` is the default: refetch the trip, broadcast to other clients,
 * and refresh the activity logs.
 *
 * `onScheduleAdded` exists because the add-schedule dialog writes the
 * server-confirmed POST response into the cache itself. Refetching the trip
 * right after can return a stale GET (Supavisor read-after-write lag, SW or
 * IndexedDB snapshots) that clobbers the just-added schedule (#123), so this
 * variant skips the trip-detail invalidation and only broadcasts + refreshes
 * the activity logs.
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

  const onMutate = useCallback(async () => {
    await invalidateTrip();
    broadcastChange();
    await queryClient.invalidateQueries({ queryKey: queryKeys.trips.activityLogs(tripId) });
  }, [invalidateTrip, broadcastChange, queryClient, tripId]);

  const onScheduleAdded = useCallback(async () => {
    broadcastChange();
    await queryClient.invalidateQueries({ queryKey: queryKeys.trips.activityLogs(tripId) });
  }, [broadcastChange, queryClient, tripId]);

  return { onMutate, onScheduleAdded };
}
