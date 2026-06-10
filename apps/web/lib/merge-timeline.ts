import type { CrossDayEntry, ScheduleResponse } from "@sugara/shared";

export type TimelineItem =
  | { type: "schedule"; schedule: ScheduleResponse }
  | { type: "crossDay"; entry: CrossDayEntry };

/**
 * Build a merged timeline of schedules and cross-day entries.
 *
 * Intermediate cross-day entries (the "staying" rows on the middle days of a
 * multi-night stay) are pinned to the top of the day in source order. Their
 * endTime is the checkout time on the final day, so it carries no meaning on
 * intermediate days and must not participate in the time-based merge. Only
 * final entries merge by endTime.
 *
 * Schedules with a valid cross-day anchor (both `crossDayAnchor` and
 * `crossDayAnchorSourceId` set, and the source id matching one of the
 * crossDayEntries) are placed immediately before/after their target crossDay
 * and sorted by sortOrder within that slot. All other schedules (including
 * schedules with a broken/stale anchor whose source doesn't match any
 * crossDay) flow through the time-based merge: time-having schedules flush
 * pending final crossDays whose endTime is <= the schedule's startTime, and
 * null-startTime schedules do not flush. Remaining final crossDays fall
 * through to the end (endTime-having entries sorted by endTime, then
 * null-endTime entries).
 */
export function buildMergedTimeline(
  schedules: ScheduleResponse[],
  crossDayEntries: CrossDayEntry[] | undefined,
): TimelineItem[] {
  if (!crossDayEntries || crossDayEntries.length === 0) {
    return schedules.map((schedule) => ({ type: "schedule", schedule }));
  }

  // Anchors may target intermediate entries too, so validity checks against
  // the full entry list, not just the time-merged (final) subset.
  const validSourceIds = new Set(crossDayEntries.map((e) => e.schedule.id));

  const intermediateEntries = crossDayEntries.filter((e) => e.crossDayPosition === "intermediate");
  const finalEntries = crossDayEntries.filter((e) => e.crossDayPosition !== "intermediate");

  const anchoredBefore: ScheduleResponse[] = [];
  const anchoredAfter: ScheduleResponse[] = [];
  const plainSchedules: ScheduleResponse[] = [];

  for (const schedule of schedules) {
    const anchor = schedule.crossDayAnchor;
    const sourceId = schedule.crossDayAnchorSourceId;
    if (anchor && sourceId && validSourceIds.has(sourceId)) {
      if (anchor === "before") anchoredBefore.push(schedule);
      else anchoredAfter.push(schedule);
    } else {
      plainSchedules.push(schedule);
    }
  }

  const merged = timeBasedMerge(plainSchedules, finalEntries);
  merged.unshift(
    ...intermediateEntries.map((entry): TimelineItem => ({ type: "crossDay", entry })),
  );

  // Skip the bucket-and-splice pass entirely when no schedules carry a
  // cross-day anchor — the time-based merge above is already the final order.
  if (anchoredBefore.length === 0 && anchoredAfter.length === 0) {
    return merged;
  }

  const sortBySortOrder = (a: ScheduleResponse, b: ScheduleResponse) => a.sortOrder - b.sortOrder;
  anchoredBefore.sort(sortBySortOrder);
  anchoredAfter.sort(sortBySortOrder);

  // Bucket anchored schedules by sourceId so each entry's lookup is O(1).
  // The previous filter-per-entry implementation was O(n × m) where n is the
  // number of anchored schedules and m is the number of crossDay entries.
  // Insertion order into the bucket preserves the sortBySortOrder above.
  const bucketBySourceId = (list: ScheduleResponse[]) => {
    const map = new Map<string, ScheduleResponse[]>();
    for (const s of list) {
      if (!s.crossDayAnchorSourceId) continue;
      const arr = map.get(s.crossDayAnchorSourceId);
      if (arr) arr.push(s);
      else map.set(s.crossDayAnchorSourceId, [s]);
    }
    return map;
  };
  const beforeBySource = bucketBySourceId(anchoredBefore);
  const afterBySource = bucketBySourceId(anchoredAfter);

  for (const entry of crossDayEntries) {
    const sourceId = entry.schedule.id;
    const before = beforeBySource.get(sourceId) ?? [];
    const after = afterBySource.get(sourceId) ?? [];
    if (before.length === 0 && after.length === 0) continue;

    const pos = merged.findIndex((item) => item.type === "crossDay" && item.entry === entry);
    if (pos === -1) continue;

    if (after.length > 0) {
      merged.splice(
        pos + 1,
        0,
        ...after.map((s): TimelineItem => ({ type: "schedule", schedule: s })),
      );
    }
    if (before.length > 0) {
      merged.splice(
        pos,
        0,
        ...before.map((s): TimelineItem => ({ type: "schedule", schedule: s })),
      );
    }
  }

  return merged;
}

function timeBasedMerge(
  schedules: ScheduleResponse[],
  crossDayEntries: CrossDayEntry[],
): TimelineItem[] {
  // Pre-compute "HH:MM" strings once. Without this cache, the same slice was
  // recomputed on every comparison — the dominant cost was the O(n × m) scan
  // over `remaining` inside the schedule loop, plus an O(m log m) sort. With
  // the Map both collapse to one slice per input → O(n + m). Keys are schedule
  // ids; uniqueness is guaranteed by the schedules table PK and the
  // single-source nature of crossDayEntries (one entry per source schedule).
  const scheduleStartHHMM = new Map<string, string | null>();
  for (const s of schedules) {
    scheduleStartHHMM.set(s.id, s.startTime?.slice(0, 5) ?? null);
  }
  const entryEndHHMM = new Map<string, string | null>();
  for (const entry of crossDayEntries) {
    entryEndHHMM.set(entry.schedule.id, entry.schedule.endTime?.slice(0, 5) ?? null);
  }
  // Map.get's undefined branch is unreachable here (every input was set above);
  // the `?? null` / `?? ""` fallbacks below exist purely to narrow the return
  // type from `string | null | undefined` to the original `string | null`.

  const merged: TimelineItem[] = [];
  const remaining = [...crossDayEntries];

  for (const schedule of schedules) {
    const scheduleTime = scheduleStartHHMM.get(schedule.id) ?? null;

    if (scheduleTime != null) {
      const toInsert: CrossDayEntry[] = [];
      // Iterate in reverse so splice() doesn't shift the indices of unvisited entries.
      for (let j = remaining.length - 1; j >= 0; j--) {
        const entryTime = entryEndHHMM.get(remaining[j].schedule.id) ?? null;
        if (entryTime == null) continue;
        if (entryTime <= scheduleTime) {
          toInsert.unshift(remaining[j]);
          remaining.splice(j, 1);
        }
      }
      toInsert.sort((a, b) => {
        const ta = entryEndHHMM.get(a.schedule.id) ?? "";
        const tb = entryEndHHMM.get(b.schedule.id) ?? "";
        return ta < tb ? -1 : ta > tb ? 1 : 0;
      });
      for (const entry of toInsert) {
        merged.push({ type: "crossDay", entry });
      }
    }

    merged.push({ type: "schedule", schedule });
  }

  const withEnd: CrossDayEntry[] = [];
  const withoutEnd: CrossDayEntry[] = [];
  for (const entry of remaining) {
    if (entry.schedule.endTime != null) withEnd.push(entry);
    else withoutEnd.push(entry);
  }
  withEnd.sort((a, b) => {
    const ta = entryEndHHMM.get(a.schedule.id) ?? "";
    const tb = entryEndHHMM.get(b.schedule.id) ?? "";
    return ta < tb ? -1 : ta > tb ? 1 : 0;
  });
  for (const entry of withEnd) {
    merged.push({ type: "crossDay", entry });
  }
  for (const entry of withoutEnd) {
    merged.push({ type: "crossDay", entry });
  }

  return merged;
}

/** Extract sortable IDs from a merged timeline (cross-day entries use prefixed ID). */
export function timelineSortableIds(items: TimelineItem[]): string[] {
  return items.map((item) =>
    item.type === "crossDay" ? `cross-${item.entry.schedule.id}` : item.schedule.id,
  );
}

/** Extract only the regular schedule order from a merged timeline. */
export function timelineScheduleOrder(items: TimelineItem[]): ScheduleResponse[] {
  const result: ScheduleResponse[] = [];
  for (const item of items) {
    if (item.type === "schedule") {
      result.push(item.schedule);
    }
  }
  return result;
}
