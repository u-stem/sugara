import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { faqs, seedState } from "./schema";
import { FAQ_ITEMS } from "./seed-faqs-data";

// Prefer MIGRATION_URL (direct connection) for DDL operations during build.
// Falls back to DATABASE_URL for local development.
const url =
  process.env.MIGRATION_URL ||
  process.env.DATABASE_URL ||
  "postgresql://postgres:postgres@127.0.0.1:55322/postgres";

const isLocalhost = url.includes("localhost") || url.includes("127.0.0.1");
const client = postgres(url, { ssl: isLocalhost ? false : "require", max: 1 });
const db = drizzle(client);

const SEED_KEY = "faqs";
const contentHash = createHash("sha256").update(JSON.stringify(FAQ_ITEMS)).digest("hex");

async function main() {
  // `drizzle(client)` is created without a schema, so `db.query.*` isn't available here.
  // The plain `select().from().where()` builder works regardless.
  const existing = await db.select().from(seedState).where(eq(seedState.key, SEED_KEY)).limit(1);
  if (existing[0]?.hash === contentHash) {
    console.log(`FAQ content unchanged (hash=${contentHash.slice(0, 8)}…). Skipping seed.`);
    await client.end();
    process.exit(0);
  }

  console.log("Seeding FAQs...");

  // Wrap delete+insert+hash update in a transaction so readers never see an empty FAQ table
  // and so the hash only lands if the rewrite succeeds.
  await db.transaction(async (tx) => {
    await tx.delete(faqs);
    await tx.insert(faqs).values(FAQ_ITEMS);
    await tx
      .insert(seedState)
      .values({ key: SEED_KEY, hash: contentHash })
      .onConflictDoUpdate({
        target: seedState.key,
        set: { hash: contentHash, appliedAt: new Date() },
      });
  });

  console.log(`Inserted ${FAQ_ITEMS.length} FAQ items (hash=${contentHash.slice(0, 8)}…).`);
  await client.end();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
