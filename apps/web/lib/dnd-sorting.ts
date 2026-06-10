import type { SortingStrategy } from "@dnd-kit/sortable";

/**
 * Sorting strategy that never translates items while dragging.
 *
 * The timelines render their own DndInsertIndicator line as the single
 * insertion-point cue. verticalListSortingStrategy would additionally shift
 * neighbor cards to "make room", but dnd-kit's hit-testing and the indicator
 * overlay both use the unshifted layout rects, so the shifted cards drift
 * away from both the blue line and the actual drop targets. Keeping items
 * static makes the visuals, the indicator, and the hit-testing agree.
 */
export const noShiftSortingStrategy: SortingStrategy = () => null;
