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
