import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSelectWhere, mockDeleteReturning, mockDeleteCoverImages } = vi.hoisted(() => ({
  mockSelectWhere: vi.fn(),
  mockDeleteReturning: vi.fn(),
  mockDeleteCoverImages: vi.fn(),
}));

vi.mock("../db/index", () => ({
  db: {
    select: () => ({
      from: () => ({
        innerJoin: () => ({ where: (...args: unknown[]) => mockSelectWhere(...args) }),
      }),
    }),
    delete: () => ({
      where: () => ({ returning: (...args: unknown[]) => mockDeleteReturning(...args) }),
    }),
  },
}));

vi.mock("../lib/storage", () => ({
  deleteCoverImages: (...args: unknown[]) => mockDeleteCoverImages(...args),
}));

import { deleteExpiredGuests } from "../lib/cleanup-guests";

describe("deleteExpiredGuests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDeleteCoverImages.mockResolvedValue(undefined);
    mockSelectWhere.mockResolvedValue([
      { ownerId: "guest-1", url: "https://x/trip-covers/t1/1.jpg" },
      { ownerId: "guest-2", url: "https://x/trip-covers/t2/2.jpg" },
    ]);
    mockDeleteReturning.mockResolvedValue([{ id: "guest-1" }, { id: "guest-2" }]);
  });

  it("returns the number of deleted guests", async () => {
    expect(await deleteExpiredGuests()).toBe(2);
  });

  it("deletes the cover images of trips owned by the deleted guests", async () => {
    await deleteExpiredGuests();

    expect(mockDeleteCoverImages).toHaveBeenCalledExactlyOnceWith([
      "https://x/trip-covers/t1/1.jpg",
      "https://x/trip-covers/t2/2.jpg",
    ]);
  });

  it("deletes only the images of guests that were actually removed", async () => {
    mockDeleteReturning.mockResolvedValue([{ id: "guest-1" }]);

    await deleteExpiredGuests();

    expect(mockDeleteCoverImages).toHaveBeenCalledExactlyOnceWith([
      "https://x/trip-covers/t1/1.jpg",
    ]);
  });

  it("does not touch Storage when the DB deletion fails", async () => {
    mockDeleteReturning.mockRejectedValue(new Error("db down"));

    await expect(deleteExpiredGuests()).rejects.toThrow("db down");
    expect(mockDeleteCoverImages).not.toHaveBeenCalled();
  });

  it("does not call Storage when no deleted guest owned a cover image", async () => {
    mockSelectWhere.mockResolvedValue([]);

    await deleteExpiredGuests();

    expect(mockDeleteCoverImages).not.toHaveBeenCalled();
  });
});
