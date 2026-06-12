/**
 * Tests for SouvenirDialog save feedback: a success toast must confirm the
 * add/edit, and the souvenir-per-trip limit (409) must surface a localized
 * message instead of the generic failure text.
 */
import type { SouvenirItem } from "@sugara/shared";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithIntl } from "@/lib/test-utils";

// --- module mocks ------------------------------------------------------------

const { mockApi } = vi.hoisted(() => ({ mockApi: vi.fn() }));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, api: mockApi };
});

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// Suppress the Radix responsive-dialog; only the form matters here.
vi.mock("@/components/ui/responsive-dialog", () => ({
  ResponsiveDialog: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  ResponsiveDialogContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  ResponsiveDialogHeader: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  ResponsiveDialogTitle: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  ResponsiveDialogDescription: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  ResponsiveDialogFooter: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  ResponsiveDialogClose: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { ApiError } from "@/lib/api";
import { SouvenirDialog } from "./souvenir-dialog";

// --- fixtures ----------------------------------------------------------------

const existingItem: SouvenirItem = {
  id: "s1",
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
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderDialog(item?: SouvenirItem) {
  return renderWithIntl(
    <SouvenirDialog
      tripId="t1"
      open
      onOpenChange={vi.fn()}
      item={item ?? null}
      onSaved={vi.fn()}
    />,
  );
}

function fillNameAndSubmit(name: string) {
  fireEvent.change(screen.getByLabelText(/品名/), { target: { value: name } });
  fireEvent.click(screen.getByRole("button", { name: /^(追加|更新)$/ }));
}

// --- tests ---------------------------------------------------------------------

describe("SouvenirDialog save feedback", () => {
  it("shows a localized success toast after adding a souvenir", async () => {
    mockApi.mockResolvedValue({});
    renderDialog();

    fillNameAndSubmit("木彫りの熊");

    await waitFor(() => {
      expect(vi.mocked(toast.success)).toHaveBeenCalledWith("お土産を追加しました");
    });
  });

  it("shows a localized success toast after editing a souvenir", async () => {
    mockApi.mockResolvedValue({});
    renderDialog(existingItem);

    fillNameAndSubmit("イカ飯(改)");

    await waitFor(() => {
      expect(vi.mocked(toast.success)).toHaveBeenCalledWith("お土産を更新しました");
    });
  });

  it("shows the souvenir limit message when the API returns 409", async () => {
    mockApi.mockRejectedValue(new ApiError("Souvenir limit reached", 409));
    renderDialog();

    fillNameAndSubmit("木彫りの熊");

    await waitFor(() => {
      expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
        "お土産は1旅行あたり最大100件まで登録できます",
      );
    });
  });
});
