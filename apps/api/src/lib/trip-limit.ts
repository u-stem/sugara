import { MAX_TRIPS_PER_USER } from "@sugara/shared";
import { eq } from "drizzle-orm";
import type { db as dbInstance } from "../db/index";
import { users } from "../db/schema";

type Transaction = Parameters<Parameters<typeof dbInstance.transaction>[0]>[0];
type TxOrDb = typeof dbInstance | Transaction;

// Resolves the effective trip creation cap for a user.
// A per-user override (users.trip_limit) takes precedence; NULL falls back to the global default.
export async function resolveTripLimit(tx: TxOrDb, userId: string): Promise<number> {
  // users.id is the primary key, so this matches at most one row.
  const [row] = await tx
    .select({ tripLimit: users.tripLimit })
    .from(users)
    .where(eq(users.id, userId));
  return row?.tripLimit ?? MAX_TRIPS_PER_USER;
}
