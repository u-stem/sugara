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
  candidateToOptimisticSchedule,
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
  // Schedule→candidates unassign success: writes the confirmed unassign (and,
  // when dropped onto a specific candidate, the reorder) into the trip cache
  // directly instead of refetching. Refetching immediately after unassign can
  // return a stale read that leaves the schedule in the pattern, reverting
  // the drop (bug #1).
  onScheduleUnassigned: (args: {
    scheduleId: string;
    dayId: string;
    patternId: string;
    candidateIds?: string[];
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
  onScheduleUnassigned,
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
  // Write-through mirrors of the local optimistic state. dnd-kit dispatches
  // drag callbacks from NATIVE event listeners, so a rapid second drag can
  // run handleDragStart through a render closure that predates the previous
  // drop's setState — reading the state variables there resurrects the
  // pre-drop lists (e.g. a just-assigned candidate back into the candidates),
  // and the next reorder then sends an id the server has already moved and
  // gets rejected with a 400. Handlers therefore read these refs (always
  // current) and write via applyLocalSchedules/applyLocalCandidates so ref
  // and state never diverge; the state remains the render source.
  const localSchedulesRef = useRef<ScheduleResponse[] | null>(null);
  const localCandidatesRef = useRef<CandidateResponse[] | null>(null);

  function applyLocalSchedules(next: ScheduleResponse[] | null) {
    localSchedulesRef.current = next;
    setLocalSchedules(next);
  }

  function applyLocalCandidates(next: CandidateResponse[] | null) {
    localCandidatesRef.current = next;
    setLocalCandidates(next);
  }
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
  // Serializes the API phase of every drag/reorder operation. Optimistic UI
  // updates stay synchronous; only the API calls + cache-write callbacks are
  // chained, so a second drop's PATCH never reaches the server before the
  // first drop's POST has committed (concurrent-op 400s, bug #2). Tasks catch
  // their own errors, but chain via a settled promise defensively so one
  // rejected task can never wedge the queue.
  const opQueueRef = useRef<Promise<void>>(Promise.resolve());

  function enqueue(task: () => Promise<void>): Promise<void> {
    const run = opQueueRef.current.then(task, task);
    opQueueRef.current = run.catch(() => {});
    return run;
  }

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

    // Claim the op id so a still-queued previous operation's finally can no
    // longer null out the snapshot this drag is about to capture — that
    // fallback would recompute the drop against possibly-stale props. Bumped
    // only after the early return above: a bump without a matching reset
    // (dragEnd/dragCancel) would strand the previous op's snapshot.
    opIdRef.current += 1;

    const source = type === "candidate" ? "candidate" : "schedule";
    const currentSchedules = localSchedulesRef.current ?? schedules;
    const currentCandidates = localCandidatesRef.current ?? candidates;
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
    applyLocalSchedules([...currentSchedules]);
    applyLocalCandidates([...currentCandidates]);
  }

  // First sortable id of the merged timeline (crossDay entries included) —
  // the target the "drag above the list" head case resolves to.
  function firstTimelineSortableId(): string | null {
    const merged = buildMergedTimeline(localSchedulesRef.current ?? schedules, crossDayEntries);
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

  function handleDragCancel(): Promise<void> {
    // Claim a fresh op id: (1) any in-flight op's queued finally must skip
    // its reset (we own it now), (2) if a NEW drag starts before our queued
    // reset runs, the id moves on and our reset skips — never clobbering the
    // newer drag's snapshot.
    const myOpId = ++opIdRef.current;
    setActiveDragItem(null);
    setOverScheduleId(null);
    setOverCandidateId(null);
    setLastOverZone(null);
    // Route the snapshot reset through the queue: dragStart bumped the op
    // id, so the pending op's own finally will NOT reset — without this task
    // the snapshot would leak forever. Queuing (not resetting inline) also
    // guarantees props already contain the pending op's cache write.
    return enqueue(async () => {
      if (opIdRef.current === myOpId) {
        applyLocalSchedules(null);
        applyLocalCandidates(null);
      }
    });
  }

  // Synchronous phase of handleDragEnd: branch dispatch, payload computation,
  // and the optimistic setState + success toast. Returns the API task (POST/
  // PATCH + success callback + error handling) to run through the queue, or
  // null for a no-op drop. Logic here is unchanged from the pre-queue
  // handleDragEnd — only moved into its own function so the API phase can be
  // deferred separately.
  function planDrop(
    event: DragEndEvent,
    savedLastOverZone: "timeline" | "candidates" | null,
    currentSchedules: ScheduleResponse[],
    currentCandidates: CandidateResponse[],
  ): (() => Promise<void>) | null {
    if (!currentPatternId || !currentDayId) return null;
    const dayId = currentDayId;
    const patternId = currentPatternId;

    const { active, over } = event;
    const sourceType = active.data.current?.type as string | undefined;
    const overType = over?.data.current?.type as string | undefined;

    // When over is null (e.g. dropped below the last item), use lastOverZone
    const isOverCandidates = over
      ? overType === "candidates" || overType === "candidate"
      : savedLastOverZone === "candidates";
    const isOverTimeline = over
      ? overType === "timeline" || overType === "schedule"
      : savedLastOverZone === "timeline";

    if (!over && !isOverTimeline && !isOverCandidates) return null;

    if (sourceType === "schedule" && isOverTimeline) {
      if (over && active.id === over.id) return null;
      const activeId = String(active.id);
      const activeIdx = currentSchedules.findIndex((s) => s.id === activeId);
      if (activeIdx === -1) return null;

      const target = buildDropTarget(event, savedLastOverZone, firstTimelineSortableId());
      const reorderResult = computeScheduleReorderResult(
        currentSchedules,
        crossDayEntries,
        activeId,
        target,
      );
      if (reorderResult === null) return null;
      const { destIndex, anchor } = reorderResult;
      // Same-position drop with no anchor change is a true no-op. If the
      // anchor actually changed (e.g. dropping on the crossDay boundary of
      // the same slot toggles before/after), still send the reorder so the
      // new anchor is persisted.
      const activeSchedule = currentSchedules[activeIdx];
      const anchorChanged =
        (activeSchedule.crossDayAnchor ?? null) !== anchor.anchor ||
        (activeSchedule.crossDayAnchorSourceId ?? null) !== anchor.anchorSourceId;
      if (destIndex === activeIdx && !anchorChanged) return null;

      // applyOptimisticReorder rewrites sortOrder (and the active schedule's
      // anchor) so the merged timeline — which sorts anchored clusters by
      // the sortOrder field, not array position — renders the new order
      // immediately instead of snapping back (issue #166).
      const reordered = applyOptimisticReorder(
        arrayMove(currentSchedules, activeIdx, destIndex),
        activeId,
        anchor,
      );
      applyLocalSchedules(reordered);

      const scheduleIds = reordered.map((s) => s.id);
      const anchors = [
        {
          scheduleId: activeId,
          anchor: anchor.anchor,
          anchorSourceId: anchor.anchorSourceId,
        },
      ];
      return async () => {
        try {
          await api(`/api/trips/${tripId}/days/${dayId}/patterns/${patternId}/schedules/reorder`, {
            method: "PATCH",
            body: JSON.stringify({ scheduleIds, anchors }),
          });
          await onSchedulesReordered({ dayId, patternId, scheduleIds, anchors });
        } catch (err) {
          if (err instanceof ApiError && (err.status === 400 || err.status === 404)) {
            toast.error(tm("conflictStale"));
          } else {
            toast.error(tm("scheduleReorderFailed"));
          }
          await onDone();
        }
      };
    }

    if (sourceType === "schedule" && isOverCandidates) {
      const schedule = currentSchedules.find((s) => s.id === active.id);
      if (!schedule) return null;

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
      applyLocalSchedules(currentSchedules.filter((s) => s.id !== active.id));
      const insertedCandidates = [...currentCandidates];
      insertedCandidates.splice(insertIdx, 0, newCandidate);
      applyLocalCandidates(insertedCandidates);
      toast.success(tm("scheduleMovedToCandidate"));
      const candidateIds = insertedCandidates.map((c) => c.id);
      const activeId = String(active.id);

      return async () => {
        let unassigned: ScheduleResponse;
        try {
          unassigned = await api<ScheduleResponse>(
            `/api/trips/${tripId}/schedules/${activeId}/unassign`,
            {
              method: "POST",
            },
          );
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
            await api(`/api/trips/${tripId}/candidates/reorder`, {
              method: "PATCH",
              body: JSON.stringify({ scheduleIds: candidateIds }),
            });
          }
        } catch (err) {
          // unassign succeeded but reorder failed — surface the error so the
          // user knows the drop position didn't persist (post-refetch the
          // candidate will sit wherever the server's nextOrder placed it).
          if (err instanceof ApiError && (err.status === 400 || err.status === 404)) {
            toast.error(tm("conflictStale"));
          } else {
            toast.error(tm("scheduleReorderFailed"));
          }
          if (process.env.NODE_ENV !== "production") {
            console.error("[schedule→candidates reorder failed]", err);
          }
          await onDone();
          return;
        }
        // Write the confirmed unassign + order into the cache instead of
        // refetching: an immediate GET can return a stale read that leaves
        // the schedule in the pattern, reverting the drop (bug #1).
        await onScheduleUnassigned({
          scheduleId: activeId,
          dayId,
          patternId,
          candidateIds: overType === "candidate" ? candidateIds : undefined,
          serverData: unassigned,
        });
      };
    }

    if (sourceType === "candidate" && isOverTimeline) {
      const candidate = currentCandidates.find((c) => c.id === active.id);
      if (!candidate) return null;

      applyLocalCandidates(currentCandidates.filter((c) => c.id !== active.id));

      const target = buildDropTarget(event, savedLastOverZone, firstTimelineSortableId());
      const { insertIndex: insertIdx, anchor } = computeCandidateDropResult(
        currentSchedules,
        crossDayEntries,
        target,
      );

      const activeId = String(active.id);
      const newSchedule = candidateToOptimisticSchedule(candidate, insertIdx, anchor);

      const insertedSchedules = [...currentSchedules];
      insertedSchedules.splice(insertIdx, 0, newSchedule);
      applyLocalSchedules(applyOptimisticReorder(insertedSchedules, activeId, anchor));
      toast.success(tm("candidateAssigned"));

      return async () => {
        let assigned: ScheduleResponse | undefined;
        try {
          assigned = await api<ScheduleResponse>(
            `/api/trips/${tripId}/candidates/${activeId}/assign`,
            {
              method: "POST",
              body: JSON.stringify({ dayPatternId: patternId }),
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
          scheduleIds.splice(insertIdx, 0, activeId);
          const anchors = [
            {
              scheduleId: activeId,
              anchor: anchor.anchor,
              anchorSourceId: anchor.anchorSourceId,
            },
          ];
          await api(`/api/trips/${tripId}/days/${dayId}/patterns/${patternId}/schedules/reorder`, {
            method: "PATCH",
            body: JSON.stringify({ scheduleIds, anchors }),
          });
          // Write the confirmed assign + order into the cache instead of
          // refetching: an immediate GET can return a stale read that leaves
          // the new schedule at assign's nextOrder (= end of list), reverting
          // the drop position (#166).
          await onCandidateAssigned({
            candidateId: activeId,
            dayId,
            patternId,
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
        }
      };
    }

    if (sourceType === "candidate" && isOverCandidates) {
      if (over && active.id === over.id) return null;
      const oldIndex = currentCandidates.findIndex((c) => c.id === active.id);
      // When over is null (dropped below last item), move to end
      const overIndex = over
        ? currentCandidates.findIndex((c) => c.id === over.id)
        : currentCandidates.length - 1;
      if (oldIndex === -1 || overIndex === -1) return null;
      if (oldIndex === overIndex) return null;

      const reordered = arrayMove(currentCandidates, oldIndex, overIndex);
      applyLocalCandidates(reordered);

      const scheduleIds = reordered.map((c) => c.id);
      return async () => {
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
      };
    }

    return null;
  }

  function handleDragEnd(event: DragEndEvent): Promise<void> {
    const myOpId = ++opIdRef.current;
    setActiveDragItem(null);
    setOverScheduleId(null);
    setOverCandidateId(null);
    const savedLastOverZone = lastOverZone;
    setLastOverZone(null);

    // Resolve current lists once; handleDragStart captured a snapshot into state
    const currentSchedules = localSchedulesRef.current ?? schedules;
    const currentCandidates = localCandidatesRef.current ?? candidates;

    const apiTask = planDrop(event, savedLastOverZone, currentSchedules, currentCandidates);

    // Route even a no-op drop's snapshot reset through the queue: resetting
    // immediately while a previous op's API is still in flight would fall
    // back to props that don't yet contain that op's cache write, producing
    // a visible snap-back (bug #2).
    return enqueue(async () => {
      try {
        if (apiTask) await apiTask();
      } finally {
        // Reset to null so the hook falls back to server props after the
        // drop. This prevents snap-back caused by stale server data
        // overwriting the optimistic state (dnd-kit Discussion #1522). Skip
        // the reset when a newer op has started — letting it stand would
        // clobber the next op's optimistic snapshot.
        if (opIdRef.current === myOpId) {
          applyLocalSchedules(null);
          applyLocalCandidates(null);
        }
      }
    });
  }

  function reorderSchedule(id: string, direction: "up" | "down"): Promise<void> {
    if (!currentDayId || !currentPatternId) return Promise.resolve();
    const dayId = currentDayId;
    const patternId = currentPatternId;
    const current = localSchedulesRef.current ?? schedules;
    // Reorder by merged timeline position (what the user sees), not raw
    // sortOrder. Without this the step may skip across a crossDay entry and
    // land the schedule far from the user's "one step up/down" intent.
    const merged = buildMergedTimeline(current, crossDayEntries);
    const mergedIdx = merged.findIndex(
      (item) => item.type === "schedule" && item.schedule.id === id,
    );
    if (mergedIdx === -1) return Promise.resolve();
    const newMergedIdx = direction === "up" ? mergedIdx - 1 : mergedIdx + 1;
    if (newMergedIdx < 0 || newMergedIdx >= merged.length) return Promise.resolve();

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
      if (scheduleIdx === -1 || targetIdx === -1) return Promise.resolve();
      reordered = arrayMove(current, scheduleIdx, targetIdx);
      anchor =
        target.crossDayAnchor && target.crossDayAnchorSourceId
          ? { anchor: target.crossDayAnchor, anchorSourceId: target.crossDayAnchorSourceId }
          : { anchor: null, anchorSourceId: null };
    }

    // Claim the op id only once the operation is committed to proceeding —
    // an early return above must not bump without a matching reset.
    const myOpId = ++opIdRef.current;

    // Rewrite sortOrder + the moved schedule's anchor so the merged timeline
    // reflects the step immediately (issue #166). The crossDay branch
    // previously had no optimistic update at all — the anchor flip only
    // became visible after the refetch.
    reordered = applyOptimisticReorder(reordered, id, anchor);
    applyLocalSchedules(reordered);

    const scheduleIds = reordered.map((s) => s.id);
    const anchors = [{ scheduleId: id, ...anchor }];
    return enqueue(async () => {
      try {
        await api(`/api/trips/${tripId}/days/${dayId}/patterns/${patternId}/schedules/reorder`, {
          method: "PATCH",
          body: JSON.stringify({ scheduleIds, anchors }),
        });
        await onSchedulesReordered({ dayId, patternId, scheduleIds, anchors });
      } catch (err) {
        if (err instanceof ApiError && (err.status === 400 || err.status === 404)) {
          toast.error(tm("conflictStale"));
        } else {
          toast.error(tm("scheduleReorderFailed"));
        }
        await onDone();
      } finally {
        if (opIdRef.current === myOpId) {
          applyLocalSchedules(null);
        }
      }
    });
  }

  function reorderCandidate(id: string, direction: "up" | "down"): Promise<void> {
    const current = localCandidatesRef.current ?? candidates;
    const idx = current.findIndex((c) => c.id === id);
    if (idx === -1) return Promise.resolve();
    const newIdx = direction === "up" ? idx - 1 : idx + 1;
    if (newIdx < 0 || newIdx >= current.length) return Promise.resolve();

    // Claim the op id only once the operation is committed to proceeding —
    // an early return above must not bump without a matching reset.
    const myOpId = ++opIdRef.current;

    const reordered = arrayMove(current, idx, newIdx);
    applyLocalCandidates(reordered);

    const scheduleIds = reordered.map((c) => c.id);
    return enqueue(async () => {
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
          applyLocalCandidates(null);
        }
      }
    });
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
    handleDragCancel,
    reorderSchedule,
    reorderCandidate,
  };
}
