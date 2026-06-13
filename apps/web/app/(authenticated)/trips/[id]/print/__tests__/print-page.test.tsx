import type { TripResponse } from "@sugara/shared";
import { cleanup, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithIntlAndQuery } from "@/lib/test-utils";
import messages from "@/messages/ja.json";

const mockPush = vi.fn();
const mockBack = vi.fn();
// Stable reference to prevent useCallback invalidation
const mockRouter = { push: mockPush, back: mockBack };
let mockSearchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "trip-1" }),
  useRouter: () => mockRouter,
  useSearchParams: () => mockSearchParams,
}));

const mockApi = vi.fn();
vi.mock("@/lib/api", () => ({
  api: (...args: unknown[]) => mockApi(...args),
  ApiError: class extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));

import TripPrintPage from "../page";

function renderWithQuery(ui: ReactElement) {
  return renderWithIntlAndQuery(ui);
}

const tripFixture: TripResponse = {
  id: "trip-1",
  title: "Tokyo Trip",
  destination: "Tokyo",
  startDate: "2025-07-01",
  endDate: "2025-07-03",
  status: "planned",
  coverImageUrl: null,
  coverImagePosition: 50,
  shareToken: null,
  currency: "JPY",
  role: "owner",
  candidates: [],
  scheduleCount: 2,
  expenseCount: 0,
  memberCount: 1,
  poll: null,
  mapsEnabled: false,
  days: [
    {
      id: "day-1",
      dayNumber: 1,
      date: "2025-07-01",
      patterns: [
        {
          id: "pattern-1",
          label: "Default",
          isDefault: true,
          sortOrder: 0,
          schedules: [
            {
              id: "s-1",
              name: "Asakusa Temple",
              category: "sightseeing",
              startTime: "09:00",
              endTime: "11:00",
              sortOrder: 0,
              color: "blue",
              urls: [],
              updatedAt: "2025-07-01T00:00:00Z",
            },
          ],
        },
      ],
    },
  ],
};

describe("TripPrintPage", () => {
  afterEach(() => {
    cleanup();
    mockSearchParams = new URLSearchParams();
    vi.restoreAllMocks();
  });

  it("renders trip data after successful fetch", async () => {
    mockApi.mockResolvedValueOnce(tripFixture);

    renderWithQuery(<TripPrintPage />);

    expect(await screen.findByText("Tokyo Trip")).toBeDefined();
    expect(screen.getByText("Asakusa Temple")).toBeDefined();
  });

  it("renders error message on fetch failure", async () => {
    mockApi.mockRejectedValueOnce(new Error("Network error"));

    renderWithQuery(<TripPrintPage />);

    expect(await screen.findByText(messages.messages.tripFetchFailed)).toBeDefined();
  });

  it("calls window.print when auto=1 search param is set", async () => {
    mockSearchParams = new URLSearchParams("auto=1");
    mockApi.mockResolvedValueOnce(tripFixture);
    const printSpy = vi.spyOn(window, "print").mockImplementation(() => {});

    renderWithQuery(<TripPrintPage />);

    await screen.findByText("Tokyo Trip");
    await vi.waitFor(() => {
      expect(printSpy).toHaveBeenCalledOnce();
    });
  });

  it("does not call window.print without auto param", async () => {
    mockApi.mockResolvedValueOnce(tripFixture);
    const printSpy = vi.spyOn(window, "print").mockImplementation(() => {});

    renderWithQuery(<TripPrintPage />);

    await screen.findByText("Tokyo Trip");
    // Allow time for potential setTimeout to fire
    await new Promise((r) => setTimeout(r, 600));
    expect(printSpy).not.toHaveBeenCalled();
  });
});
