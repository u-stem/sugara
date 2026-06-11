import { describe, expect, it } from "vitest";
import { noShiftSortingStrategy } from "../dnd-sorting";

function makeRect(top: number) {
  return { width: 800, height: 100, top, left: 0, right: 800, bottom: top + 100 };
}

describe("noShiftSortingStrategy", () => {
  it("never translates neighbor items while dragging", () => {
    // The DndInsertIndicator line is the single insertion cue; items must
    // stay put so the line, the cards, and dnd-kit hit-testing agree.
    const transform = noShiftSortingStrategy({
      activeIndex: 0,
      activeNodeRect: makeRect(0),
      index: 1,
      rects: [makeRect(0), makeRect(110), makeRect(220)],
      overIndex: 2,
    });
    expect(transform).toBeNull();
  });
});
