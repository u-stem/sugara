import type { SQL } from "drizzle-orm";
import { sql } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";

import type { db } from "../db/index";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type QueryExecutor = typeof db | Transaction;

// Serializes concurrent sort-order assignment within one parent scope. Two
// transactions inserting into the same scope could otherwise read the same
// COALESCE(MAX)+1 under READ COMMITTED and assign a duplicate sortOrder (#146).
// A transaction-scoped advisory lock (released at COMMIT) makes the
// read-then-insert atomic per scope without a UNIQUE constraint — which would
// conflict with the dense-renumber reorder path. The lock only spans the
// caller's write when dbOrTx is a transaction, so EVERY insert/update call site
// that derives its value here must run inside db.transaction.
export async function getNextSortOrder(
  dbOrTx: QueryExecutor,
  column: PgColumn,
  table: PgTable,
  condition: SQL | undefined,
  lockScope: string,
): Promise<number> {
  await dbOrTx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${lockScope}))`);
  const [result] = await dbOrTx
    .select({ max: sql<number>`COALESCE(MAX(${column}), -1)` })
    .from(table)
    .where(condition);
  return result.max + 1;
}
