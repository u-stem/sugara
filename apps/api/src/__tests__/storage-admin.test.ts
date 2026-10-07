import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockList, mockRemove, mockLoggerError } = vi.hoisted(() => ({
  mockList: vi.fn(),
  mockRemove: vi.fn(),
  mockLoggerError: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    storage: {
      from: () => ({
        list: (...args: unknown[]) => mockList(...args),
        remove: (...args: unknown[]) => mockRemove(...args),
      }),
    },
  }),
}));

vi.mock("../lib/logger", () => ({
  logger: { error: (...args: unknown[]) => mockLoggerError(...args), info: vi.fn() },
}));

process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";

import { deleteCoverImages, listCoverImageObjects, removeCoverImagePaths } from "../lib/storage";

const urlOf = (path: string) =>
  `https://xxx.supabase.co/storage/v1/object/public/trip-covers/${path}`;

function fileEntry(name: string, createdAt = "2026-01-01T00:00:00.000Z") {
  return { name, id: `id-${name}`, created_at: createdAt };
}

function folderEntry(name: string) {
  return { name, id: null, created_at: null };
}

describe("deleteCoverImages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRemove.mockResolvedValue({ data: [], error: null });
  });

  it("removes the storage paths extracted from the URLs in one call", async () => {
    await deleteCoverImages([urlOf("trip-1/1.jpg"), urlOf("trip-2/2.png")]);

    expect(mockRemove).toHaveBeenCalledExactlyOnceWith(["trip-1/1.jpg", "trip-2/2.png"]);
  });

  it("does not call Storage when no URL belongs to the bucket", async () => {
    await deleteCoverImages(["https://evil.com/a.jpg"]);

    expect(mockRemove).not.toHaveBeenCalled();
  });

  it("does not throw when Storage returns an error", async () => {
    mockRemove.mockResolvedValue({ data: null, error: { message: "boom" } });

    await expect(deleteCoverImages([urlOf("trip-1/1.jpg")])).resolves.toBeUndefined();
  });

  it("logs the failure when Storage returns an error", async () => {
    mockRemove.mockResolvedValue({ data: null, error: { message: "boom" } });

    await deleteCoverImages([urlOf("trip-1/1.jpg")]);

    expect(mockLoggerError).toHaveBeenCalledOnce();
  });

  it("does not throw when the Storage call itself rejects", async () => {
    mockRemove.mockRejectedValue(new Error("network down"));

    await expect(deleteCoverImages([urlOf("trip-1/1.jpg")])).resolves.toBeUndefined();
  });

  it("splits large batches into chunks of 100 paths", async () => {
    const urls = Array.from({ length: 250 }, (_, i) => urlOf(`trip-1/${i}.jpg`));

    await deleteCoverImages(urls);

    expect(mockRemove).toHaveBeenCalledTimes(3);
  });
});

describe("removeCoverImagePaths", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws when Storage returns an error so the caller can abort", async () => {
    mockRemove.mockResolvedValue({ data: null, error: { message: "boom" } });

    await expect(removeCoverImagePaths(["trip-1/1.jpg"])).rejects.toThrow("boom");
  });
});

describe("listCoverImageObjects", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("walks into folders and returns full object paths", async () => {
    mockList.mockImplementation(async (prefix: string) => ({
      data: prefix === "" ? [folderEntry("trip-1")] : [fileEntry("1.jpg")],
      error: null,
    }));

    const objects = await listCoverImageObjects();

    expect(objects.map((o) => o.path)).toEqual(["trip-1/1.jpg"]);
  });

  it("parses created_at into a Date", async () => {
    mockList.mockImplementation(async (prefix: string) => ({
      data:
        prefix === "" ? [folderEntry("trip-1")] : [fileEntry("1.jpg", "2026-02-03T04:05:06.000Z")],
      error: null,
    }));

    const objects = await listCoverImageObjects();

    expect(objects[0].createdAt).toEqual(new Date("2026-02-03T04:05:06.000Z"));
  });

  it("follows pagination until a short page is returned", async () => {
    const fullPage = Array.from({ length: 100 }, (_, i) => fileEntry(`${i}.jpg`));
    mockList.mockImplementation(async (_prefix: string, options: { offset: number }) => ({
      data: options.offset === 0 ? fullPage : [fileEntry("last.jpg")],
      error: null,
    }));

    const objects = await listCoverImageObjects();

    expect(objects).toHaveLength(101);
  });

  it("throws when listing fails so a partial listing is never treated as complete", async () => {
    mockList.mockResolvedValue({ data: null, error: { message: "list failed" } });

    await expect(listCoverImageObjects()).rejects.toThrow("list failed");
  });
});
