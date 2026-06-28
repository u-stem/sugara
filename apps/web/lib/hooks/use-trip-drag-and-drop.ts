import {
  type CollisionDetection,
  closestCorners,
  type DragEndEvent,
  type DragMoveEvent,
  type DragOverEvent,
  type DragStartEvent,
  MouseSensor,
  pointerWithin,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import type {
  CandidateResponse,
  CrossDayEntry,
  ScheduleCategory,
  ScheduleColor,
  ScheduleResponse,
} from "@sugara/shared";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { ApiError, api } from "@/lib/api";
import {
  applyOptimisticReorder,
  computeCandidateDropResult,
  computeScheduleReorderResult,
  type DropTarget,
  isOverUpperHalf,
  timelineEdge,
} from "@/lib/drop-position";
import { buildMergedTimeline, timelineSortableIds } from "@/lib/merge-timeline";
import type { ScheduleAnchorUpdate } from "@/lib/trip-cache";

type ActiveDragItem = {
  id: string;
  name: string;
  category: ScheduleCategory;
  color: ScheduleColor;
  source: "schedule" | "candidate";
};

type UseTripDragAndDropArgs = {
  tripId: string;
  currentDayId: string | null;
  currentPatternId: string | null;
  schedules: ScheduleResponse[];
  candidates: CandidateResponse[];
  crossDayEntries?: CrossDayEntry[];
  // Awaited before clearing optimistic local state. Pass an async function
  // (typically `invalidateQueries`) so the schedules prop already reflects
  // the new server order by the time the local snapshot is released —
  // otherwise the list briefly snaps back to the pre-mutation order while
  // the refetch is still in flight. Used by the move (assign/unassign)
  // branches and by every error path as the resync mechanism.
  onDone: () => void | Promise<void>;
  // Successful pure reorders skip the refetch entirely: the client already
  // knows the confirmed order, and an immediate GET after the PATCH can
  // return a stale read that visually reverts it (#166). These callbacks
  // write the order into the trip cache directly (useTripMutationCallbacks).
  onSchedulesReordered: (args: {
    dayId: string;
    patternId: string;
    scheduleIds: string[];
    anchors: ScheduleAnchorUpdate[];
  }) => void | Promise<void>;
  onCandidatesReordered: (scheduleIds: string[]) => void | Promise<void>;
  // Candidate→timeline assign success: writes the confirmed assign + order
  // into the trip cache directly instead of refetching (#166). Refetching
  // immediately after assign/reorder can return a stale read that leaves the
  // new schedule at assign's nextOrder (= end of list), reverting the drop.
  onCandidateAssigned: (args: {
    candidateId: string;
    dayId: string;
    patternId: string;
    scheduleIds: string[];
    anchors: ScheduleAnchorUpdate[];
    serverData?: ScheduleResponse;
  }) => void | Promise<void>;
};

// MouseSensor (not PointerSensor) so that touch input is handled exclusively
// by TouchSensor. PointerSensor responds to touch pointerdown and competes
// with useSwipeTab's horizontal swipe detection, causing wobble.
const MOUSE_SENSOR_OPTIONS = { activationConstraint: { distance: 8 } } as const;
const TOUCH_SENSOR_OPTIONS = {
  activationConstraint: { delay: 200, tolerance: 5 },
} as const;

function buildDropTarget(
  event: DragEndEvent,
  savedLastOverZone: "timeline" | "candidates" | null,
  headSortableId: string | null,
): DropTarget {
  const { over, activatorEvent, delta } = event;
  if (!over) {
    // Release point is outside all droppables. Fall back to the last hovered
    // zone so a drop in empty space at the end of the list still appends.
    // We deliberately do NOT reconstruct a schedule target from the last
    // hovered sortable id — we would have to guess upperHalf, and guessing
    // wrong silently flips the anchor direction (before ↔ after).
    if (savedLastOverZone === "timeline" || savedLastOverZone === "candidates") {
      return { kind: "timeline" };
    }
    return { kind: "outside" };
  }
  const overId = String(over.id);
  // A crossDay sortable (id prefixed with `cross-`) must always be treated as
  // a schedule-like drop target — even if its `data.type` metadata races in
  // an unexpected way during re-render.
  if (overId.startsWith("cross-")) {
    const upperHalf = isOverUpperHalf(activatorEvent, delta.y, over.rect);
    return { kind: "schedule", overId, upperHalf };
  }
  const overType = over.data.current?.type as string | undefined;
  if (overType === "timeline" || overType === "candidates") {
    // The wrapper wins the collision when the pointer is outside every card.
    // Above the list that means "insert at the head" — resolve to the first
    // sortable's upper half so the drop shares the schedule-target semantics
    // (insert index and crossDay anchor inference) with the indicator.
    if (
      overType === "timeline" &&
      headSortableId != null &&
      timelineEdge(activatorEvent, delta.y, over.rect) === "head"
    ) {
      return { kind: "schedule", overId: headSortableId, upperHalf: true };
    }
    return { kind: "timeline" };
  }
  if (overType === "schedule" || overType === "candidate") {
    const upperHalf = isOverUpperHalf(activatorEvent, delta.y, over.rect);
    return { kind: "schedule", overId, upperHalf };
  }
  return { kind: "outside" };
}

export function useTripDragAndDrop({
  tripId,
  currentDayId,
  currentPatternId,
  schedules,
  candidates,
  crossDayEntries,
  onDone,
  onSchedulesReordered,
  onCandidatesReordered,
  onCandidateAssigned,
}: UseTripDragAndDropArgs) {
  const tm = useTranslations("messages");
  const [activeDragItem, setActiveDragItem] = useState<ActiveDragItem | null>(null);
  const [overScheduleId, setOverScheduleId] = useState<string | null>(null);
  // Tracks upperHalf for the currently hovered schedule sortable so the
  // insert indicator can be rendered on the correct side (top vs bottom) of
  // the card. Kept in sync with handleDragOver's `isOverUpperHalf` result.
  const [overUpperHalf, setOverUpperHalf] = useState<boolean>(true);
  const [overCandidateId, setOverCandidateId] = useState<string | null>(null);
  // null = no drag in progress; use server props directly
  const [localSchedules, setLocalSchedules] = useState<ScheduleResponse[] | null>(null);
  const [localCandidates, setLocalCandidates] = useState<CandidateResponse[] | null>(null);
  // Track last known drop zone so we can handle drops in empty space below the last item
  const [lastOverZone, setLastOverZone] = useState<"timeline" | "candidates" | null>(null);
  // Monotonic id assigned at the start of every reorder / drag-end. The
  // `finally` block in each operation only resets local state when its own
  // id still matches the latest — if a second tap fires while the first is
  // awaiting onDone, the first's reset is skipped so it doesn't clobber the
  // second's optimistic snapshot. Without this guard, rapid taps would
  // briefly snap the list back to the pre-second-op order until the second
  // op's refetch completes.
  const opIdRef = useRef(0);

  const sensors = useSensors(
    useSensor(MouseSensor, MOUSE_SENSOR_OPTIONS),
    useSensor(TouchSensor, TOUCH_SENSOR_OPTIONS),
  );

  // Prefer droppables whose rect contains the cursor (pointerWithin). When the
  // cursor is inside a specific sortable card (schedule or crossDay), this
  // avoids closestCorners' corner-tie behaviour where an adjacent card with a
  // nearer corner steals the `over` target and drops the user's anchor
  // intent.
  //
  // Outer wrapper droppables (`timeline` / `candidates`) also contain the
  // cursor whenever the drag is anywhere inside the list, but they convey no
  // positional information beyond "inside the zone". If pointerWithin only
  // matched wrappers we fall back to closestCorners so the nearest sortable
  // card still wins — this preserves the existing gap-drop behaviour.
  const collisionDetection: CollisionDetection = (args) => {
    const within = pointerWithin(args);
    const specific = within.filter((c) => c.id !== "timeline" && c.id !== "candidates");
    if (specific.length > 0) return specific;
    return closestCorners(args);
  };

  function handleDragStart(event: DragStartEvent) {
    const { active } = event;
    const type = active.data.current?.type as string | undefined;
    if (!type) return;

    const source = type === "candidate" ? "candidate" : "schedule";
    const currentSchedules = localSchedules ?? schedules;
    const currentCandidates = localCandidates ?? candidates;
    const item =
      source === "schedule"
        ? currentSchedules.find((s) => s.id === active.id)
        : currentCandidates.find((c) => c.id === active.id);
    setActiveDragItem({
      id: String(active.id),
      name: item?.name ?? "",
      category: item?.category ?? "sightseeing",
      color: item?.color ?? "blue",
      source,
    });
    setOverScheduleId(null);
    setOverCandidateId(null);
    setLastOverZone(null);
    // Capture snapshot so optimistic updates have a stable baseline during
    // drag. Base it on the current optimistic state, not the raw props: while
    // a previous op is still awaiting its refetch, props hold the pre-mutation
    // order, and snapshotting them would compute this drag against stale data.
    setLocalSchedules([...currentSchedules]);
    setLocalCandidates([...currentCandidates]);
  }

  // First sortable id of the merged timeline (crossDay entries included) —
  // the target the "drag above the list" head case resolves to.
  function firstTimelineSortableId(): string | null {
    const merged = buildMergedTimeline(localSchedules ?? schedules, crossDayEntries);
    const ids = timelineSortableIds(merged);
    return ids.length > 0 ? ids[0] : null;
  }

  // Shared by onDragOver and onDragMove. dnd-kit fires onDragOver only when
  // the over target CHANGES — moving the pointer within the same droppable
  // (e.g. lifting it above the list while the timeline wrapper stays the
  // over target, or crossing a card's midline) emits no onDragOver. The
  // position-dependent state (upperHalf, head/tail edge) therefore must also
  // be re-evaluated from onDragMove, which fires on every movement.
  function updateOverState(event: DragOverEvent | DragMoveEvent) {
    const { over, activatorEvent, delta } = event;
    if (!over) {
      // Keep overScheduleId so the insert indicator doesn't jump to the
      // bottom when the pointer briefly leaves all drop targets.
      // It will be reset in handleDragEnd.
      return;
    }
    const overType = over.data.current?.type as string | undefined;
    if (overType === "schedule" || overType === "timeline") {
      if (overType === "schedule") {
        setOverScheduleId(String(over.id));
        setOverUpperHalf(isOverUpperHalf(activatorEvent, delta.y, over.rect));
      } else {
        // The timeline wrapper wins the collision only when the pointer is
        // outside every card. Above the list = the head gap; below = the
        // append-at-end inline indicator (overScheduleId null). "inside"
        // (a gap the wrapper stole) keeps the previous, more specific value
        // so the indicator doesn't briefly jump while crossing gaps.
        const edge = timelineEdge(activatorEvent, delta.y, over.rect);
        if (edge === "head") {
          const headId = firstTimelineSortableId();
          if (headId != null) {
            setOverScheduleId(headId);
            setOverUpperHalf(true);
          }
        } else if (edge === "tail") {
          setOverScheduleId(null);
        }
      }
      setOverCandidateId(null);
      setLastOverZone("timeline");
    } else if (overType === "candidate" || overType === "candidates") {
      if (overType === "candidate") {
        setOverCandidateId(String(over.id));
      }
      setOverScheduleId(null);
      setLastOverZone("candidates");
    } else {
      setOverScheduleId(null);
      setOverCandidateId(null);
      setLastOverZone(null);
    }
  }

  function handleDragOver(event: DragOverEvent) {
    updateOverState(event);
  }

  function handleDragMove(event: DragMoveEvent) {
    updateOverState(event);
  }

  async function handleDragEnd(event: DragEndEvent) {
    // Bump first; cleanup state below always runs and any "id holes" left by
    // early returns inside the try block don't affect race correctness — only
    // equality between myOpId and opIdRef.current at finally time matters.
    const myOpId = ++opIdRef.current;
    setActiveDragItem(null);
    setOverScheduleId(null);
    setOverCandidateId(null);
    const { active, over } = event;
    const savedLastOverZone = lastOverZone;
    setLastOverZone(null);

    // Resolve current lists once; handleDragStart captured a snapshot into state
    const currentSchedules = localSchedules ?? schedules;
    const currentCandidates = localCandidates ?? candidates;

    try {
      if (!currentPatternId || !currentDayId) return;

      const sourceType = active.data.current?.type as string | undefined;
      const overType = over?.data.current?.type as string | undefined;

      // When over is null (e.g. dropped below the last item), use lastOverZone
      const isOverCandidates = over
        ? overType === "candidates" || overType === "candidate"
        : savedLastOverZone === "candidates";
      const isOverTimeline = over
        ? overType === "timeline" || overType === "schedule"
        : savedLastOverZone === "timeline";

      if (!over && !isOverTimeline && !isOverCandidates) return;

      if (sourceType === "schedule" && isOverTimeline) {
        if (over && active.id === over.id) return;
        const activeId = String(active.id);
        const activeIdx = currentSchedules.findIndex((s) => s.id === activeId);
        if (activeIdx === -1) return;

        const target = buildDropTarget(event, savedLastOverZone, firstTimelineSortableId());
        const reorderResult = computeScheduleReorderResult(
          currentSchedules,
          crossDayEntries,
          activeId,
          target,
        );
        if (reorderResult === null) return;
        const { destIndex, anchor } = reorderResult;
        // Same-position drop with no anchor change is a true no-op. If the
        // anchor actually changed (e.g. dropping on the crossDay boundary of
        // the same slot toggles before/after), still send the reorder so the
        // new anchor is persisted.
        const activeSchedule = currentSchedules[activeIdx];
        const anchorChanged =
          (activeSchedule.crossDayAnchor ?? null) !== anchor.anchor ||
          (activeSchedule.crossDayAnchorSourceId ?? null) !== anchor.anchorSourceId;
        if (destIndex === activeIdx && !anchorChanged) return;

        // applyOptimisticReorder rewrites sortOrder (and the active schedule's
        // anchor) so the merged timeline — which sorts anchored clusters by
        // the sortOrder field, not array position — renders the new order
        // immediately instead of snapping back (issue #166).
        const reordered = applyOptimisticReorder(
          arrayMove(currentSchedules, activeIdx, destIndex),
          activeId,
          anchor,
        );
        setLocalSchedules(reordered);

        const scheduleIds = reordered.map((s) => s.id);
        const anchors = [
          {
            scheduleId: activeId,
            anchor: anchor.anchor,
            anchorSourceId: anchor.anchorSourceId,
          },
        ];
        try {
          await api(
            `/api/trips/${tripId}/days/${currentDayId}/patterns/${currentPatternId}/schedules/reorder`,
            {
              method: "PATCH",
              body: JSON.stringify({ scheduleIds, anchors }),
            },
          );
          await onSchedulesReordered({
            dayId: currentDayId,
            patternId: currentPatternId,
            scheduleIds,
            anchors,
          });
        } catch (err) {
          if (err instanceof ApiError && (err.status === 400 || err.status === 404)) {
            toast.error(tm("conflictStale"));
          } else {
            toast.error(tm("scheduleReorderFailed"));
          }
          await onDone();
        }
      } else if (sourceType === "schedule" && isOverCandidates) {
        const schedule = currentSchedules.find((s) => s.id === active.id);
        if (!schedule) return;

        // Calculate insertion position
        let insertIdx = currentCandidates.length;
        if (overType === "candidate" && over) {
          const idx = currentCandidates.findIndex((c) => c.id === over.id);
          if (idx !== -1) insertIdx = idx;
        }

        // Candidates have no dayPatternId → crossDay anchor is meaningless.
        // Clear the anchor fields explicitly so the optimistic state matches
        // what the server returns after unassign (which nulls them server-side).
        const newCandidate = {
          ...schedule,
          crossDayAnchor: null,
          crossDayAnchorSourceId: null,
          likeCount: 0,
          hmmCount: 0,
          myReaction: null,
        };
        setLocalSchedules(currentSchedules.filter((s) => s.id !== active.id));
        const insertedCandidates = [...currentCandidates];
        insertedCandidates.splice(insertIdx, 0, newCandidate);
        setLocalCandidates(insertedCandidates);
        toast.success(tm("scheduleMovedToCandidate"));

        try {
          await api(`/api/trips/${tripId}/schedules/${active.id}/unassign`, {
            method: "POST",
          });
        } catch (err) {
          if (err instanceof ApiError && (err.status === 400 || err.status === 404)) {
            toast.error(tm("conflictStale"));
          } else {
            toast.error(tm("scheduleMoveFailed"));
          }
          await onDone();
          return;
        }

        try {
          if (overType === "candidate") {
            // Build expected order from pre-mutation snapshot
            const reordered = [...currentCandidates];
            reordered.splice(insertIdx, 0, newCandidate);
            const scheduleIds = reordered.map((c) => c.id);
            await api(`/api/trips/${tripId}/candidates/reorder`, {
              method: "PATCH",
              body: JSON.stringify({ scheduleIds }),
            });
          }
        } catch (err) {
          // unassign succeeded but reorder failed — surface the error so the
          // user knows the drop position didn't persist (post-refetch the
          // candidate will sit wherever the server's nextOrder placed it).
          toast.error(tm("scheduleReorderFailed"));
          if (process.env.NODE_ENV !== "production") {
            console.error("[schedule→candidates reorder failed]", err);
          }
          await onDone();
          return;
        }
        await onDone();
      } else if (sourceType === "candidate" && isOverTimeline) {
        const candidate = currentCandidates.find((c) => c.id === active.id);
        if (!candidate) return;

        setLocalCandidates(currentCandidates.filter((c) => c.id !== active.id));

        const target = buildDropTarget(event, savedLastOverZone, firstTimelineSortableId());
        const { insertIndex: insertIdx, anchor } = computeCandidateDropResult(
          currentSchedules,
          crossDayEntries,
          target,
        );

        const newSchedule: ScheduleResponse = {
          id: candidate.id,
          name: candidate.name,
          category: candidate.category,
          address: candidate.address,
          startTime: candidate.startTime,
          endTime: candidate.endTime,
          sortOrder: insertIdx,
          memo: candidate.memo,
          urls: candidate.urls,
          departurePlace: candidate.departurePlace,
          arrivalPlace: candidate.arrivalPlace,
          transportMethod: candidate.transportMethod,
          color: candidate.color,
          endDayOffset: candidate.endDayOffset,
          crossDayAnchor: anchor.anchor,
          crossDayAnchorSourceId: anchor.anchorSourceId,
          latitude: candidate.latitude,
          longitude: candidate.longitude,
          placeId: candidate.placeId,
          updatedAt: candidate.updatedAt,
        };

        const insertedSchedules = [...currentSchedules];
        insertedSchedules.splice(insertIdx, 0, newSchedule);
        setLocalSchedules(applyOptimisticReorder(insertedSchedules, String(active.id), anchor));
        toast.success(tm("candidateAssigned"));

        let assigned: ScheduleResponse | undefined;
        try {
          assigned = await api<ScheduleResponse>(
            `/api/trips/${tripId}/candidates/${active.id}/assign`,
            {
              method: "POST",
              body: JSON.stringify({ dayPatternId: currentPatternId }),
            },
          );
        } catch (err) {
          if (err instanceof ApiError && (err.status === 400 || err.status === 404)) {
            toast.error(tm("conflictStale"));
          } else {
            toast.error(tm("candidateAssignFailed"));
          }
          await onDone();
          return;
        }

        try {
          // Always write reorder + anchors after assign so the anchor is
          // persisted even when dropping into the timeline zone (overType
          // "timeline") — the previous branch-by-overType only persisted
          // order on overType === "schedule", which was fine for sortOrder
          // but would drop the anchor silently.
          const scheduleIds = [...currentSchedules.map((s) => s.id)];
          scheduleIds.splice(insertIdx, 0, String(active.id));
          const anchors = [
            {
              scheduleId: String(active.id),
              anchor: anchor.anchor,
              anchorSourceId: anchor.anchorSourceId,
            },
          ];
          await api(
            `/api/trips/${tripId}/days/${currentDayId}/patterns/${currentPatternId}/schedules/reorder`,
            {
              method: "PATCH",
              body: JSON.stringify({ scheduleIds, anchors }),
            },
          );
          // Write the confirmed assign + order into the cache instead of
          // refetching: an immediate GET can return a stale read that leaves
          // the new schedule at assign's nextOrder (= end of list), reverting
          // the drop position (#166).
          await onCandidateAssigned({
            candidateId: String(active.id),
            dayId: currentDayId,
            patternId: currentPatternId,
            scheduleIds,
            anchors,
            serverData: assigned,
          });
        } catch (err) {
          // Previously this was a silent catch — which meant a 400 from
          // validateAnchors or pattern check would leave the candidate at
          // assign's nextOrder (= end of list) with no visible error. Surface
          // the failure so the user knows the drop didn't persist correctly.
          if (err instanceof ApiError && (err.status === 400 || err.status === 404)) {
            toast.error(tm("conflictStale"));
          } else {
            toast.error(tm("scheduleReorderFailed"));
          }
          if (process.env.NODE_ENV !== "production") {
            console.error("[candidate→timeline reorder failed]", err);
          }
          await onDone();
          return;
        }
      } else if (sourceType === "candidate" && isOverCandidates) {
        if (over && active.id === over.id) return;
        const oldIndex = currentCandidates.findIndex((c) => c.id === active.id);
        // When over is null (dropped below last item), move to end
        const overIndex = over
          ? currentCandidates.findIndex((c) => c.id === over.id)
          : currentCandidates.length - 1;
        if (oldIndex === -1 || overIndex === -1) return;
        if (oldIndex === overIndex) return;

        const reordered = arrayMove(currentCandidates, oldIndex, overIndex);
        setLocalCandidates(reordered);

        const scheduleIds = reordered.map((c) => c.id);
        try {
          await api(`/api/trips/${tripId}/candidates/reorder`, {
            method: "PATCH",
            body: JSON.stringify({ scheduleIds }),
          });
          await onCandidatesReordered(scheduleIds);
        } catch (err) {
          if (err instanceof ApiError && (err.status === 400 || err.status === 404)) {
            toast.error(tm("conflictStale"));
          } else {
            toast.error(tm("scheduleReorderFailed"));
          }
          await onDone();
        }
      }
    } finally {
      // Reset to null so the hook falls back to server props after the drop.
      // This prevents snap-back caused by stale server data overwriting
      // the optimistic state (dnd-kit Discussion #1522). Skip the reset when
      // a newer op has started — letting it stand would clobber the next
      // op's optimistic snapshot.
      if (opIdRef.current === myOpId) {
        setLocalSchedules(null);
        setLocalCandidates(null);
      }
    }
  }

  async function reorderSchedule(id: string, direction: "up" | "down") {
    const myOpId = ++opIdRef.current;
    if (!currentDayId || !currentPatternId) return;
    const current = localSchedules ?? schedules;
    // Reorder by merged timeline position (what the user sees), not raw
    // sortOrder. Without this the step may skip across a crossDay entry and
    // land the schedule far from the user's "one step up/down" intent.
    const merged = buildMergedTimeline(current, crossDayEntries);
    const mergedIdx = merged.findIndex(
      (item) => item.type === "schedule" && item.schedule.id === id,
    );
    if (mergedIdx === -1) return;
    const newMergedIdx = direction === "up" ? mergedIdx - 1 : mergedIdx + 1;
    if (newMergedIdx < 0 || newMergedIdx >= merged.length) return;

    const targetItem = merged[newMergedIdx];
    let anchor: { anchor: "before" | "after" | null; anchorSourceId: string | null };
    let reordered = current;

    if (targetItem.type === "crossDay") {
      // Swap target is a crossDay — can't swap sortOrder (crossDay isn't in
      // this day's schedules). Express "one step past crossDay" as an
      // anchor: before when moving up, after when moving down. The array
      // order is unchanged — the rendered position shifts via the anchor.
      anchor = {
        anchor: direction === "up" ? "before" : "after",
        anchorSourceId: targetItem.entry.schedule.id,
      };
    } else {
      // Swap with a regular schedule. When the target is anchored, the step
      // lands inside its anchored cluster — join it, mirroring the drag
      // path's extractAnchor rule (a drop on an anchored schedule joins its
      // cluster). Clearing the anchor here would eject the schedule from the
      // cluster and let the time-based merge re-place it far from the
      // intended one-step move. For an unanchored target, clear the anchor
      // so the explicit reorder wins over any prior pin.
      const target = targetItem.schedule;
      const scheduleIdx = current.findIndex((s) => s.id === id);
      const targetIdx = current.findIndex((s) => s.id === target.id);
      if (scheduleIdx === -1 || targetIdx === -1) return;
      reordered = arrayMove(current, scheduleIdx, targetIdx);
      anchor =
        target.crossDayAnchor && target.crossDayAnchorSourceId
          ? { anchor: target.crossDayAnchor, anchorSourceId: target.crossDayAnchorSourceId }
          : { anchor: null, anchorSourceId: null };
    }
    // Rewrite sortOrder + the moved schedule's anchor so the merged timeline
    // reflects the step immediately (issue #166). The crossDay branch
    // previously had no optimistic update at all — the anchor flip only
    // became visible after the refetch.
    reordered = applyOptimisticReorder(reordered, id, anchor);
    setLocalSchedules(reordered);

    const scheduleIds = reordered.map((s) => s.id);
    const anchors = [{ scheduleId: id, ...anchor }];
    try {
      await api(
        `/api/trips/${tripId}/days/${currentDayId}/patterns/${currentPatternId}/schedules/reorder`,
        {
          method: "PATCH",
          body: JSON.stringify({ scheduleIds, anchors }),
        },
      );
      await onSchedulesReordered({
        dayId: currentDayId,
        patternId: currentPatternId,
        scheduleIds,
        anchors,
      });
    } catch (err) {
      if (err instanceof ApiError && (err.status === 400 || err.status === 404)) {
        toast.error(tm("conflictStale"));
      } else {
        toast.error(tm("scheduleReorderFailed"));
      }
      await onDone();
    } finally {
      if (opIdRef.current === myOpId) {
        setLocalSchedules(null);
      }
    }
  }

  async function reorderCandidate(id: string, direction: "up" | "down") {
    const myOpId = ++opIdRef.current;
    const current = localCandidates ?? candidates;
    const idx = current.findIndex((c) => c.id === id);
    if (idx === -1) return;
    const newIdx = direction === "up" ? idx - 1 : idx + 1;
    if (newIdx < 0 || newIdx >= current.length) return;

    const reordered = arrayMove(current, idx, newIdx);
    setLocalCandidates(reordered);

    const scheduleIds = reordered.map((c) => c.id);
    try {
      await api(`/api/trips/${tripId}/candidates/reorder`, {
        method: "PATCH",
        body: JSON.stringify({ scheduleIds }),
      });
      await onCandidatesReordered(scheduleIds);
    } catch (err) {
      if (err instanceof ApiError && (err.status === 400 || err.status === 404)) {
        toast.error(tm("conflictStale"));
      } else {
        toast.error(tm("scheduleReorderFailed"));
      }
      await onDone();
    } finally {
      if (opIdRef.current === myOpId) {
        setLocalCandidates(null);
      }
    }
  }

  return {
    sensors,
    collisionDetection,
    activeDragItem,
    overScheduleId,
    overUpperHalf,
    overCandidateId,
    localSchedules: localSchedules ?? schedules,
    localCandidates: localCandidates ?? candidates,
    handleDragStart,
    handleDragOver,
    handleDragMove,
    handleDragEnd,
    reorderSchedule,
    reorderCandidate,
  };
}
