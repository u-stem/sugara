import { is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import * as schema from "../db/schema";

// The anon key ships in the client bundle, so any table without RLS is readable and
// writable through Supabase's REST API. The app talks to Postgres directly (RLS-bypassing
// role), so enabling RLS without policies costs nothing and denies anon by default.
function isPgTable(value: unknown): value is PgTable {
  return is(value, PgTable);
}

const tables = Object.values(schema).flatMap((value) =>
  isPgTable(value) ? [getTableConfig(value)] : [],
);

describe("schema RLS", () => {
  it("discovers the pgTable exports", () => {
    expect(tables.length).toBeGreaterThan(0);
  });

  it.each(tables)("enables RLS on $name", ({ enableRLS }) => {
    expect(enableRLS).toBe(true);
  });
});
