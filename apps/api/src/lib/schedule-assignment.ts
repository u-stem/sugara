// Shared core for moving a schedule between a day-pattern and the trip-wide
// candidate pool (dayPatternId = NULL).
//
// Used by both internal routes (candidates.ts assign, schedules.ts unassign)
// and v1 external routes (candidates-write assign, trips-write unassign/move)
// so the advisory-lock sortOrder assignment and anchor-stripping stay
// single-sourced. Anchors are always cleared: crossDayAnchor only makes sense
// relative to a schedule's current pattern, so it's stale the moment the
// schedule leaves that pattern (mirrors the batch-assign/batch-unassign routes).

import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db/index";
import { schedules } from "../db/schema";
import { getNextSortOrder } from "./sort-order";

type Schedule = typeof schedules.$inferSelect;

// Assigns a schedule to `targetPatternId`, appending it to the end of that
// pattern's order. Works regardless of the schedule's current dayPatternId
// (candidate or already-assigned), so it backs both "assign" and "move".
export async function assignScheduleToPattern(
  scheduleId: string,
  targetPatternId: string,
): Promise<Schedule> {
  return db.transaction(async (tx) => {
    const nextOrder = await getNextSortOrder(
      tx,
      schedules.sortOrder,
      schedules,
      eq(schedules.dayPatternId, targetPatternId),
      `schedule:pattern:${targetPatternId}`,
    );

    const [row] = await tx
      .update(schedules)
      .set({
        dayPatternId: targetPatternId,
        sortOrder: nextOrder,
        crossDayAnchor: null,
        crossDayAnchorSourceId: null,
        updatedAt: new Date(),
      })
      .where(eq(schedules.id, scheduleId))
      .returning();

    return row;
  });
}

// Moves a schedule to the trip-wide candidate pool (dayPatternId = NULL),
// appending it to the end of the candidate order.
export async function unassignScheduleToCandidates(
  tripId: string,
  scheduleId: string,
): Promise<Schedule> {
  return db.transaction(async (tx) => {
    const nextOrder = await getNextSortOrder(
      tx,
      schedules.sortOrder,
      schedules,
      and(eq(schedules.tripId, tripId), isNull(schedules.dayPatternId)),
      `schedule:candidates:${tripId}`,
    );

    const [row] = await tx
      .update(schedules)
      .set({
        dayPatternId: null,
        sortOrder: nextOrder,
        crossDayAnchor: null,
        crossDayAnchorSourceId: null,
        updatedAt: new Date(),
      })
      .where(eq(schedules.id, scheduleId))
      .returning();

    return row;
  });
}
