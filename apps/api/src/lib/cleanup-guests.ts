import { and, eq, isNotNull, lt } from "drizzle-orm";
import { db } from "../db/index";
import { trips, users } from "../db/schema";
import { deleteCoverImages } from "./storage";

// Delete guest (anonymous) accounts whose TTL has elapsed. Returns the number of
// rows removed. Shared by the `db:cleanup-guests` CLI script and the Vercel Cron
// route so both paths apply identical deletion semantics.
export async function deleteExpiredGuests(now: Date = new Date()): Promise<number> {
  const expired = and(eq(users.isAnonymous, true), lt(users.guestExpiresAt, now));

  // Collect cover URLs before the delete: the trips rows (and their URLs) disappear
  // through the trips.owner_id cascade, after which Storage objects would be orphaned.
  const covers = await db
    .select({ ownerId: trips.ownerId, url: trips.coverImageUrl })
    .from(trips)
    .innerJoin(users, eq(trips.ownerId, users.id))
    .where(and(expired, isNotNull(trips.coverImageUrl)));

  const deleted = await db.delete(users).where(expired).returning({ id: users.id });

  // Storage is cleaned only after the DB delete succeeded and is best-effort: a
  // Storage failure must not undo the deletion, and leftover objects are reclaimed
  // by the `db:cleanup-orphan-covers` sweep. Restricting to the ids actually
  // deleted guards against a guest whose TTL was extended after the first query.
  const deletedIds = new Set(deleted.map((row) => row.id));
  const urls = covers.flatMap((row) => (row.url && deletedIds.has(row.ownerId) ? [row.url] : []));
  if (urls.length > 0) {
    await deleteCoverImages(urls);
  }

  return deleted.length;
}
