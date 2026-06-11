import { STATUS_LABELS, type updateTripSchema } from "@sugara/shared";
import { count, eq } from "drizzle-orm";
import type { z } from "zod";
import { db } from "../db/index";
import { expenses, trips } from "../db/schema";
import { logActivity } from "./activity-logger";
import { generateDateRange, syncTripDays } from "./trip-days";

// Re-export for consumers who need the raw type (e.g. v1 adapter).
export type UpdateTripInput = z.infer<typeof updateTripSchema>;

type TripRow = typeof trips.$inferSelect;

export type UpdateTripResult =
  | { ok: true; trip: TripRow }
  | { ok: false; error: "not_found" }
  | { ok: false; error: "date_order" }
  | { ok: false; error: "days_reduced" }
  | { ok: false; error: "has_expenses" }
  | { ok: false; error: "conflict" };

/**
 * Core business logic for updating a trip.
 * Performs date validation, currency-change guard, and date-range sync.
 * HTTP concerns (auth, param parsing, response mapping) stay in the route layer.
 */
export async function updateTripCore(
  tripId: string,
  userId: string,
  input: UpdateTripInput,
): Promise<UpdateTripResult> {
  const { startDate: newStart, endDate: newEnd, ...otherFields } = input;

  const currentTrip = await db.query.trips.findFirst({
    where: eq(trips.id, tripId),
  });
  if (!currentTrip) {
    return { ok: false, error: "not_found" };
  }

  const effectiveStart = newStart ?? currentTrip.startDate;
  const effectiveEnd = newEnd ?? currentTrip.endDate;
  const datesChanged =
    effectiveStart !== currentTrip.startDate || effectiveEnd !== currentTrip.endDate;

  if (datesChanged) {
    // Validate cross-field constraint when only one date is sent
    if (effectiveStart && effectiveEnd && effectiveEnd < effectiveStart) {
      return { ok: false, error: "date_order" };
    }

    // Reject date changes that reduce the number of days
    if (effectiveStart && effectiveEnd && currentTrip.startDate && currentTrip.endDate) {
      const currentDayCount = generateDateRange(currentTrip.startDate, currentTrip.endDate).length;
      const newDayCount = generateDateRange(effectiveStart, effectiveEnd).length;
      if (newDayCount < currentDayCount) {
        return { ok: false, error: "days_reduced" };
      }
    }
  }

  // Build update payload with only changed fields
  const updatePayload: Partial<typeof trips.$inferInsert> = {};
  if (otherFields.title !== undefined && otherFields.title !== currentTrip.title) {
    updatePayload.title = otherFields.title;
  }
  if (
    otherFields.destination !== undefined &&
    otherFields.destination !== currentTrip.destination
  ) {
    updatePayload.destination = otherFields.destination;
  }
  if (otherFields.status !== undefined && otherFields.status !== currentTrip.status) {
    updatePayload.status = otherFields.status;
  }
  if (
    otherFields.coverImageUrl !== undefined &&
    otherFields.coverImageUrl !== currentTrip.coverImageUrl
  ) {
    updatePayload.coverImageUrl = otherFields.coverImageUrl;
  }
  if (
    otherFields.coverImagePosition !== undefined &&
    otherFields.coverImagePosition !== currentTrip.coverImagePosition
  ) {
    updatePayload.coverImagePosition = otherFields.coverImagePosition;
  }
  if (
    otherFields.currency !== undefined &&
    // Compare as string — CurrencyCode extends string; no cast needed.
    otherFields.currency !== currentTrip.currency
  ) {
    // Reject currency change when trip already has expenses (amounts are in minor units)
    const [{ count: expenseCount }] = await db
      .select({ count: count() })
      .from(expenses)
      .where(eq(expenses.tripId, tripId));
    if (expenseCount > 0) {
      return { ok: false, error: "has_expenses" };
    }
    updatePayload.currency = otherFields.currency;
  }
  if (datesChanged) {
    if (effectiveStart !== currentTrip.startDate) updatePayload.startDate = effectiveStart;
    if (effectiveEnd !== currentTrip.endDate) updatePayload.endDate = effectiveEnd;
  }

  if (Object.keys(updatePayload).length === 0) {
    return { ok: true, trip: currentTrip };
  }

  let updated: TripRow | null | undefined;

  if (datesChanged && effectiveStart && effectiveEnd) {
    updated = await db.transaction(async (tx) => {
      // Re-verify trip dates inside transaction to prevent TOCTOU
      const current = await tx.query.trips.findFirst({
        where: eq(trips.id, tripId),
        columns: { startDate: true, endDate: true },
      });
      if (
        current?.startDate !== currentTrip.startDate ||
        current?.endDate !== currentTrip.endDate
      ) {
        return null;
      }
      await syncTripDays(tx, tripId, effectiveStart, effectiveEnd);
      const [result] = await tx
        .update(trips)
        .set({ ...updatePayload, updatedAt: new Date() })
        .where(eq(trips.id, tripId))
        .returning();
      return result;
    });

    if (!updated) {
      return { ok: false, error: "conflict" };
    }
  } else {
    const [result] = await db
      .update(trips)
      .set({ ...updatePayload, updatedAt: new Date() })
      .where(eq(trips.id, tripId))
      .returning();
    updated = result;

    if (!updated) {
      return { ok: false, error: "not_found" };
    }
  }

  logActivity({
    tripId,
    userId,
    action: "updated",
    entityType: "trip",
    entityName: updated.title,
    detail: updatePayload.status ? `ステータス: ${STATUS_LABELS[updatePayload.status]}` : undefined,
  });

  return { ok: true, trip: updated };
}
