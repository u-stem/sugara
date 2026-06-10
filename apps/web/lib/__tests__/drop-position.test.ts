import type { CrossDayEntry, ScheduleResponse } from "@sugara/shared";
import { describe, expect, it } from "vitest";
import {
  computeCandidateDropResult,
  computeCandidateInsertIndex,
  computeScheduleReorderIndex,
  computeScheduleReorderResult,
  type DropTarget,
  indicatorGapIndex,
  isOverUpperHalf,
} from "../drop-position";

function makeSchedule(overrides: Partial<ScheduleResponse> = {}): ScheduleResponse {
  return {
    id: "s-default",
    name: "Default",
    category: "sightseeing",
    color: "blue",
    urls: [],
    sortOrder: 0,
    updatedAt: "",
    ...overrides,
  };
}

function makeCrossDayEntry(overrides: Partial<ScheduleResponse> = {}): CrossDayEntry {
  return {
    schedule: makeSchedule(overrides),
    sourceDayId: "day-1",
    sourcePatternId: "pattern-1",
    sourceDayNumber: 1,
    crossDayPosition: "final",
  };
}

describe("isOverUpperHalf", () => {
  it("returns false when overRect is missing", () => {
    expect(isOverUpperHalf(new MouseEvent("mousedown"), 0, null)).toBe(false);
    expect(isOverUpperHalf(new MouseEvent("mousedown"), 0, undefined)).toBe(false);
  });

  it("returns false when activatorEvent is null", () => {
    expect(isOverUpperHalf(null, 0, { top: 0, height: 100 })).toBe(false);
  });

  it("detects upper half via MouseEvent clientY", () => {
    // startY=0 + deltaY=30 = currentY=30, midY = 50 → upper
    const ev = new MouseEvent("mousedown", { clientY: 0 });
    expect(isOverUpperHalf(ev, 30, { top: 0, height: 100 })).toBe(true);
  });

  it("detects lower half via MouseEvent clientY", () => {
    // currentY=80, midY=50 → lower
    const ev = new MouseEvent("mousedown", { clientY: 0 });
    expect(isOverUpperHalf(ev, 80, { top: 0, height: 100 })).toBe(false);
  });

  it("treats the exact midpoint as lower half (not upper)", () => {
    const ev = new MouseEvent("mousedown", { clientY: 50 });
    // currentY = 50, midY = 50 → not < midY → lower
    expect(isOverUpperHalf(ev, 0, { top: 0, height: 100 })).toBe(false);
  });

  it("accounts for non-zero top offset of the rect", () => {
    // rect at top=200, height=100, midY=250. startY=230, deltaY=0 → currentY=230 → upper
    const ev = new MouseEvent("mousedown", { clientY: 230 });
    expect(isOverUpperHalf(ev, 0, { top: 200, height: 100 })).toBe(true);
  });

  it("falls back to touches[0].clientY for TouchEvent-like inputs", () => {
    // Build a minimal mock since TouchEvent construction varies per environment.
    const fakeTouch = {
      touches: [{ clientY: 10 }],
    } as unknown as Event;
    // currentY = 10 + 30 = 40, midY = 50 → upper
    expect(isOverUpperHalf(fakeTouch, 30, { top: 0, height: 100 })).toBe(true);
  });
});

describe("computeCandidateInsertIndex", () => {
  const s1 = makeSchedule({ id: "s1", startTime: "09:00" });
  const s2 = makeSchedule({ id: "s2", startTime: "12:00" });
  const s3 = makeSchedule({ id: "s3", startTime: "15:00" });
  const cX = makeCrossDayEntry({ id: "cX", endTime: "10:00" });

  it("returns end index when target is timeline (whole zone)", () => {
    const target: DropTarget = { kind: "timeline" };
    expect(computeCandidateInsertIndex([s1, s2], [cX], target)).toBe(2);
  });

  it("returns end index when target is outside (no over)", () => {
    const target: DropTarget = { kind: "outside" };
    expect(computeCandidateInsertIndex([s1, s2], [cX], target)).toBe(2);
  });

  it("returns end index when target overId does not match any merged item", () => {
    const target: DropTarget = { kind: "schedule", overId: "missing", upperHalf: true };
    expect(computeCandidateInsertIndex([s1, s2], [cX], target)).toBe(2);
  });

  describe("over = regular schedule", () => {
    it("inserts before schedule on upper half", () => {
      const target: DropTarget = { kind: "schedule", overId: "s2", upperHalf: true };
      expect(computeCandidateInsertIndex([s1, s2, s3], undefined, target)).toBe(1);
    });

    it("inserts after schedule on lower half", () => {
      const target: DropTarget = { kind: "schedule", overId: "s2", upperHalf: false };
      expect(computeCandidateInsertIndex([s1, s2, s3], undefined, target)).toBe(2);
    });

    it("inserts at 0 on upper half of the first schedule", () => {
      const target: DropTarget = { kind: "schedule", overId: "s1", upperHalf: true };
      expect(computeCandidateInsertIndex([s1, s2, s3], undefined, target)).toBe(0);
    });

    it("inserts at end on lower half of the last schedule", () => {
      const target: DropTarget = { kind: "schedule", overId: "s3", upperHalf: false };
      expect(computeCandidateInsertIndex([s1, s2, s3], undefined, target)).toBe(3);
    });
  });

  describe("over = cross-day entry", () => {
    it("inserts right after the previous schedule on crossDay upper half", () => {
      // merged: [s1, cX, s2, s3] → upper of cX → insert right after s1 → idx=1
      const target: DropTarget = { kind: "schedule", overId: "cross-cX", upperHalf: true };
      expect(computeCandidateInsertIndex([s1, s2, s3], [cX], target)).toBe(1);
    });

    it("inserts right before the next schedule on crossDay lower half", () => {
      // merged: [s1, cX, s2, s3] → lower of cX → insert right before s2 → idx=1
      const target: DropTarget = { kind: "schedule", overId: "cross-cX", upperHalf: false };
      expect(computeCandidateInsertIndex([s1, s2, s3], [cX], target)).toBe(1);
    });

    it("inserts at 0 when crossDay is at the very beginning (upper half)", () => {
      // merged: [cX, s1] (s1.startTime >= cX.endTime) → upper → no prev schedule → 0
      const earlyS1 = makeSchedule({ id: "s1", startTime: "11:00" });
      const target: DropTarget = { kind: "schedule", overId: "cross-cX", upperHalf: true };
      expect(computeCandidateInsertIndex([earlyS1], [cX], target)).toBe(0);
    });

    it("inserts before the next schedule on lower half at beginning", () => {
      // merged: [cX, s1] → lower → before s1 → 0
      const earlyS1 = makeSchedule({ id: "s1", startTime: "11:00" });
      const target: DropTarget = { kind: "schedule", overId: "cross-cX", upperHalf: false };
      expect(computeCandidateInsertIndex([earlyS1], [cX], target)).toBe(0);
    });

    it("inserts after last schedule when crossDay is at the end (lower half)", () => {
      // merged: [s1, cX] (no schedule after) → lower → end
      const cxLate = makeCrossDayEntry({ id: "cX", endTime: "23:00" });
      const target: DropTarget = { kind: "schedule", overId: "cross-cX", upperHalf: false };
      expect(computeCandidateInsertIndex([s1], [cxLate], target)).toBe(1);
    });

    it("inserts after prev schedule when crossDay is at the end (upper half)", () => {
      // merged: [s1, cX] → upper of cX → after s1 → 1
      const cxLate = makeCrossDayEntry({ id: "cX", endTime: "23:00" });
      const target: DropTarget = { kind: "schedule", overId: "cross-cX", upperHalf: true };
      expect(computeCandidateInsertIndex([s1], [cxLate], target)).toBe(1);
    });

    it("handles consecutive cross-day entries (upper skips over crossDay neighbors)", () => {
      // merged: [c1, c2, s1] (both early, before s1) → upper of c2 → no prev schedule (c1 is crossDay) → 0
      const c1 = makeCrossDayEntry({ id: "c1", endTime: "08:00" });
      const c2 = makeCrossDayEntry({ id: "c2", endTime: "08:30" });
      const sLate = makeSchedule({ id: "s1", startTime: "10:00" });
      const target: DropTarget = { kind: "schedule", overId: "cross-c2", upperHalf: true };
      expect(computeCandidateInsertIndex([sLate], [c1, c2], target)).toBe(0);
    });

    it("inserts at end when timeline has no schedules (only cross-day)", () => {
      // merged: [cX] → any half → empty schedules → 0
      const targetUpper: DropTarget = {
        kind: "schedule",
        overId: "cross-cX",
        upperHalf: true,
      };
      expect(computeCandidateInsertIndex([], [cX], targetUpper)).toBe(0);
      const targetLower: DropTarget = {
        kind: "schedule",
        overId: "cross-cX",
        upperHalf: false,
      };
      expect(computeCandidateInsertIndex([], [cX], targetLower)).toBe(0);
    });
  });

  describe("user scenario: 奥多摩 trip", () => {
    const sNull = makeSchedule({ id: "s-null", startTime: undefined, sortOrder: 0 });
    const s915 = makeSchedule({ id: "s-915", startTime: "09:15", sortOrder: 1 });
    const s1022 = makeSchedule({ id: "s-1022", startTime: "10:22", sortOrder: 2 });
    const c0850 = makeCrossDayEntry({ id: "c-0850", endTime: "08:50" });
    // merged: [s-null, c-0850, s-915, s-1022]

    it("inserts new candidate after the null-startTime schedule on crossDay upper", () => {
      const target: DropTarget = { kind: "schedule", overId: "cross-c-0850", upperHalf: true };
      // After s-null → index 1 in [s-null, s-915, s-1022]
      expect(computeCandidateInsertIndex([sNull, s915, s1022], [c0850], target)).toBe(1);
    });

    it("inserts new candidate before s-915 on crossDay lower", () => {
      const target: DropTarget = { kind: "schedule", overId: "cross-c-0850", upperHalf: false };
      // Before s-915 → also index 1
      expect(computeCandidateInsertIndex([sNull, s915, s1022], [c0850], target)).toBe(1);
    });

    it("inserts new candidate before s-null when dropping on upper half of s-null", () => {
      const target: DropTarget = { kind: "schedule", overId: "s-null", upperHalf: true };
      expect(computeCandidateInsertIndex([sNull, s915, s1022], [c0850], target)).toBe(0);
    });

    it("inserts new candidate after s-null on lower half of s-null", () => {
      const target: DropTarget = { kind: "schedule", overId: "s-null", upperHalf: false };
      expect(computeCandidateInsertIndex([sNull, s915, s1022], [c0850], target)).toBe(1);
    });
  });
});

describe("computeScheduleReorderIndex", () => {
  const s1 = makeSchedule({ id: "s1", startTime: "09:00", sortOrder: 0 });
  const s2 = makeSchedule({ id: "s2", startTime: "12:00", sortOrder: 1 });
  const s3 = makeSchedule({ id: "s3", startTime: "15:00", sortOrder: 2 });

  it("returns null when activeId is not in schedules", () => {
    const target: DropTarget = { kind: "schedule", overId: "s2", upperHalf: true };
    expect(computeScheduleReorderIndex([s1, s2, s3], undefined, "missing", target)).toBeNull();
  });

  it("returns null when dropping active on itself", () => {
    const target: DropTarget = { kind: "schedule", overId: "s2", upperHalf: true };
    expect(computeScheduleReorderIndex([s1, s2, s3], undefined, "s2", target)).toBeNull();
  });

  it("computes destination when moving earlier item later (upper half of s3)", () => {
    // Remove s1 → [s2, s3]. upper of s3 in that list = before s3 = idx 1
    const target: DropTarget = { kind: "schedule", overId: "s3", upperHalf: true };
    expect(computeScheduleReorderIndex([s1, s2, s3], undefined, "s1", target)).toBe(1);
  });

  it("computes destination when moving later item earlier (upper half of s1)", () => {
    // Remove s3 → [s1, s2]. upper of s1 = before s1 = idx 0
    const target: DropTarget = { kind: "schedule", overId: "s1", upperHalf: true };
    expect(computeScheduleReorderIndex([s1, s2, s3], undefined, "s3", target)).toBe(0);
  });

  it("returns end index when dropping onto the timeline zone", () => {
    const target: DropTarget = { kind: "timeline" };
    expect(computeScheduleReorderIndex([s1, s2, s3], undefined, "s1", target)).toBe(2);
  });

  it("computes destination across a cross-day entry (upper of crossDay)", () => {
    // schedules [s1 09:00, s2 12:00], crossDay c 10:00. merged when moving s2
    // with s2 removed = [s1 09:00] + [c] → [s1, c]. upper of c = after s1 = idx 1.
    const c = makeCrossDayEntry({ id: "c", endTime: "10:00" });
    const target: DropTarget = { kind: "schedule", overId: "cross-c", upperHalf: true };
    // without s2: [s1]. merged: [s1, c]. upper of c → prev schedule s1 → idx+1 = 1
    expect(computeScheduleReorderIndex([s1, s2], [c], "s2", target)).toBe(1);
  });

  it("computes destination when moving a schedule to right after a cross-day (lower)", () => {
    // Move s1 to just after cross-day that sits before s2.
    // schedules [s1 09:00, s2 12:00], c 10:00. without s1 = [s2]. merged = [c, s2].
    // lower of c → before s2 in without-list → 0.
    const c = makeCrossDayEntry({ id: "c", endTime: "10:00" });
    const target: DropTarget = { kind: "schedule", overId: "cross-c", upperHalf: false };
    expect(computeScheduleReorderIndex([s1, s2], [c], "s1", target)).toBe(0);
  });
});

describe("computeCandidateDropResult returns anchor info for crossDay drops", () => {
  const s1 = makeSchedule({ id: "s1", startTime: "09:00", sortOrder: 0 });
  const hotelCross = makeCrossDayEntry({ id: "hotel", endTime: "10:00" });

  it("returns anchor=before when dropping on crossDay upper half", () => {
    const target: DropTarget = {
      kind: "schedule",
      overId: "cross-hotel",
      upperHalf: true,
    };
    const result = computeCandidateDropResult([s1], [hotelCross], target);
    expect(result.anchor).toEqual({ anchor: "before", anchorSourceId: "hotel" });
  });

  it("returns anchor=after when dropping on crossDay lower half", () => {
    const target: DropTarget = {
      kind: "schedule",
      overId: "cross-hotel",
      upperHalf: false,
    };
    const result = computeCandidateDropResult([s1], [hotelCross], target);
    expect(result.anchor).toEqual({ anchor: "after", anchorSourceId: "hotel" });
  });

  it("returns anchor=null when dropping on a regular schedule", () => {
    const target: DropTarget = { kind: "schedule", overId: "s1", upperHalf: true };
    const result = computeCandidateDropResult([s1], [hotelCross], target);
    expect(result.anchor).toEqual({ anchor: null, anchorSourceId: null });
  });

  it("returns anchor=null when dropping on timeline / outside zones", () => {
    expect(computeCandidateDropResult([s1], [hotelCross], { kind: "timeline" }).anchor).toEqual({
      anchor: null,
      anchorSourceId: null,
    });
    expect(computeCandidateDropResult([s1], [hotelCross], { kind: "outside" }).anchor).toEqual({
      anchor: null,
      anchorSourceId: null,
    });
  });

  it("preserves the insertIndex computed by computeCandidateInsertIndex", () => {
    const target: DropTarget = {
      kind: "schedule",
      overId: "cross-hotel",
      upperHalf: false,
    };
    const directIdx = computeCandidateInsertIndex([s1], [hotelCross], target);
    const result = computeCandidateDropResult([s1], [hotelCross], target);
    expect(result.insertIndex).toBe(directIdx);
  });
});

describe("computeCandidateDropResult infers anchor from adjacent crossDay in merged", () => {
  // Scenario: user aims for "right after checkout" but closestCorners picks
  // the next schedule (upper half) because cursor landed in the gap. The
  // inferred anchor should pin to the checkout.
  it("infers anchor=after when dropping on upper half of schedule right after a crossDay", () => {
    const pre = makeSchedule({ id: "pre", sortOrder: 0 });
    const next = makeSchedule({ id: "next", startTime: "09:30", sortOrder: 1 });
    const checkout = makeCrossDayEntry({ id: "hotel", endTime: "09:00" });
    // merged: [pre, c-hotel, next]
    const target: DropTarget = { kind: "schedule", overId: "next", upperHalf: true };
    const result = computeCandidateDropResult([pre, next], [checkout], target);
    expect(result.anchor).toEqual({ anchor: "after", anchorSourceId: "hotel" });
  });

  it("infers anchor=before when dropping on lower half of schedule right before a crossDay", () => {
    const pre = makeSchedule({ id: "pre", startTime: "08:00", sortOrder: 0 });
    const post = makeSchedule({ id: "post", startTime: "10:00", sortOrder: 1 });
    const checkout = makeCrossDayEntry({ id: "hotel", endTime: "09:00" });
    // merged: [pre, c-hotel, post]
    const target: DropTarget = { kind: "schedule", overId: "pre", upperHalf: false };
    const result = computeCandidateDropResult([pre, post], [checkout], target);
    expect(result.anchor).toEqual({ anchor: "before", anchorSourceId: "hotel" });
  });

  it("does not infer anchor when adjacent item is not a crossDay", () => {
    const a = makeSchedule({ id: "a", sortOrder: 0 });
    const b = makeSchedule({ id: "b", sortOrder: 1 });
    const target: DropTarget = { kind: "schedule", overId: "b", upperHalf: true };
    const result = computeCandidateDropResult([a, b], undefined, target);
    expect(result.anchor).toEqual({ anchor: null, anchorSourceId: null });
  });

  // Symmetric rule: only pin when the drop lands on the "crossDay side" of
  // the adjacent schedule. Lower half of a schedule-after-crossDay is the
  // "far side" → no inference (avoids over-pinning genuine "between this
  // and next" intents). For that user scenario, pointerWithin in the hook
  // matches the crossDay card directly when cursor is inside its bbox.
  it("does not infer anchor when dropping on lower half of schedule right after a crossDay", () => {
    const pre = makeSchedule({ id: "pre", sortOrder: 0 });
    const next = makeSchedule({ id: "next", startTime: "09:30", sortOrder: 1 });
    const checkout = makeCrossDayEntry({ id: "hotel", endTime: "09:00" });
    // merged: [pre, c-hotel, next]
    const target: DropTarget = { kind: "schedule", overId: "next", upperHalf: false };
    const result = computeCandidateDropResult([pre, next], [checkout], target);
    expect(result.anchor).toEqual({ anchor: null, anchorSourceId: null });
  });

  it("does not infer anchor when dropping on upper half of schedule right before a crossDay", () => {
    // s1 has no time so crossDay falls to the end in merged → s1 precedes
    // crossDay. Dropping upper half of s1 is far from crossDay visually.
    const s1 = makeSchedule({ id: "s1", sortOrder: 0 });
    const checkout = makeCrossDayEntry({ id: "hotel", endTime: "10:00" });
    // merged: [s1, c-hotel]
    const target: DropTarget = { kind: "schedule", overId: "s1", upperHalf: true };
    const result = computeCandidateDropResult([s1], [checkout], target);
    expect(result.anchor).toEqual({ anchor: null, anchorSourceId: null });
  });

  it("inherits anchor from an already-anchored over schedule (lower half)", () => {
    const pre = makeSchedule({ id: "pre", sortOrder: 0 });
    // `anchored` is already pinned to checkout (e.g. a previous candidate
    // drop). Dropping on its lower half should join the same anchored group.
    const anchored = makeSchedule({
      id: "anchored",
      sortOrder: 1,
      crossDayAnchor: "after",
      crossDayAnchorSourceId: "hotel",
    });
    const later = makeSchedule({ id: "later", startTime: "09:30", sortOrder: 2 });
    const checkout = makeCrossDayEntry({ id: "hotel", endTime: "09:00" });
    const target: DropTarget = { kind: "schedule", overId: "anchored", upperHalf: false };
    const result = computeCandidateDropResult([pre, anchored, later], [checkout], target);
    expect(result.anchor).toEqual({ anchor: "after", anchorSourceId: "hotel" });
  });

  it("inherits anchor from an already-anchored over schedule (upper half)", () => {
    const pre = makeSchedule({ id: "pre", sortOrder: 0 });
    const anchored = makeSchedule({
      id: "anchored",
      sortOrder: 1,
      crossDayAnchor: "after",
      crossDayAnchorSourceId: "hotel",
    });
    const checkout = makeCrossDayEntry({ id: "hotel", endTime: "09:00" });
    const target: DropTarget = { kind: "schedule", overId: "anchored", upperHalf: true };
    const result = computeCandidateDropResult([pre, anchored], [checkout], target);
    expect(result.anchor).toEqual({ anchor: "after", anchorSourceId: "hotel" });
  });

  it("inherits anchor when prev in merged is an anchored schedule and drop is upper half (join cluster from below)", () => {
    // merged: [pre, c-hotel, anchored, plain]. Dropping upper half of `plain`
    // = insert between `anchored` and `plain` → still inside the anchored
    // cluster → inherit.
    const pre = makeSchedule({ id: "pre", sortOrder: 0 });
    const anchored = makeSchedule({
      id: "anchored",
      sortOrder: 1,
      crossDayAnchor: "after",
      crossDayAnchorSourceId: "hotel",
    });
    const plain = makeSchedule({ id: "plain", startTime: "09:30", sortOrder: 2 });
    const checkout = makeCrossDayEntry({ id: "hotel", endTime: "09:00" });
    const target: DropTarget = { kind: "schedule", overId: "plain", upperHalf: true };
    const result = computeCandidateDropResult([pre, anchored, plain], [checkout], target);
    expect(result.anchor).toEqual({ anchor: "after", anchorSourceId: "hotel" });
  });

  it("does not inherit anchor when prev is anchored but drop is lower half (past the cluster)", () => {
    // Symmetric guard: lower half on `plain` means insert after `plain` —
    // past the anchored cluster, so no inheritance.
    const pre = makeSchedule({ id: "pre", sortOrder: 0 });
    const anchored = makeSchedule({
      id: "anchored",
      sortOrder: 1,
      crossDayAnchor: "after",
      crossDayAnchorSourceId: "hotel",
    });
    const plain = makeSchedule({ id: "plain", startTime: "09:30", sortOrder: 2 });
    const checkout = makeCrossDayEntry({ id: "hotel", endTime: "09:00" });
    const target: DropTarget = { kind: "schedule", overId: "plain", upperHalf: false };
    const result = computeCandidateDropResult([pre, anchored, plain], [checkout], target);
    expect(result.anchor).toEqual({ anchor: null, anchorSourceId: null });
  });

  it("inherits anchor when next in merged is an anchored schedule and drop is lower half (join cluster from above)", () => {
    // merged: [plain, anchored, c-hotel]. Dropping lower half of `plain` =
    // insert between `plain` and `anchored` → still inside the cluster from
    // above → inherit.
    const plain = makeSchedule({ id: "plain", sortOrder: 0 });
    const anchored = makeSchedule({
      id: "anchored",
      sortOrder: 1,
      crossDayAnchor: "before",
      crossDayAnchorSourceId: "hotel",
    });
    const checkout = makeCrossDayEntry({ id: "hotel", endTime: "09:00" });
    const target: DropTarget = { kind: "schedule", overId: "plain", upperHalf: false };
    const result = computeCandidateDropResult([plain, anchored], [checkout], target);
    expect(result.anchor).toEqual({ anchor: "before", anchorSourceId: "hotel" });
  });

  it("does not inherit anchor when next is anchored but drop is upper half (before the cluster)", () => {
    // Symmetric guard: upper half on `plain` before the anchored cluster
    // means insert before `plain` — away from the cluster, so no inheritance.
    const plain = makeSchedule({ id: "plain", sortOrder: 0 });
    const anchored = makeSchedule({
      id: "anchored",
      sortOrder: 1,
      crossDayAnchor: "before",
      crossDayAnchorSourceId: "hotel",
    });
    const checkout = makeCrossDayEntry({ id: "hotel", endTime: "09:00" });
    const target: DropTarget = { kind: "schedule", overId: "plain", upperHalf: true };
    const result = computeCandidateDropResult([plain, anchored], [checkout], target);
    expect(result.anchor).toEqual({ anchor: null, anchorSourceId: null });
  });

  it("does not inherit anchor when over schedule has no anchor fields set", () => {
    // Sanity: plain (unanchored) over schedule → no inheritance. Adjacency
    // rule is also bypassed here because the schedule is not adjacent to any
    // crossDay in the merged timeline.
    const pre = makeSchedule({ id: "pre", startTime: "08:00", sortOrder: 0 });
    const plain = makeSchedule({ id: "plain", startTime: "09:00", sortOrder: 1 });
    const target: DropTarget = { kind: "schedule", overId: "plain", upperHalf: false };
    const result = computeCandidateDropResult([pre, plain], undefined, target);
    expect(result.anchor).toEqual({ anchor: null, anchorSourceId: null });
  });

  it("disambiguates by upperHalf when schedule is sandwiched between two crossDays", () => {
    const a = makeCrossDayEntry({ id: "a", endTime: "08:00" });
    const b = makeCrossDayEntry({ id: "b", endTime: "10:00" });
    const s = makeSchedule({ id: "s", startTime: "09:00", sortOrder: 0 });
    // merged: [c-a, s, c-b]
    const upper: DropTarget = { kind: "schedule", overId: "s", upperHalf: true };
    const lower: DropTarget = { kind: "schedule", overId: "s", upperHalf: false };
    expect(computeCandidateDropResult([s], [a, b], upper).anchor).toEqual({
      anchor: "after",
      anchorSourceId: "a",
    });
    expect(computeCandidateDropResult([s], [a, b], lower).anchor).toEqual({
      anchor: "before",
      anchorSourceId: "b",
    });
  });
});

describe("computeScheduleReorderResult returns anchor info for crossDay drops", () => {
  const s1 = makeSchedule({ id: "s1", startTime: "09:00", sortOrder: 0 });
  const s2 = makeSchedule({ id: "s2", startTime: "12:00", sortOrder: 1 });
  const hotelCross = makeCrossDayEntry({ id: "hotel", endTime: "10:00" });

  it("returns anchor=before when reordering into crossDay upper half", () => {
    const target: DropTarget = {
      kind: "schedule",
      overId: "cross-hotel",
      upperHalf: true,
    };
    const result = computeScheduleReorderResult([s1, s2], [hotelCross], "s2", target);
    expect(result).not.toBeNull();
    expect(result?.anchor).toEqual({ anchor: "before", anchorSourceId: "hotel" });
  });

  it("returns anchor=null when moving to a non-crossDay position", () => {
    const target: DropTarget = { kind: "schedule", overId: "s1", upperHalf: true };
    const result = computeScheduleReorderResult([s1, s2], [hotelCross], "s2", target);
    expect(result).not.toBeNull();
    expect(result?.anchor).toEqual({ anchor: null, anchorSourceId: null });
  });

  it("returns null when underlying destination index is null (active not found)", () => {
    const target: DropTarget = { kind: "timeline" };
    expect(computeScheduleReorderResult([s1, s2], [hotelCross], "missing", target)).toBeNull();
  });

  it("infers anchor=after when reordering onto upper half of schedule right after a crossDay", () => {
    // merged without s2: [s1 09:00, c-hotel 10:00] → place c-hotel at end.
    // But we want schedule immediately AFTER crossDay. Construct: s0 09:00,
    // crossDay 08:00 → merged [c-hotel, s0]. Reorder s2 onto s0 upper half.
    const s0 = makeSchedule({ id: "s0", startTime: "09:00", sortOrder: 0 });
    const sOther = makeSchedule({ id: "sOther", sortOrder: 1 });
    const hotelEarly = makeCrossDayEntry({ id: "hotel", endTime: "08:00" });
    const target: DropTarget = { kind: "schedule", overId: "s0", upperHalf: true };
    const result = computeScheduleReorderResult([s0, sOther], [hotelEarly], "sOther", target);
    expect(result).not.toBeNull();
    expect(result?.anchor).toEqual({ anchor: "after", anchorSourceId: "hotel" });
  });

  it("does not infer anchor when reordering onto lower half of schedule right after a crossDay", () => {
    // Symmetric: no inference for "far side" drop to avoid over-inference.
    const s0 = makeSchedule({ id: "s0", startTime: "09:00", sortOrder: 0 });
    const sOther = makeSchedule({ id: "sOther", sortOrder: 1 });
    const hotelEarly = makeCrossDayEntry({ id: "hotel", endTime: "08:00" });
    const target: DropTarget = { kind: "schedule", overId: "s0", upperHalf: false };
    const result = computeScheduleReorderResult([s0, sOther], [hotelEarly], "sOther", target);
    expect(result).not.toBeNull();
    expect(result?.anchor).toEqual({ anchor: null, anchorSourceId: null });
  });
});

describe("indicatorGapIndex", () => {
  const ids = ["s1", "s2", "s3"];

  it("maps upper half of an item to the gap above it", () => {
    expect(indicatorGapIndex(ids, "s2", true)).toBe(1);
  });

  it("maps lower half of an item to the gap below it", () => {
    expect(indicatorGapIndex(ids, "s1", false)).toBe(1);
  });

  it("collapses lower half of item i and upper half of item i+1 into the same gap", () => {
    // The user-visible bug: these two hover states drop into the same
    // position but used to render the line at two different spots.
    expect(indicatorGapIndex(ids, "s1", false)).toBe(indicatorGapIndex(ids, "s2", true));
  });

  it("maps lower half of the last item to the after-end gap", () => {
    expect(indicatorGapIndex(ids, "s3", false)).toBe(3);
  });

  it("returns null when overId is null", () => {
    expect(indicatorGapIndex(ids, null, true)).toBeNull();
  });

  it("returns null when overId is not in the list", () => {
    expect(indicatorGapIndex(ids, "missing", true)).toBeNull();
  });
});
