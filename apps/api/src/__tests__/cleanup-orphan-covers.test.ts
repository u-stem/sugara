import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockListObjects, mockRemovePaths, mockSelectWhere } = vi.hoisted(() => ({
  mockListObjects: vi.fn(),
  mockRemovePaths: vi.fn(),
  mockSelectWhere: vi.fn(),
}));

vi.mock("../lib/storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/storage")>();
  return {
    ...actual,
    listCoverImageObjects: (...args: unknown[]) => mockListObjects(...args),
    removeCoverImagePaths: (...args: unknown[]) => mockRemovePaths(...args),
  };
});

vi.mock("../db/index", () => ({
  db: {
    select: () => ({ from: () => ({ where: (...args: unknown[]) => mockSelectWhere(...args) }) }),
  },
}));

import { cleanupOrphanedCoverImages } from "../lib/cleanup-orphan-covers";

const NOW = new Date("2026-06-01T12:00:00.000Z");
const OLD = new Date("2026-06-01T08:00:00.000Z");
const RECENT = new Date("2026-06-01T11:30:00.000Z");
const urlOf = (path: string) =>
  `https://xxx.supabase.co/storage/v1/object/public/trip-covers/${path}`;

describe("cleanupOrphanedCoverImages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRemovePaths.mockResolvedValue(undefined);
    mockSelectWhere.mockResolvedValue([{ url: urlOf("trip-1/ref.jpg") }]);
    mockListObjects.mockResolvedValue([
      { path: "trip-1/ref.jpg", createdAt: OLD },
      { path: "trip-gone/orphan.jpg", createdAt: OLD },
      { path: "trip-new/fresh.jpg", createdAt: RECENT },
      { path: "trip-x/unknown-age.jpg", createdAt: null },
    ]);
  });

  it("reports old unreferenced objects as orphans", async () => {
    const result = await cleanupOrphanedCoverImages({ apply: false, now: NOW });

    expect(result.orphans).toEqual(["trip-gone/orphan.jpg"]);
  });

  it("does not report objects still referenced by a trip", async () => {
    const result = await cleanupOrphanedCoverImages({ apply: false, now: NOW });

    expect(result.orphans).not.toContain("trip-1/ref.jpg");
  });

  it("does not report objects created within the last hour", async () => {
    const result = await cleanupOrphanedCoverImages({ apply: true, now: NOW });

    expect(result.orphans).not.toContain("trip-new/fresh.jpg");
  });

  it("does not report objects whose creation time is unknown", async () => {
    const result = await cleanupOrphanedCoverImages({ apply: true, now: NOW });

    expect(result.orphans).not.toContain("trip-x/unknown-age.jpg");
  });

  it("does not delete anything in dry-run mode", async () => {
    await cleanupOrphanedCoverImages({ apply: false, now: NOW });

    expect(mockRemovePaths).not.toHaveBeenCalled();
  });

  it("reports zero deletions in dry-run mode", async () => {
    const result = await cleanupOrphanedCoverImages({ apply: false, now: NOW });

    expect(result.deleted).toBe(0);
  });

  it("deletes only the orphans when apply is set", async () => {
    await cleanupOrphanedCoverImages({ apply: true, now: NOW });

    expect(mockRemovePaths).toHaveBeenCalledExactlyOnceWith(["trip-gone/orphan.jpg"]);
  });

  it("does not call remove when there are no orphans", async () => {
    mockListObjects.mockResolvedValue([{ path: "trip-1/ref.jpg", createdAt: OLD }]);

    await cleanupOrphanedCoverImages({ apply: true, now: NOW });

    expect(mockRemovePaths).not.toHaveBeenCalled();
  });

  it("lists Storage before reading trip references so a concurrent upload is never missed", async () => {
    await cleanupOrphanedCoverImages({ apply: false, now: NOW });

    expect(mockListObjects.mock.invocationCallOrder[0]).toBeLessThan(
      mockSelectWhere.mock.invocationCallOrder[0],
    );
  });
});

describe("cleanupOrphanedCoverImages safety guards", () => {
  const objectsWith = (orphanCount: number, referencedCount: number) => [
    ...Array.from({ length: orphanCount }, (_, i) => ({ path: `gone/${i}.jpg`, createdAt: OLD })),
    ...Array.from({ length: referencedCount }, (_, i) => ({
      path: `live/${i}.jpg`,
      createdAt: OLD,
    })),
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockRemovePaths.mockResolvedValue(undefined);
    mockSelectWhere.mockResolvedValue(
      Array.from({ length: 10 }, (_, i) => ({ url: urlOf(`live/${i}.jpg`) })),
    );
  });

  it("refuses to apply when orphans exceed 50% of eligible objects", async () => {
    mockListObjects.mockResolvedValue(objectsWith(3, 1));

    await expect(cleanupOrphanedCoverImages({ apply: true, now: NOW })).rejects.toThrow(/50%/);
  });

  it("deletes nothing when the ratio guard trips", async () => {
    mockListObjects.mockResolvedValue(objectsWith(3, 1));

    await cleanupOrphanedCoverImages({ apply: true, now: NOW }).catch(() => undefined);

    expect(mockRemovePaths).not.toHaveBeenCalled();
  });

  it("allows apply at exactly 50% orphans", async () => {
    mockListObjects.mockResolvedValue(objectsWith(1, 1));

    const result = await cleanupOrphanedCoverImages({ apply: true, now: NOW });

    expect(result.deleted).toBe(1);
  });

  it("excludes recent objects from the ratio denominator", async () => {
    mockListObjects.mockResolvedValue([
      ...objectsWith(1, 3),
      ...Array.from({ length: 20 }, (_, i) => ({ path: `new/${i}.jpg`, createdAt: RECENT })),
    ]);

    const result = await cleanupOrphanedCoverImages({ apply: true, now: NOW });

    expect(result.deleted).toBe(1);
  });

  it("refuses to apply when no trip references any cover image but objects exist", async () => {
    mockSelectWhere.mockResolvedValue([]);
    mockListObjects.mockResolvedValue(objectsWith(1, 0));

    await expect(cleanupOrphanedCoverImages({ apply: true, now: NOW })).rejects.toThrow(
      /no trip references/,
    );
  });

  it("still reports orphans in dry-run when the guards would trip", async () => {
    mockSelectWhere.mockResolvedValue([]);
    mockListObjects.mockResolvedValue(objectsWith(2, 0));

    const result = await cleanupOrphanedCoverImages({ apply: false, now: NOW });

    expect(result.orphans).toHaveLength(2);
  });

  it("bypasses the ratio guard with force", async () => {
    mockListObjects.mockResolvedValue(objectsWith(3, 1));

    const result = await cleanupOrphanedCoverImages({ apply: true, force: true, now: NOW });

    expect(result.deleted).toBe(3);
  });

  it("bypasses the zero-reference guard with force", async () => {
    mockSelectWhere.mockResolvedValue([]);
    mockListObjects.mockResolvedValue(objectsWith(2, 0));

    const result = await cleanupOrphanedCoverImages({ apply: true, force: true, now: NOW });

    expect(result.deleted).toBe(2);
  });

  it("allows apply on an empty bucket with no references", async () => {
    mockSelectWhere.mockResolvedValue([]);
    mockListObjects.mockResolvedValue([]);

    const result = await cleanupOrphanedCoverImages({ apply: true, now: NOW });

    expect(result.deleted).toBe(0);
  });
});
