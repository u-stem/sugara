import type { CrossDayEntry, ScheduleResponse } from "@sugara/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SelectionProvider } from "@/lib/hooks/selection-context";
import { MobileContext } from "@/lib/hooks/use-is-mobile";
import { renderWithIntl } from "@/lib/test-utils";
import { DayTimeline } from "./day-timeline";

// useSortable/useDroppable need no real DndContext here; dnd-kit returns no-op refs.

const noop = () => {};
const asyncNoop = async () => {};

const selectionStub = {
  selectionTarget: null,
  selectedIds: new Set<string>(),
  batchLoading: false,
  batchDeleteOpen: false,
  setBatchDeleteOpen: noop,
  enter: noop,
  exit: noop,
  toggle: noop,
  selectAll: noop,
  deselectAll: noop,
  batchAssign: asyncNoop,
  batchUnassign: asyncNoop,
  batchDelete: asyncNoop,
  batchDuplicateCandidates: asyncNoop,
  batchDuplicateSchedules: asyncNoop,
  canEnter: false,
};

function makeSchedule(
  overrides: Partial<ScheduleResponse> & Pick<ScheduleResponse, "id">,
): ScheduleResponse {
  return {
    name: "Spot",
    category: "sightseeing",
    address: null,
    startTime: null,
    endTime: null,
    sortOrder: 0,
    memo: null,
    urls: [],
    color: "blue",
    endDayOffset: null,
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeIntermediateEntry(): CrossDayEntry {
  return {
    schedule: makeSchedule({ id: "hotel1", name: "Hotel", category: "hotel" }),
    sourceDayId: "d0",
    sourcePatternId: "p0",
    sourceDayNumber: 1,
    crossDayPosition: "intermediate",
  };
}

function makeFinalEntry(): CrossDayEntry {
  return {
    schedule: makeSchedule({ id: "hotel2", name: "Hotel", category: "hotel", endTime: "10:00" }),
    sourceDayId: "d0",
    sourcePatternId: "p0",
    sourceDayNumber: 1,
    crossDayPosition: "final",
  };
}

function renderTimeline({
  schedules,
  crossDayEntries,
}: {
  schedules: ScheduleResponse[];
  crossDayEntries?: CrossDayEntry[];
}) {
  const queryClient = new QueryClient();
  return renderWithIntl(
    <QueryClientProvider client={queryClient}>
      <MobileContext.Provider value={true}>
        <SelectionProvider value={selectionStub}>
          <DayTimeline
            tripId="t1"
            dayId="d1"
            patternId="p1"
            date="2026-06-11"
            schedules={schedules}
            crossDayEntries={crossDayEntries}
            onRefresh={noop}
            onReorderSchedule={noop}
            scheduleLimitReached
          />
        </SelectionProvider>
      </MobileContext.Provider>
    </QueryClientProvider>,
  );
}

function enterReorderMode() {
  fireEvent.click(screen.getByRole("button", { name: "並び替え" }));
}

afterEach(cleanup);

describe("DayTimeline mobile reorder with cross-day entries", () => {
  it("enables the up button on the first schedule when a staying entry is pinned above it", () => {
    renderTimeline({
      schedules: [makeSchedule({ id: "s1" }), makeSchedule({ id: "s2", sortOrder: 1 })],
      crossDayEntries: [makeIntermediateEntry()],
    });
    enterReorderMode();

    // Merged timeline: [staying entry, s1, s2] — s1 can still move above the entry via anchor.
    const upButtons = screen.getAllByLabelText("上に移動");
    expect(upButtons[0].hasAttribute("disabled")).toBe(false);
  });

  it("keeps the up button disabled on the first schedule when nothing is above it", () => {
    renderTimeline({
      schedules: [makeSchedule({ id: "s1" }), makeSchedule({ id: "s2", sortOrder: 1 })],
    });
    enterReorderMode();

    const upButtons = screen.getAllByLabelText("上に移動");
    expect(upButtons[0].hasAttribute("disabled")).toBe(true);
  });

  it("enables the down button on the last schedule when a final cross-day entry sits below it", () => {
    renderTimeline({
      schedules: [makeSchedule({ id: "s1" }), makeSchedule({ id: "s2", sortOrder: 1 })],
      crossDayEntries: [makeFinalEntry()],
    });
    enterReorderMode();

    // Merged timeline: [s1, s2, checkout entry] — s2 can still move below the entry via anchor.
    const downButtons = screen.getAllByLabelText("下に移動");
    expect(downButtons[1].hasAttribute("disabled")).toBe(false);
  });

  it("enables the reorder-mode button for a single schedule when a staying entry shares the day", () => {
    renderTimeline({
      schedules: [makeSchedule({ id: "s1" })],
      crossDayEntries: [makeIntermediateEntry()],
    });

    const sortButton = screen.getByRole("button", { name: "並び替え" });
    expect(sortButton.hasAttribute("disabled")).toBe(false);
  });
});

describe("DayTimeline mobile reorder link tap guard", () => {
  it("disables pointer events on the address link while reordering", () => {
    renderTimeline({
      schedules: [
        makeSchedule({ id: "s1", address: "Tokyo Station" }),
        makeSchedule({ id: "s2", sortOrder: 1 }),
      ],
    });
    enterReorderMode();

    const link = screen.getByText("Tokyo Station").closest("a");
    expect(link?.closest(".pointer-events-none")).not.toBeNull();
  });

  it("disables pointer events on the transit route link while reordering", () => {
    renderTimeline({
      schedules: [
        makeSchedule({
          id: "s1",
          category: "transport",
          departurePlace: "Tokyo",
          arrivalPlace: "Kyoto",
        }),
        makeSchedule({ id: "s2", sortOrder: 1 }),
      ],
    });
    enterReorderMode();

    const link = screen.getByText("Tokyo → Kyoto").closest("a");
    expect(link?.closest(".pointer-events-none")).not.toBeNull();
  });
});
