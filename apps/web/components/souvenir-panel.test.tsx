/**
 * Regression tests for souvenir deletion: the DELETE endpoint returns
 * 204 No Content, so the client must use apiVoid() — api() throws its
 * internal 204 guard error, which both blocks the list refresh and
 * surfaces a developer-facing message to the user (issue observed in
 * production on 2026-06-12).
 */
import type { SouvenirItem } from "@sugara/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MobileContext } from "@/lib/hooks/use-is-mobile";
import { renderWithIntl } from "@/lib/test-utils";

// --- module mocks ------------------------------------------------------------

vi.mock("@/lib/auth-client", () => ({
  useSession: () => ({ data: { user: { id: "u1" } } }),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

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
vi.mock("@/components/ui/responsive-alert-dialog", () => ({
  ResponsiveAlertDialog: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  ResponsiveAlertDialogContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  ResponsiveAlertDialogHeader: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  ResponsiveAlertDialogTitle: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  ResponsiveAlertDialogDescription: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  ResponsiveAlertDialogFooter: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  ResponsiveAlertDialogCancel: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  ResponsiveAlertDialogDestructiveAction: ({
    children,
    onClick,
    disabled,
  }: {
    children: React.ReactNode;
    onClick: () => void;
    disabled: boolean;
  }) => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}));

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
  return fetchMock.mock.calls.filter((call) => (call[1]?.method ?? "GET") === "GET").length;
}

function stubFetch(items: SouvenirItem[]) {
  fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
    if (init?.method === "DELETE") {
      return new Response(null, { status: 204 });
    }
    return new Response(JSON.stringify({ items }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
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
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return renderWithIntl(
    <QueryClientProvider client={queryClient}>
      <MobileContext.Provider value={false}>
        <SouvenirPanel tripId="t1" />
      </MobileContext.Provider>
    </QueryClientProvider>,
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
    expect(vi.mocked(toast.error)).not.toHaveBeenCalled();
  });
});
