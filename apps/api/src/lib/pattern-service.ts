// Shared core for day-pattern write operations (create/duplicate/overwrite).
//
// Used by both the internal route (apps/api/src/routes/patterns.ts) and the v1
// external route (apps/api/src/routes/v1/patterns-write.ts) so the per-day
// pattern cap, the per-trip schedule cap, and the advisory-lock sortOrder
// assignment stay single-sourced. Side effects (activity logging) remain in the
// route layer because the actor id/name is resolved differently per surface.

import { MAX_PATTERNS_PER_DAY, MAX_SCHEDULES_PER_TRIP } from "@sugara/shared";
import { count, eq } from "drizzle-orm";
import { db } from "../db/index";
import { dayPatterns, schedules } from "../db/schema";
import { buildScheduleCloneValues } from "./schedule-clone";
import { getScheduleCount } from "./schedule-count";
import { getNextSortOrder } from "./sort-order";

type DayPattern = typeof dayPatterns.$inferSelect;

// Source schedules come from a `with: { schedules: true }` relational query,
// which returns full rows — same shape as buildScheduleCloneValues expects.
type CloneableSchedule = typeof schedules.$inferSelect;

export type CreatePatternResult =
  | { ok: true; pattern: DayPattern }
  | { ok: false; error: "pattern_limit_reached" };

export async function createDayPatternCore(
  tripDayId: string,
  label: string,
): Promise<CreatePatternResult> {
  const [patternCount] = await db
    .select({ count: count() })
    .from(dayPatterns)
    .where(eq(dayPatterns.tripDayId, tripDayId));
  if (patternCount.count >= MAX_PATTERNS_PER_DAY) {
    return { ok: false, error: "pattern_limit_reached" };
  }

  const pattern = await db.transaction(async (tx) => {
    const nextOrder = await getNextSortOrder(
      tx,
      dayPatterns.sortOrder,
      dayPatterns,
      eq(dayPatterns.tripDayId, tripDayId),
      `pattern:day:${tripDayId}`,
    );

    const [result] = await tx
      .insert(dayPatterns)
      .values({ tripDayId, label, isDefault: false, sortOrder: nextOrder })
      .returning();

    return result;
  });

  return { ok: true, pattern };
}

export type DuplicatePatternResult =
  | { ok: true; pattern: DayPattern }
  | { ok: false; error: "pattern_limit_reached" | "schedule_limit_reached" };

// Clones `source` (with its schedules) into a new pattern on the same day.
// Enforces BOTH the per-day pattern cap and the per-trip schedule cap — the
// latter was missing from the original inline implementation (only overwrite
// checked it), which let duplicate silently push a trip over MAX_SCHEDULES_PER_TRIP.
export async function duplicateDayPatternCore(
  tripId: string,
  tripDayId: string,
  source: { label: string; schedules: CloneableSchedule[] },
): Promise<DuplicatePatternResult> {
  const [patternCountRow, scheduleCount] = await Promise.all([
    db.select({ count: count() }).from(dayPatterns).where(eq(dayPatterns.tripDayId, tripDayId)),
    getScheduleCount(db, tripId),
  ]);
  if (patternCountRow[0].count >= MAX_PATTERNS_PER_DAY) {
    return { ok: false, error: "pattern_limit_reached" };
  }
  if (scheduleCount + source.schedules.length > MAX_SCHEDULES_PER_TRIP) {
    return { ok: false, error: "schedule_limit_reached" };
  }

  const pattern = await db.transaction(async (tx) => {
    const nextOrder = await getNextSortOrder(
      tx,
      dayPatterns.sortOrder,
      dayPatterns,
      eq(dayPatterns.tripDayId, tripDayId),
      `pattern:day:${tripDayId}`,
    );

    const [newPattern] = await tx
      .insert(dayPatterns)
      .values({
        tripDayId,
        label: `${source.label} (copy)`,
        isDefault: false,
        sortOrder: nextOrder,
      })
      .returning();

    if (source.schedules.length > 0) {
      await tx.insert(schedules).values(
        source.schedules.map((schedule) => ({
          tripId,
          dayPatternId: newPattern.id,
          ...buildScheduleCloneValues(schedule),
        })),
      );
    }

    return newPattern;
  });

  return { ok: true, pattern };
}

export type OverwritePatternResult = { ok: true } | { ok: false; error: "schedule_limit_reached" };

// Replaces all schedules under `targetPatternId` with clones of `source.schedules`.
export async function overwriteDayPatternCore(
  tripId: string,
  targetPatternId: string,
  source: { schedules: CloneableSchedule[] },
): Promise<OverwritePatternResult> {
  return db.transaction(async (tx) => {
    // Schedule limit: totalCount includes target's own schedules, subtract them
    // before adding source's so a same-size overwrite never false-positives.
    const totalCount = await getScheduleCount(tx, tripId);
    const [{ count: targetCount }] = await tx
      .select({ count: count() })
      .from(schedules)
      .where(eq(schedules.dayPatternId, targetPatternId));
    if (totalCount - targetCount + source.schedules.length > MAX_SCHEDULES_PER_TRIP) {
      return { ok: false, error: "schedule_limit_reached" };
    }

    await tx.delete(schedules).where(eq(schedules.dayPatternId, targetPatternId));

    if (source.schedules.length > 0) {
      await tx.insert(schedules).values(
        source.schedules.map((schedule) => ({
          tripId,
          dayPatternId: targetPatternId,
          ...buildScheduleCloneValues(schedule),
        })),
      );
    }

    return { ok: true };
  });
}
