import type { CandidateResponse, CrossDayEntry, ScheduleResponse } from "@sugara/shared";
import { buildMergedTimeline, type TimelineItem, timelineSortableIds } from "./merge-timeline";

/** Current pointer Y = activation position + drag delta. Works with pointer, mouse, and touch events. */
function resolvePointerY(activatorEvent: Event | null, deltaY: number): number | null {
  if (!activatorEvent) return null;
  let startY: number | null = null;
  const ev = activatorEvent as PointerEvent | MouseEvent | TouchEvent;
  if ("clientY" in ev && typeof ev.clientY === "number") {
    startY = ev.clientY;
  } else if ("touches" in ev && ev.touches?.[0]) {
    startY = ev.touches[0].clientY;
  }
  if (startY == null) return null;
  return startY + deltaY;
}

/**
 * Determine whether the pointer currently sits in the upper half of the
 * drop target's bounding rect.
 */
export function isOverUpperHalf(
  activatorEvent: Event | null,
  deltaY: number,
  overRect: { top: number; height: number } | null | undefined,
): boolean {
  if (!overRect) return false;
  const currentY = resolvePointerY(activatorEvent, deltaY);
  if (currentY == null) return false;
  const midY = overRect.top + overRect.height / 2;
  return currentY < midY;
}

/**
 * Locate the pointer relative to the timeline zone rect. The wrapper
 * droppable wins the collision only when the pointer is outside every card —
 * above the list ("head", insert at the top), below it ("tail", append at the
 * end), or in a gap the wrapper happened to steal ("inside", where callers
 * should keep their previous, more specific target).
 */
export function timelineEdge(
  activatorEvent: Event | null,
  deltaY: number,
  rect: { top: number; bottom: number } | null | undefined,
): "head" | "tail" | "inside" | null {
  if (!rect) return null;
  const currentY = resolvePointerY(activatorEvent, deltaY);
  if (currentY == null) return null;
  if (currentY < rect.top) return "head";
  if (currentY > rect.bottom) return "tail";
  return "inside";
}

/**
 * Canonical gap index for the insert indicator line.
 *
 * Hovering the lower half of item i and the upper half of item i+1 both drop
 * into the same gap, but rendering the line on "bottom of i" vs "top of i+1"
 * produces two visually distinct positions for one insertion point (the list
 * has inter-item spacing). Normalizing to a gap index lets the caller render
 * a single line per gap: index k means "the gap above item k", and
 * k === items.length means "after the last item".
 */
export function indicatorGapIndex(
  sortableIds: string[],
  overId: string | null,
  upperHalf: boolean,
): number | null {
  if (overId == null) return null;
  const idx = sortableIds.indexOf(overId);
  if (idx === -1) return null;
  return upperHalf ? idx : idx + 1;
}

export type DropTarget =
  | { kind: "schedule"; overId: string; upperHalf: boolean }
  | { kind: "timeline" }
  | { kind: "outside" };

/**
 * Compute the insertion index in the schedules array for a new item
 * (candidate→timeline drop). The target describes what the pointer is over
 * and whether it hovers the upper or lower half of that element.
 *
 * Returns an index in the range [0, schedules.length] suitable for
 * `schedules.splice(idx, 0, newItem)`.
 */
export function computeCandidateInsertIndex(
  schedules: ScheduleResponse[],
  crossDayEntries: CrossDayEntry[] | undefined,
  target: DropTarget,
): number {
  if (target.kind !== "schedule") {
    return schedules.length;
  }

  const merged = buildMergedTimeline(schedules, crossDayEntries);
  const mergedIds = timelineSortableIds(merged);
  const overIdx = mergedIds.indexOf(target.overId);
  if (overIdx === -1) return schedules.length;

  const overItem = merged[overIdx];
  if (overItem.type === "schedule") {
    const idx = schedules.findIndex((s) => s.id === overItem.schedule.id);
    if (idx === -1) return schedules.length;
    return target.upperHalf ? idx : idx + 1;
  }

  // crossDay: the hovered item is a visual placeholder, not a real schedule
  // in this day's schedules array. Map to the nearest schedule neighbor.
  if (target.upperHalf) {
    let prevIdx = overIdx - 1;
    while (prevIdx >= 0 && merged[prevIdx].type !== "schedule") prevIdx--;
    if (prevIdx < 0) return 0;
    const prev = merged[prevIdx];
    if (prev.type !== "schedule") return 0;
    const idx = schedules.findIndex((s) => s.id === prev.schedule.id);
    return idx === -1 ? 0 : idx + 1;
  }

  let nextIdx = overIdx + 1;
  while (nextIdx < merged.length && merged[nextIdx].type !== "schedule") nextIdx++;
  if (nextIdx >= merged.length) return schedules.length;
  const next = merged[nextIdx];
  if (next.type !== "schedule") return schedules.length;
  const idx = schedules.findIndex((s) => s.id === next.schedule.id);
  return idx === -1 ? schedules.length : idx;
}

/**
 * Compute the post-move index in the schedules array for an existing
 * schedule being reordered (schedule→timeline drop). Returns null if the
 * active schedule cannot be located or the move is a no-op.
 *
 * The returned index refers to the final position in a post-move array of
 * the same length as `schedules` — i.e., the result of moving active to that
 * slot. Pass it into `arrayMove(schedules, from, to)` after adjusting for
 * the splice-then-insert semantics (see caller).
 */
export function computeScheduleReorderIndex(
  schedules: ScheduleResponse[],
  crossDayEntries: CrossDayEntry[] | undefined,
  activeId: string,
  target: DropTarget,
): number | null {
  const activeIdx = schedules.findIndex((s) => s.id === activeId);
  if (activeIdx === -1) return null;

  // Computing the insert index on the schedules list with active removed
  // gives the destination slot in the post-move array (length unchanged
  // because we will reinsert active there).
  const without = schedules.filter((s) => s.id !== activeId);

  // When dropping on active itself, treat as no-op.
  if (target.kind === "schedule" && target.overId === activeId) return null;

  const insert = computeCandidateInsertIndex(without, crossDayEntries, target);
  return insert;
}

export type AnchorUpdate = {
  anchor: "before" | "after" | null;
  anchorSourceId: string | null;
};

export type CandidateDropResult = {
  insertIndex: number;
  anchor: AnchorUpdate;
};

/**
 * Builds the optimistic ScheduleResponse for a candidate dropped onto the
 * timeline. Spreads the candidate (minus its reaction-only fields) so every
 * schedule field — including optional ones like cost, which a hand-written
 * field list can silently drop without a type error — carries over.
 */
export function candidateToOptimisticSchedule(
  candidate: CandidateResponse,
  sortOrder: number,
  anchor: AnchorUpdate,
): ScheduleResponse {
  const {
    likeCount: _likeCount,
    hmmCount: _hmmCount,
    myReaction: _myReaction,
    ...fields
  } = candidate;
  return {
    ...fields,
    sortOrder,
    crossDayAnchor: anchor.anchor,
    crossDayAnchorSourceId: anchor.anchorSourceId,
  };
}

/**
 * Like `computeCandidateInsertIndex`, but also returns the anchor update that
 * should be written to the inserted schedule. When the drop target is a
 * crossDay sortable (id prefixed with `cross-`), the anchor is set to
 * 'before' / 'after' with the source schedule id extracted from the prefix.
 * For any other drop (regular schedule, timeline zone, outside), the anchor
 * is cleared.
 */
export function computeCandidateDropResult(
  schedules: ScheduleResponse[],
  crossDayEntries: CrossDayEntry[] | undefined,
  target: DropTarget,
): CandidateDropResult {
  return {
    insertIndex: computeCandidateInsertIndex(schedules, crossDayEntries, target),
    anchor: extractAnchor(schedules, crossDayEntries, target),
  };
}

/**
 * Like `computeScheduleReorderIndex` but also returns the anchor update.
 * Returns null when the underlying index computation returns null (active id
 * not found or same-over no-op).
 */
export function computeScheduleReorderResult(
  schedules: ScheduleResponse[],
  crossDayEntries: CrossDayEntry[] | undefined,
  activeId: string,
  target: DropTarget,
): { destIndex: number; anchor: AnchorUpdate } | null {
  const destIndex = computeScheduleReorderIndex(schedules, crossDayEntries, activeId, target);
  if (destIndex === null) return null;
  const without = schedules.filter((s) => s.id !== activeId);
  return { destIndex, anchor: extractAnchor(without, crossDayEntries, target) };
}

function extractAnchor(
  schedules: ScheduleResponse[],
  crossDayEntries: CrossDayEntry[] | undefined,
  target: DropTarget,
): AnchorUpdate {
  if (target.kind !== "schedule") {
    return { anchor: null, anchorSourceId: null };
  }
  // Direct drop on a crossDay sortable: use the id prefix.
  const match = /^cross-(.+)$/.exec(target.overId);
  if (match) {
    return {
      anchor: target.upperHalf ? "before" : "after",
      anchorSourceId: match[1],
    };
  }
  // Drop on a regular schedule: if that schedule is adjacent to a crossDay in
  // the merged timeline, infer the anchor. This catches the common case where
  // the user aimed for the crossDay's upper/lower half but the cursor landed
  // on the next/previous schedule because cards are very close together and
  // closestCorners picks the adjacent sortable in the gap.
  if (!crossDayEntries || crossDayEntries.length === 0) {
    return { anchor: null, anchorSourceId: null };
  }
  const merged = buildMergedTimeline(schedules, crossDayEntries);
  const overIdx = merged.findIndex(
    (item) => item.type === "schedule" && item.schedule.id === target.overId,
  );
  if (overIdx === -1) return { anchor: null, anchorSourceId: null };
  const overSchedule = schedules.find((s) => s.id === target.overId);
  // Drops directly on an already-anchored schedule join the same anchored
  // cluster regardless of upperHalf.
  if (overSchedule?.crossDayAnchor && overSchedule.crossDayAnchorSourceId) {
    return {
      anchor: overSchedule.crossDayAnchor,
      anchorSourceId: overSchedule.crossDayAnchorSourceId,
    };
  }
  const prev = overIdx > 0 ? merged[overIdx - 1] : null;
  const next = overIdx < merged.length - 1 ? merged[overIdx + 1] : null;
  // Symmetric rule: pin only when the drop is on the "crossDay / anchored
  // cluster side" of the over schedule. The mirror case (e.g. upperHalf=false
  // + prev=crossDay) would push a pin far from the crossDay visually and
  // silently override a legitimate "insert between this schedule and the
  // next" intent. Users can always adjust cursor direction since the insert
  // indicator now tracks upperHalf.
  if (target.upperHalf) {
    if (prev?.type === "crossDay") {
      return { anchor: "after", anchorSourceId: prev.entry.schedule.id };
    }
    const prevAnchor = anchoredScheduleAnchor(prev);
    if (prevAnchor) return prevAnchor;
  } else {
    if (next?.type === "crossDay") {
      return { anchor: "before", anchorSourceId: next.entry.schedule.id };
    }
    const nextAnchor = anchoredScheduleAnchor(next);
    if (nextAnchor) return nextAnchor;
  }
  return { anchor: null, anchorSourceId: null };
}

/**
 * Normalize an optimistically reordered schedules array so the merged
 * timeline renders it in the new order.
 *
 * `buildMergedTimeline` sorts schedules anchored to a crossDay entry by their
 * `sortOrder` FIELD, not by array position. A bare `arrayMove` changes only
 * the array order, so a reorder inside an anchored cluster was a visual no-op
 * (the dragged card snapped straight back — issue #166). Rewriting sortOrder
 * to the array index mirrors what the server's reorder endpoint persists, and
 * writing the new anchor onto the active schedule makes anchor changes (e.g.
 * dragging across the crossDay boundary) visible immediately as well.
 */
export function applyOptimisticReorder(
  reordered: ScheduleResponse[],
  activeId: string,
  anchor: AnchorUpdate,
): ScheduleResponse[] {
  return reordered.map((s, i) =>
    s.id === activeId
      ? {
          ...s,
          sortOrder: i,
          crossDayAnchor: anchor.anchor,
          crossDayAnchorSourceId: anchor.anchorSourceId,
        }
      : { ...s, sortOrder: i },
  );
}

function anchoredScheduleAnchor(item: TimelineItem | null): AnchorUpdate | null {
  if (item?.type !== "schedule") return null;
  const { crossDayAnchor, crossDayAnchorSourceId } = item.schedule;
  if (!crossDayAnchor || !crossDayAnchorSourceId) return null;
  return { anchor: crossDayAnchor, anchorSourceId: crossDayAnchorSourceId };
}
