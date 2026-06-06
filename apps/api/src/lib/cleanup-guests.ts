import { and, eq, lt } from "drizzle-orm";
import { db } from "../db/index";
import { users } from "../db/schema";

// Delete guest (anonymous) accounts whose TTL has elapsed. Returns the number of
// rows removed. Shared by the `db:cleanup-guests` CLI script and the Vercel Cron
// route so both paths apply identical deletion semantics.
export async function deleteExpiredGuests(now: Date = new Date()): Promise<number> {
  const deleted = await db
    .delete(users)
    .where(and(eq(users.isAnonymous, true), lt(users.guestExpiresAt, now)))
    .returning({ id: users.id });
  return deleted.length;
}
