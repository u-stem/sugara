import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const { mockDeleteCoverImages } = vi.hoisted(() => ({ mockDeleteCoverImages: vi.fn() }));

vi.mock("../../db/index", async () => {
  const { getTestDb } = await import("./setup");
  return { db: getTestDb() };
});

vi.mock("../../lib/storage", () => ({
  deleteCoverImages: (...args: unknown[]) => mockDeleteCoverImages(...args),
}));

import { eq } from "drizzle-orm";
import { trips, users } from "../../db/schema";
import { deleteExpiredGuests } from "../../lib/cleanup-guests";
import { cleanupTables, getTestDb, teardownTestDb } from "./setup";

const PAST = new Date("2020-01-01T00:00:00.000Z");
const FUTURE = new Date("2099-01-01T00:00:00.000Z");

async function insertUser(overrides: Partial<typeof users.$inferInsert>) {
  const [user] = await getTestDb()
    .insert(users)
    .values({
      name: "U",
      email: `u-${crypto.randomUUID().slice(0, 8)}@example.com`,
      emailVerified: false,
      ...overrides,
    })
    .returning();
  return user;
}

async function insertTrip(ownerId: string, coverImageUrl: string | null) {
  await getTestDb().insert(trips).values({ ownerId, title: "T", coverImageUrl });
}

describe("deleteExpiredGuests (integration)", () => {
  beforeEach(async () => {
    await cleanupTables();
    mockDeleteCoverImages.mockReset();
    mockDeleteCoverImages.mockResolvedValue(undefined);
  });

  afterAll(async () => {
    await teardownTestDb();
  });

  it("passes only the covers of expired guests to Storage cleanup", async () => {
    const expired = await insertUser({ isAnonymous: true, guestExpiresAt: PAST });
    const live = await insertUser({ isAnonymous: true, guestExpiresAt: FUTURE });
    const regular = await insertUser({});
    await insertTrip(expired.id, "https://x/trip-covers/expired/1.jpg");
    await insertTrip(expired.id, null);
    await insertTrip(live.id, "https://x/trip-covers/live/1.jpg");
    await insertTrip(regular.id, "https://x/trip-covers/regular/1.jpg");

    await deleteExpiredGuests();

    expect(mockDeleteCoverImages).toHaveBeenCalledExactlyOnceWith([
      "https://x/trip-covers/expired/1.jpg",
    ]);
  });

  it("cascades the expired guest's trips and leaves other users' trips", async () => {
    const expired = await insertUser({ isAnonymous: true, guestExpiresAt: PAST });
    const regular = await insertUser({});
    await insertTrip(expired.id, "https://x/trip-covers/expired/1.jpg");
    await insertTrip(regular.id, null);

    await deleteExpiredGuests();

    const remaining = await getTestDb().select({ ownerId: trips.ownerId }).from(trips);
    expect(remaining).toEqual([{ ownerId: regular.id }]);
  });

  it("deletes the expired guest row", async () => {
    const expired = await insertUser({ isAnonymous: true, guestExpiresAt: PAST });

    await deleteExpiredGuests();

    const rows = await getTestDb().select().from(users).where(eq(users.id, expired.id));
    expect(rows).toHaveLength(0);
  });
});
