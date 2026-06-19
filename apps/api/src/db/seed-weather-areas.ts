import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { seedState, weatherAreas } from "./schema";
import { WEATHER_AREAS } from "./weather-areas-data";

// Prefer MIGRATION_URL (direct connection) for DDL operations during build.
// Falls back to DATABASE_URL for local development.
const url =
  process.env.MIGRATION_URL ||
  process.env.DATABASE_URL ||
  "postgresql://postgres:postgres@127.0.0.1:55322/postgres";

const isLocalhost = url.includes("localhost") || url.includes("127.0.0.1");
const client = postgres(url, { ssl: isLocalhost ? false : "require", max: 1 });
const db = drizzle(client);

const SEED_KEY = "weather-areas";
const contentHash = createHash("sha256").update(JSON.stringify(WEATHER_AREAS)).digest("hex");

async function main() {
  const existing = await db.select().from(seedState).where(eq(seedState.key, SEED_KEY)).limit(1);
  if (existing[0]?.hash === contentHash) {
    console.log(`Weather areas unchanged (hash=${contentHash.slice(0, 8)}…). Skipping seed.`);
    await client.end();
    process.exit(0);
  }

  console.log("Seeding weather areas...");

  // Upsert each office so existing weather_forecasts FKs are never orphaned by a
  // delete-then-insert. Removed offices (rare) would need a manual cleanup.
  await db.transaction(async (tx) => {
    for (const area of WEATHER_AREAS) {
      await tx
        .insert(weatherAreas)
        .values(area)
        .onConflictDoUpdate({
          target: weatherAreas.officeCode,
          set: {
            name: area.name,
            centerCode: area.centerCode,
            centerName: area.centerName,
            sortOrder: area.sortOrder,
            updatedAt: new Date(),
          },
        });
    }
    await tx
      .insert(seedState)
      .values({ key: SEED_KEY, hash: contentHash })
      .onConflictDoUpdate({
        target: seedState.key,
        set: { hash: contentHash, appliedAt: new Date() },
      });
  });

  console.log(`Upserted ${WEATHER_AREAS.length} weather areas (hash=${contentHash.slice(0, 8)}…).`);
  await client.end();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
