import { and, eq, or } from "drizzle-orm";
import { db } from "../db/index";
import { friends } from "../db/schema";

// True when an accepted friendship exists between the two users (direction-agnostic).
export async function areFriends(userA: string, userB: string): Promise<boolean> {
  const record = await db.query.friends.findFirst({
    where: and(
      eq(friends.status, "accepted"),
      or(
        and(eq(friends.requesterId, userA), eq(friends.addresseeId, userB)),
        and(eq(friends.requesterId, userB), eq(friends.addresseeId, userA)),
      ),
    ),
    columns: { id: true },
  });
  return !!record;
}
