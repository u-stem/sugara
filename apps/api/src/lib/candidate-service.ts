// Shared core for creating a candidate (a schedule row with dayPatternId = NULL).
//
// Used by both the internal route (apps/api/src/routes/candidates.ts) and the v1
// external route (apps/api/src/routes/v1/candidates-write.ts) so the limit check,
// advisory-lock sortOrder assignment, and anchor-stripping stay single-sourced.
// Side effects (activity logging, member notifications) remain in the route layer
// because the actor name is resolved differently per surface.

import { type createScheduleSchema, MAX_SCHEDULES_PER_TRIP } from "@sugara/shared";
import { and, eq, isNull } from "drizzle-orm";
import type { z } from "zod";
import { db } from "../db/index";
import { schedules } from "../db/schema";
import { getScheduleCount } from "./schedule-count";
import { getNextSortOrder } from "./sort-order";

// createCandidateSchema === createScheduleSchema; the v1 variant simply omits a
// few fields, and an omitted optional property is assignable to this type.
type CreateCandidateInput = z.infer<typeof createScheduleSchema>;

type Schedule = typeof schedules.$inferSelect;

export type CreateCandidateResult =
  | { ok: true; schedule: Schedule }
  | { ok: false; error: "limit_reached" };

// Inserts a candidate inside a transaction: enforces the per-trip schedule cap,
// assigns the next sortOrder under a transaction-scoped advisory lock (#146), and
// stores the row with dayPatternId = NULL. Anchors are stripped — candidates have
// no day-pattern context, so cross-day anchoring is meaningless for them.
export async function createCandidateCore(
  tripId: string,
  input: CreateCandidateInput,
): Promise<CreateCandidateResult> {
  const schedule = await db.transaction(async (tx) => {
    const scheduleCount = await getScheduleCount(tx, tripId);
    if (scheduleCount >= MAX_SCHEDULES_PER_TRIP) {
      return null;
    }

    const nextOrder = await getNextSortOrder(
      tx,
      schedules.sortOrder,
      schedules,
      and(eq(schedules.tripId, tripId), isNull(schedules.dayPatternId)),
      `schedule:candidates:${tripId}`,
    );

    const { crossDayAnchor: _a, crossDayAnchorSourceId: _s, ...createData } = input;

    const [result] = await tx
      .insert(schedules)
      .values({
        tripId,
        ...createData,
        sortOrder: nextOrder,
      })
      .returning();

    return result;
  });

  if (!schedule) {
    return { ok: false, error: "limit_reached" };
  }
  return { ok: true, schedule };
}
