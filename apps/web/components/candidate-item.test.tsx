"use client";

import type { CandidateResponse } from "@sugara/shared";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MobileContext } from "@/lib/hooks/use-is-mobile";
import { renderWithIntl } from "@/lib/test-utils";
import { CandidateItem } from "./candidate-item";

// useSortable needs no real DndContext here; dnd-kit returns no-op refs.

function makeCandidate(overrides: Partial<CandidateResponse> = {}): CandidateResponse {
  return {
    id: "c1",
    name: "Tokyo to Kyoto",
    category: "transport",
    address: null,
    startTime: null,
    endTime: null,
    sortOrder: 0,
    memo: null,
    urls: [],
    departurePlace: "Tokyo",
    arrivalPlace: "Kyoto",
    transportMethod: "shinkansen",
    cost: null,
    color: "blue",
    endDayOffset: null,
    updatedAt: "2025-01-01T00:00:00Z",
    likeCount: 0,
    hmmCount: 0,
    myReaction: null,
    ...overrides,
  };
}

const noop = () => {};

afterEach(cleanup);

describe("CandidateItem transport cost", () => {
  it("renders the fare in whole units for a transport candidate with cost", () => {
    renderWithIntl(
      <MobileContext.Provider value={false}>
        <CandidateItem
          spot={makeCandidate({ cost: 13320 })}
          currency="JPY"
          onEdit={noop}
          onDelete={noop}
        />
      </MobileContext.Provider>,
    );

    // Whole-unit formatting: 13320 -> ￥13,320 (not minor-unit scaled)
    expect(screen.getByText("￥13,320")).toBeDefined();
  });

  it("formats the fare in the trip currency without cent scaling", () => {
    renderWithIntl(
      <MobileContext.Provider value={false}>
        <CandidateItem
          spot={makeCandidate({ cost: 120 })}
          currency="USD"
          onEdit={noop}
          onDelete={noop}
        />
      </MobileContext.Provider>,
    );

    expect(screen.getByText("$120")).toBeDefined();
  });

  it("does not render a fare when cost is null", () => {
    renderWithIntl(
      <MobileContext.Provider value={false}>
        <CandidateItem spot={makeCandidate({ cost: null })} onEdit={noop} onDelete={noop} />
      </MobileContext.Provider>,
    );

    expect(screen.queryByText(/￥|\$/)).toBeNull();
  });

  it("does not render a fare for non-transport candidates even if cost is set", () => {
    renderWithIntl(
      <MobileContext.Provider value={false}>
        <CandidateItem
          spot={makeCandidate({ category: "sightseeing", cost: 500 })}
          currency="JPY"
          onEdit={noop}
          onDelete={noop}
        />
      </MobileContext.Provider>,
    );

    expect(screen.queryByText("￥500")).toBeNull();
  });
});

// jsdom doesn't simulate pointer-events hit-testing, so these assert the CSS class
// (inherited by descendant links) rather than actual click suppression.
describe("CandidateItem reorder link tap guard", () => {
  function renderReorderable(overrides: Partial<CandidateResponse> = {}) {
    renderWithIntl(
      <MobileContext.Provider value={true}>
        <CandidateItem spot={makeCandidate(overrides)} onEdit={noop} onDelete={noop} reorderable />
      </MobileContext.Provider>,
    );
  }

  it("disables pointer events on the address link while reordering", () => {
    renderReorderable({ category: "sightseeing", address: "Tokyo Station" });

    const link = screen.getByText("Tokyo Station").closest("a");
    expect(link?.closest(".pointer-events-none")).not.toBeNull();
  });

  it("disables pointer events on the transit route link while reordering", () => {
    renderReorderable();

    const link = screen.getByText("Tokyo → Kyoto").closest("a");
    expect(link?.closest(".pointer-events-none")).not.toBeNull();
  });

  it("disables pointer events on the URL link while reordering", () => {
    renderReorderable({ urls: ["https://example.com/spot"] });

    const link = screen.getByText("example.com/spot").closest("a");
    expect(link?.closest(".pointer-events-none")).not.toBeNull();
  });
});
