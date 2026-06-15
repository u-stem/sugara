// Shared core for creating a candidate (a schedule row with dayPatternId = NULL).
//
// Used by both the internal route (apps/api/src/routes/candidates.ts) and the v1
// external route (apps/api/src/routes/v1/candidates-write.ts) so the limit check,
// advisory-lock sortOrder assignment, and anchor-stripping stay single-sourced.
// Side effects (activity logging, member notifications) remain in the route layer
// because the actor name is resolved differently per surface.

import { type createScheduleSchema, MAX_SCHEDULES_PER_TRIP } from "@sugara/shared";
import { and, eq, isNull, sql } from "drizzle-orm";
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

export type BatchCreateCandidatesResult = {
  created: Schedule[];
  skipped: { name: string; reason: "duplicate" | "limit_reached" }[];
};

// Inserts multiple candidates in a single transaction.
//
// Advisory lock (`schedule:candidates:<tripId>`) is acquired once at transaction
// start, serializing concurrent single-create and batch-create calls that share
// the same lock scope. sortOrder values are allocated in-memory from the current
// MAX so only one MAX query is needed regardless of batch size.
//
// When onConflict is "skip", each item is checked against:
//   - existing schedule names in the trip (trip-wide, trimmed + lowercased)
//   - names seen earlier in the same batch (in-batch dedup)
// Items that exceed the per-trip limit are pushed to `skipped` with
// reason "limit_reached"; items not yet at the limit always succeed.
export async function batchCreateCandidatesCore(
  tripId: string,
  items: CreateCandidateInput[],
  onConflict: "create" | "skip",
): Promise<BatchCreateCandidatesResult> {
  return db.transaction(async (tx) => {
    const lockScope = `schedule:candidates:${tripId}`;
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${lockScope}))`);

    const scheduleCount = await getScheduleCount(tx, tripId);

    // Collect existing names once for trip-wide dedup (only when needed).
    const existingNamesLower = new Set<string>();
    if (onConflict === "skip") {
      const rows = await tx
        .select({ name: schedules.name })
        .from(schedules)
        .where(eq(schedules.tripId, tripId));
      for (const row of rows) {
        existingNamesLower.add(row.name.trim().toLowerCase());
      }
    }

    // Get current max sortOrder for candidates (dayPatternId IS NULL) once,
    // then increment in-memory — avoids N advisory lock acquisitions.
    const [maxResult] = await tx
      .select({ maxOrder: sql<number>`COALESCE(MAX(${schedules.sortOrder}), -1)` })
      .from(schedules)
      .where(and(eq(schedules.tripId, tripId), isNull(schedules.dayPatternId)));
    let nextSortOrder = maxResult.maxOrder + 1;

    const created: Schedule[] = [];
    const skipped: { name: string; reason: "duplicate" | "limit_reached" }[] = [];
    const seenNamesLower = new Set<string>();

    for (const item of items) {
      // Limit: count pre-existing schedules + those created in this batch.
      if (scheduleCount + created.length >= MAX_SCHEDULES_PER_TRIP) {
        skipped.push({ name: item.name, reason: "limit_reached" });
        continue;
      }

      if (onConflict === "skip") {
        const nameLower = item.name.trim().toLowerCase();
        if (existingNamesLower.has(nameLower) || seenNamesLower.has(nameLower)) {
          skipped.push({ name: item.name, reason: "duplicate" });
          continue;
        }
        seenNamesLower.add(nameLower);
      }

      // Strip anchor fields — candidates have no day-pattern context.
      const { crossDayAnchor: _a, crossDayAnchorSourceId: _s, ...createData } = item;

      const [row] = await tx
        .insert(schedules)
        .values({ tripId, ...createData, sortOrder: nextSortOrder })
        .returning();

      // A successful INSERT with RETURNING always returns a row; guard is for type safety.
      if (row === undefined) {
        throw new Error(`unexpected: insert returned no row for candidate "${item.name}"`);
      }

      created.push(row);
      nextSortOrder += 1;
    }

    return { created, skipped };
  });
}
