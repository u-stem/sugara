/**
 * Regression tests for souvenir deletion: the DELETE endpoint returns
 * 204 No Content, so the client must use apiVoid() — api() throws its
 * internal 204 guard error, which both blocks the list refresh and
 * surfaces a developer-facing message to the user (issue observed in
 * production on 2026-06-12).
 */
import type { SouvenirItem } from "@sugara/shared";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MobileContext } from "@/lib/hooks/use-is-mobile";
import { renderWithIntlAndQuery } from "@/lib/test-utils";

// --- module mocks ------------------------------------------------------------

vi.mock("@/lib/auth-client", () => ({
  useSession: () => ({ data: { user: { id: "u1" } } }),
}));

vi.mock("sonner");

// SouvenirDialog is loaded via next/dynamic; not needed in these tests.
vi.mock("next/dynamic", () => ({ default: () => () => null }));

// Render Radix dropdown menu items as plain buttons so jsdom can click them.
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuItem: ({
    children,
    onClick,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
  }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
}));

// Suppress the Radix responsive-alert-dialog; only the confirm action matters.
// The passthrough mock lives in components/ui/__mocks__/responsive-alert-dialog.tsx.
vi.mock("@/components/ui/responsive-alert-dialog");

import { SouvenirPanel } from "./souvenir-panel";

// --- fixtures ----------------------------------------------------------------

function makeItem(overrides: Partial<SouvenirItem> & Pick<SouvenirItem, "id">): SouvenirItem {
  return {
    name: "イカ飯",
    recipient: null,
    urls: [],
    addresses: [],
    memo: null,
    priority: null,
    isPurchased: false,
    isShared: false,
    shareStyle: null,
    userId: "u1",
    userName: "User One",
    userImage: null,
    createdAt: "2026-06-01T00:00:00Z",
    updatedAt: "2026-06-01T00:00:00Z",
    ...overrides,
  };
}

// --- fetch stub ---------------------------------------------------------------

const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();

function listFetchCount(): number {
  return fetchMock.mock.calls.filter(
    (call) => (call[1]?.method ?? "GET") === "GET" && call[0].endsWith("/souvenirs"),
  ).length;
}

function deleteFetchCount(): number {
  return fetchMock.mock.calls.filter((call) => call[1]?.method === "DELETE").length;
}

function stubFetch(items: SouvenirItem[], deleteResponse: (url: string) => Response = ok204) {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (init?.method === "DELETE") {
      return deleteResponse(url);
    }
    return new Response(JSON.stringify({ items }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
}

function ok204(): Response {
  return new Response(null, { status: 204 });
}

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

// --- helpers -------------------------------------------------------------------

function renderPanel() {
  return renderWithIntlAndQuery(
    <MobileContext.Provider value={false}>
      <SouvenirPanel tripId="t1" />
    </MobileContext.Provider>,
  );
}

async function deleteFirstItem() {
  fireEvent.click(screen.getByRole("button", { name: "削除" }));
  // Both the single-delete and bulk-delete dialogs render a confirm button;
  // the single-delete dialog comes first in the tree.
  const confirmButtons = screen.getAllByRole("button", { name: "削除する" });
  fireEvent.click(confirmButtons[0]);
}

// --- tests ---------------------------------------------------------------------

describe("SouvenirPanel delete", () => {
  it("refetches the list after the DELETE endpoint returns 204", async () => {
    stubFetch([makeItem({ id: "s1" })]);
    renderPanel();
    await screen.findByText("イカ飯");

    await deleteFirstItem();

    await waitFor(() => {
      expect(listFetchCount()).toBeGreaterThanOrEqual(2);
    });
    expect(deleteFetchCount()).toBe(1);
  });

  it("does not surface an error toast when deletion succeeds with 204", async () => {
    stubFetch([makeItem({ id: "s1" })]);
    renderPanel();
    await screen.findByText("イカ飯");

    await deleteFirstItem();

    // Wait for the mutation to settle (success invalidates and refetches the list).
    await waitFor(() => {
      expect(listFetchCount()).toBeGreaterThanOrEqual(2);
    });
    expect(vi.mocked(toast.error)).not.toHaveBeenCalled();
  });

  it("shows a localized success toast after deletion", async () => {
    stubFetch([makeItem({ id: "s1" })]);
    renderPanel();
    await screen.findByText("イカ飯");

    await deleteFirstItem();

    await waitFor(() => {
      expect(vi.mocked(toast.success)).toHaveBeenCalledWith("お土産を削除しました");
    });
  });

  it("shows a localized success toast after bulk deletion", async () => {
    stubFetch([makeItem({ id: "s1" }), makeItem({ id: "s2", name: "木彫りの熊" })]);
    renderPanel();
    await screen.findByText("イカ飯");

    fireEvent.click(screen.getByRole("button", { name: "選択" }));
    fireEvent.click(screen.getByRole("button", { name: "全選択" }));
    fireEvent.click(screen.getByRole("button", { name: "削除" }));
    const confirmButtons = screen.getAllByRole("button", { name: "削除する" });
    fireEvent.click(confirmButtons[1]);

    await waitFor(() => {
      expect(vi.mocked(toast.success)).toHaveBeenCalledWith("お土産を削除しました");
    });
  });

  it("treats a 404 on delete as success because the item is already gone", async () => {
    stubFetch([makeItem({ id: "s1" })], () => jsonError(404, "Souvenir not found"));
    renderPanel();
    await screen.findByText("イカ飯");

    await deleteFirstItem();

    await waitFor(() => {
      expect(listFetchCount()).toBeGreaterThanOrEqual(2);
    });
    expect(vi.mocked(toast.error)).not.toHaveBeenCalled();
  });

  it("bulk-deletes selected items when the DELETE endpoint returns 204", async () => {
    stubFetch([makeItem({ id: "s1" }), makeItem({ id: "s2", name: "木彫りの熊" })]);
    renderPanel();
    await screen.findByText("イカ飯");

    fireEvent.click(screen.getByRole("button", { name: "選択" }));
    fireEvent.click(screen.getByRole("button", { name: "全選択" }));
    fireEvent.click(screen.getByRole("button", { name: "削除" }));
    const confirmButtons = screen.getAllByRole("button", { name: "削除する" });
    fireEvent.click(confirmButtons[1]);

    await waitFor(() => {
      expect(listFetchCount()).toBeGreaterThanOrEqual(2);
    });
    expect(deleteFetchCount()).toBe(2);
    expect(vi.mocked(toast.error)).not.toHaveBeenCalled();
  });

  it("refetches the list and shows a localized toast when a bulk delete partially fails", async () => {
    stubFetch([makeItem({ id: "s1" }), makeItem({ id: "s2", name: "木彫りの熊" })], (url) =>
      url.endsWith("/s2") ? jsonError(500, "Internal Server Error") : ok204(),
    );
    renderPanel();
    await screen.findByText("イカ飯");

    fireEvent.click(screen.getByRole("button", { name: "選択" }));
    fireEvent.click(screen.getByRole("button", { name: "全選択" }));
    fireEvent.click(screen.getByRole("button", { name: "削除" }));
    const confirmButtons = screen.getAllByRole("button", { name: "削除する" });
    fireEvent.click(confirmButtons[1]);

    // onSettled must refetch so the successfully deleted sibling drops out
    await waitFor(() => {
      expect(listFetchCount()).toBeGreaterThanOrEqual(2);
    });
    expect(vi.mocked(toast.error)).toHaveBeenCalledWith("お土産の削除に失敗しました");
  });
});
