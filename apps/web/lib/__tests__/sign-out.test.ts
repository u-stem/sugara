import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockAuthSignOut = vi.fn();
const mockRemoveClient = vi.fn();
const mockReportError = vi.fn();

vi.mock("@/lib/auth-client", () => ({
  authClient: { signOut: (...args: unknown[]) => mockAuthSignOut(...args) },
}));

vi.mock("@/lib/idb-persister", () => ({
  createIdbPersister: () => ({ removeClient: () => mockRemoveClient() }),
}));

vi.mock("@/lib/report-error", () => ({
  reportError: (...args: unknown[]) => mockReportError(...args),
}));

import { clearClientCache, signOutAndClearClientCache } from "../sign-out";

const AUTH_SCOPED_SW_CACHES = [
  "navigations",
  "pages",
  "pages-rsc",
  "pages-rsc-prefetch",
  "next-data",
  "others",
  "apis",
];

function setupCachesStub() {
  const deleted: string[] = [];
  vi.stubGlobal("caches", {
    delete: vi.fn(async (name: string) => {
      deleted.push(name);
      return true;
    }),
  });
  return deleted;
}

function createSeededQueryClient() {
  const queryClient = new QueryClient();
  queryClient.setQueryData(["trips", "owned"], [{ id: "t1", title: "Secret trip" }]);
  return queryClient;
}

describe("signOutAndClearClientCache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthSignOut.mockResolvedValue({ data: { success: true }, error: null });
    mockRemoveClient.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("calls Better Auth signOut", async () => {
    setupCachesStub();

    await signOutAndClearClientCache(createSeededQueryClient());

    expect(mockAuthSignOut).toHaveBeenCalledTimes(1);
  });

  it("clears the in-memory query cache", async () => {
    setupCachesStub();
    const queryClient = createSeededQueryClient();

    await signOutAndClearClientCache(queryClient);

    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
  });

  it("removes the persisted query cache from IndexedDB", async () => {
    setupCachesStub();

    await signOutAndClearClientCache(createSeededQueryClient());

    expect(mockRemoveClient).toHaveBeenCalledTimes(1);
  });

  it("deletes the auth-scoped Service Worker caches", async () => {
    const deleted = setupCachesStub();

    await signOutAndClearClientCache(createSeededQueryClient());

    expect([...deleted].sort()).toEqual([...AUTH_SCOPED_SW_CACHES].sort());
  });

  it("keeps the precache that backs the offline page", async () => {
    const deleted = setupCachesStub();

    await signOutAndClearClientCache(createSeededQueryClient());

    expect(deleted.some((name) => name.includes("precache"))).toBe(false);
  });

  describe("when signOut rejects", () => {
    beforeEach(() => {
      mockAuthSignOut.mockRejectedValue(new Error("network down"));
    });

    it("still clears the in-memory query cache", async () => {
      setupCachesStub();
      const queryClient = createSeededQueryClient();

      await signOutAndClearClientCache(queryClient);

      expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
    });

    it("still removes the persisted query cache from IndexedDB", async () => {
      setupCachesStub();

      await signOutAndClearClientCache(createSeededQueryClient());

      expect(mockRemoveClient).toHaveBeenCalledTimes(1);
    });

    it("still deletes the auth-scoped Service Worker caches", async () => {
      const deleted = setupCachesStub();

      await signOutAndClearClientCache(createSeededQueryClient());

      expect([...deleted].sort()).toEqual([...AUTH_SCOPED_SW_CACHES].sort());
    });

    it("reports the failure instead of swallowing it silently", async () => {
      setupCachesStub();

      await signOutAndClearClientCache(createSeededQueryClient());

      expect(mockReportError).toHaveBeenCalledTimes(1);
    });

    it("resolves so the caller can still navigate away", async () => {
      setupCachesStub();

      await expect(signOutAndClearClientCache(createSeededQueryClient())).resolves.toBeUndefined();
    });
  });

  describe("when signOut returns an error result", () => {
    it("reports a server error", async () => {
      mockAuthSignOut.mockResolvedValue({ data: null, error: { status: 500 } });
      setupCachesStub();

      await signOutAndClearClientCache(createSeededQueryClient());

      expect(mockReportError).toHaveBeenCalledTimes(1);
    });

    it("does not report an already-invalidated session", async () => {
      mockAuthSignOut.mockResolvedValue({ data: null, error: { status: 401 } });
      setupCachesStub();

      await signOutAndClearClientCache(createSeededQueryClient());

      expect(mockReportError).not.toHaveBeenCalled();
    });

    it("still removes the persisted query cache from IndexedDB", async () => {
      mockAuthSignOut.mockResolvedValue({ data: null, error: { status: 500 } });
      setupCachesStub();

      await signOutAndClearClientCache(createSeededQueryClient());

      expect(mockRemoveClient).toHaveBeenCalledTimes(1);
    });
  });

  describe("when local cleanup partially fails", () => {
    it("still deletes Service Worker caches when IndexedDB removal rejects", async () => {
      mockRemoveClient.mockRejectedValue(new Error("idb blocked"));
      const deleted = setupCachesStub();

      await signOutAndClearClientCache(createSeededQueryClient());

      expect(deleted).toContain("navigations");
    });

    it("still removes IndexedDB data when Cache Storage is unavailable", async () => {
      vi.stubGlobal("caches", undefined);

      await signOutAndClearClientCache(createSeededQueryClient());

      expect(mockRemoveClient).toHaveBeenCalledTimes(1);
    });
  });
});

describe("clearClientCache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRemoveClient.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not call signOut", async () => {
    setupCachesStub();

    await clearClientCache(createSeededQueryClient());

    expect(mockAuthSignOut).not.toHaveBeenCalled();
  });

  it("clears the in-memory query cache", async () => {
    setupCachesStub();
    const queryClient = createSeededQueryClient();

    await clearClientCache(queryClient);

    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
  });

  it("removes the persisted query cache from IndexedDB", async () => {
    setupCachesStub();

    await clearClientCache(createSeededQueryClient());

    expect(mockRemoveClient).toHaveBeenCalledTimes(1);
  });
});
