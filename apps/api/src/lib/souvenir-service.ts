// Shared core for batch-creating souvenir items (a souvenirItems row).
//
// Extracted from the v1 souvenir write route so the limit check, dedup logic,
// and insert loop stay single-sourced. Side effects (activity logging, member
// notification, serialization) remain in the route layer.
//
// Unlike candidates, souvenirs have no sortOrder, so no advisory lock is needed.
// Dedup scope is per-user per-trip (the caller's own items only), matching the
// internal souvenir route's uniqueness semantics.
//
// Limit check is non-locking (READ COMMITTED): like the single-create route's
// acknowledged benign race, two concurrent batches can both read the same count
// and exceed the cap — but a batch amplifies the overshoot by up to batch_size
// items. The cap is a soft per-user constraint, so this is accepted rather than
// guarded with an advisory lock.

import { type CreateSouvenirInput, MAX_SOUVENIRS_PER_USER_PER_TRIP } from "@sugara/shared";
import { and, count, eq } from "drizzle-orm";
import { db } from "../db/index";
import { souvenirItems } from "../db/schema";

type SouvenirItem = typeof souvenirItems.$inferSelect;

export type BatchCreateSouvenirsResult = {
  created: SouvenirItem[];
  skipped: { name: string; reason: "duplicate" | "limit_reached" }[];
};

// Inserts multiple souvenir items in a single transaction.
//
// When onConflict is "skip", each item is checked against:
//   - existing souvenir names owned by the caller in the trip (trimmed + lowercased)
//   - names seen earlier in the same batch (in-batch dedup)
// Items that exceed the per-user per-trip limit are pushed to `skipped` with
// reason "limit_reached"; items not yet at the limit always succeed.
//
// shareStyle is cleared when isShared is not true, mirroring the single-create
// route's semantics so the batch endpoint behaves consistently.
export async function batchCreateSouvenirsCore(
  tripId: string,
  userId: string,
  items: CreateSouvenirInput[],
  onConflict: "create" | "skip",
): Promise<BatchCreateSouvenirsResult> {
  return db.transaction(async (tx) => {
    // Current user's souvenir count for this trip.
    const [{ itemCount }] = await tx
      .select({ itemCount: count() })
      .from(souvenirItems)
      .where(and(eq(souvenirItems.tripId, tripId), eq(souvenirItems.userId, userId)));

    // Collect existing names once for dedup (caller's items only).
    const existingNamesLower = new Set<string>();
    if (onConflict === "skip") {
      const rows = await tx
        .select({ name: souvenirItems.name })
        .from(souvenirItems)
        .where(and(eq(souvenirItems.tripId, tripId), eq(souvenirItems.userId, userId)));
      for (const row of rows) {
        existingNamesLower.add(row.name.trim().toLowerCase());
      }
    }

    const created: SouvenirItem[] = [];
    const skipped: { name: string; reason: "duplicate" | "limit_reached" }[] = [];
    const seenNamesLower = new Set<string>();

    for (const item of items) {
      // Limit: count pre-existing items + those created in this batch.
      if (itemCount + created.length >= MAX_SOUVENIRS_PER_USER_PER_TRIP) {
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

      const { name, recipient, urls, addresses, memo, priority, isShared, shareStyle } = item;
      const resolvedIsShared = isShared ?? false;

      const [row] = await tx
        .insert(souvenirItems)
        .values({
          tripId,
          userId,
          name,
          recipient,
          urls,
          addresses,
          memo,
          priority,
          isShared: resolvedIsShared,
          // shareStyle is cleared when not shared — mirrors single-create semantics.
          shareStyle: resolvedIsShared ? (shareStyle ?? null) : null,
        })
        .returning();

      // A successful INSERT with RETURNING always returns a row; guard is for type safety.
      if (row === undefined) {
        throw new Error(`unexpected: insert returned no row for souvenir "${item.name}"`);
      }

      created.push(row);
    }

    return { created, skipped };
  });
}
