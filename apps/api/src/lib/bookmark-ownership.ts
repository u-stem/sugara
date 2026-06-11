import { eq } from "drizzle-orm";
import { db } from "../db/index";
import { bookmarkLists } from "../db/schema";

// Returns the bookmark list if it exists and is owned by userId, otherwise null.
// Extracted from routes/bookmarks.ts so the v1 external API can reuse the same
// ownership check without duplicating the DB query. Internal route behaviour is
// unchanged — routes/bookmarks.ts now imports this function.
export async function verifyListOwnership(listId: string, userId: string) {
  const list = await db.query.bookmarkLists.findFirst({
    where: eq(bookmarkLists.id, listId),
  });
  if (!list || list.userId !== userId) return null;
  return list;
}
