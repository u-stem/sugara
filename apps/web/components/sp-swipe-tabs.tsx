"use client";

import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useSetActiveScrollElement } from "@/components/sp-scroll-container";
import { cn } from "@/lib/utils";

export type SwipeTab<T extends string = string> = {
  id: T;
  label: string;
  badge?: number;
};

export type SpSwipeTabsProps<T extends string = string> = {
  tabs: SwipeTab<T>[];
  activeTab: T;
  onTabChange: (tabId: T) => void;
  renderContent: (tabId: T) => ReactNode;
  /** Content inserted between tab bar and swipe container (e.g. toolbar) */
  children?: ReactNode;
  swipeEnabled?: boolean;
  className?: string;
  /**
   * @deprecated No longer needed — panel height is now measured dynamically.
   */
  extraTopOffset?: number;
};

// SpHeader h-14 = 56px, tab bar p-1(8px) + button min-h-[36px] = 44px
const BASE_TOP = 56 + 44;
const PANEL_BOTTOM_PADDING = "calc(4rem + env(safe-area-inset-bottom, 0px))";

const GRID_COLS: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-4",
  5: "grid-cols-5",
};

export function getMobileTabTriggerId(tabId: string): string {
  return `mobile-tab-trigger-${tabId}`;
}

export function getMobileTabPanelId(tabId: string): string {
  return `mobile-tab-panel-${tabId}`;
}

export function SpSwipeTabs<T extends string = string>({
  tabs,
  activeTab,
  onTabChange,
  renderContent,
  children,
  swipeEnabled = true,
  className,
  extraTopOffset = 0,
}: SpSwipeTabsProps<T>) {
  const [measuredHeight, setMeasuredHeight] = useState<string | null>(null);
  const setActiveScrollElement = useSetActiveScrollElement();
  const snapRef = useRef<HTMLDivElement>(null);
  const panelRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;
  // Measure snap container's actual viewport position to compute exact panel height
  useLayoutEffect(() => {
    const el = snapRef.current;
    if (!el) return;
    const measure = () => {
      const top = el.getBoundingClientRect().top;
      if (top >= 0) setMeasuredHeight(`calc(100dvh - ${top}px)`);
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (el.parentElement) observer.observe(el.parentElement);
    return () => observer.disconnect();
  }, []);

  const panelHeight = measuredHeight ?? `calc(100dvh - ${BASE_TOP + extraTopOffset}px)`;

  // Guard to skip scrollend handling during programmatic scrollTo
  const isProgrammaticRef = useRef(false);
  // Single owner of the in-flight programmatic scroll's full teardown (removes
  // listener/timer AND restores scroll-snap-type). Exposed to touchstart/unmount —
  // interrupting the user's control should always restore snap immediately.
  const cancelProgrammaticRef = useRef<(() => void) | null>(null);
  // Single owner of just the in-flight listener/timer cleanup, without restoring
  // scroll-snap-type. Used internally when retargeting mid-flight, since a retarget
  // continues the same disabled-snap window rather than toggling it off and on.
  const dropListenersRef = useRef<(() => void) | null>(null);
  // In-flight target, to dedupe re-runs caused by parent re-renders
  const programmaticTargetRef = useRef(-1);
  // Whether a touch is currently on the snap container. A parent re-render mid-touch
  // (e.g. a Presence update regenerating the tabs array) must not restart a
  // programmatic scroll while the user's finger is still driving the native scroll.
  const isTouchActiveRef = useRef(false);
  // Whether a user-driven scroll may still be settling (inertia/snap) after touchend
  // and before scrollend/detectTab runs. A re-render in that window must not start a
  // programmatic scroll — unless activeTab itself changed (an explicit tab click),
  // which should win immediately rather than wait for the settle to finish.
  const nativeSettlingRef = useRef(false);
  // The activeTab the sync effect last observed, to detect an explicit tab change
  // (vs. a re-render with the same activeTab) during the settling window above.
  const lastSyncedActiveTabRef = useRef(activeTab);
  // Visual tab index — ref for synchronous access in scroll handler, state for rendering
  const [visualTabIdx, setVisualTabIdx] = useState(() => tabs.findIndex((t) => t.id === activeTab));
  const visualTabIdxRef = useRef(visualTabIdx);

  const currentTabIdx = tabs.findIndex((t) => t.id === activeTab);

  // Sync visualTabIdx when activeTab changes externally (tab click, keyboard)
  useEffect(() => {
    visualTabIdxRef.current = currentTabIdx;
    setVisualTabIdx(currentTabIdx);
  }, [currentTabIdx]);

  // Register active panel as the scroll source for useScrollDirection / usePullToRefresh
  useEffect(() => {
    if (!setActiveScrollElement) return;
    const panelEl = panelRefs.current.get(activeTab) ?? null;
    setActiveScrollElement(panelEl);
    return () => {
      setActiveScrollElement(null);
    };
  }, [activeTab, setActiveScrollElement]);

  // Track scroll position for instant tab bar feedback + detect final tab on snap
  // Also clamp scroll to ±1 panel from the touch-start position to prevent skipping tabs
  useEffect(() => {
    const el = snapRef.current;
    if (!el) return;

    let anchorLeft = -1;

    function handleTouchStart() {
      if (!el) return;
      // A touch during a programmatic scroll means the user wants control back —
      // restore scroll-snap-type immediately so the native snap takes over from here.
      cancelProgrammaticRef.current?.();
      isProgrammaticRef.current = false;
      isTouchActiveRef.current = true;
      const panelWidth = el.clientWidth;
      if (panelWidth > 0) {
        anchorLeft = Math.round(el.scrollLeft / panelWidth) * panelWidth;
      }
    }

    function handleTouchEnd() {
      anchorLeft = -1;
      // Touch ended — native snap will settle and scrollend/detectTab syncs
      // activeTab, so it's safe to let the sync effect drive scrollTo again.
      isTouchActiveRef.current = false;
    }

    function handleScroll() {
      if (!el) return;
      if (!isProgrammaticRef.current) {
        // A user-driven scroll is in progress or still settling — mark it so the
        // sync effect can defer a re-render-triggered flight until scrollend.
        nativeSettlingRef.current = true;
      }
      const panelWidth = el.clientWidth;
      if (panelWidth === 0) return;

      if (anchorLeft >= 0) {
        const minLeft = Math.max(0, anchorLeft - panelWidth);
        const maxLeft = Math.min(el.scrollWidth - panelWidth, anchorLeft + panelWidth);
        if (el.scrollLeft < minLeft) {
          el.scrollLeft = minLeft;
        } else if (el.scrollLeft > maxLeft) {
          el.scrollLeft = maxLeft;
        }
      }

      const idx = Math.round(el.scrollLeft / panelWidth);
      if (idx !== visualTabIdxRef.current && idx >= 0 && idx < tabs.length) {
        // Skip visual update during programmatic scroll (tab click) to prevent flicker
        if (isProgrammaticRef.current) return;
        visualTabIdxRef.current = idx;
        setVisualTabIdx(idx);
      }
    }

    function detectTab() {
      if (!el || isProgrammaticRef.current) return;
      // scrollend (or the fallback timer) means the native scroll has settled.
      nativeSettlingRef.current = false;
      const panelWidth = el.clientWidth;
      if (panelWidth === 0) return;
      const idx = Math.round(el.scrollLeft / panelWidth);
      const newTab = tabs[idx];
      if (newTab && newTab.id !== activeTabRef.current) {
        onTabChange(newTab.id);
      }
    }

    const hasScrollEnd = "onscrollend" in window;
    let timer: ReturnType<typeof setTimeout> | undefined;

    function handleScrollWithFallback() {
      handleScroll();
      if (!hasScrollEnd) {
        clearTimeout(timer);
        timer = setTimeout(detectTab, 150);
      }
    }

    el.addEventListener("touchstart", handleTouchStart, { passive: true });
    el.addEventListener("touchend", handleTouchEnd, { passive: true });
    el.addEventListener("touchcancel", handleTouchEnd, { passive: true });
    el.addEventListener("scroll", handleScrollWithFallback, { passive: true });
    if (hasScrollEnd) {
      el.addEventListener("scrollend", detectTab);
    }

    return () => {
      if (timer) clearTimeout(timer);
      el.removeEventListener("touchstart", handleTouchStart);
      el.removeEventListener("touchend", handleTouchEnd);
      el.removeEventListener("touchcancel", handleTouchEnd);
      el.removeEventListener("scroll", handleScrollWithFallback);
      if (hasScrollEnd) {
        el.removeEventListener("scrollend", detectTab);
      }
    };
  }, [tabs, onTabChange]);

  // Sync activeTab prop to scroll position (for tab click, keyboard, external changes)
  //
  // iOS WebKit reverts a smooth scrollTo() on a snap-mandatory container back to the
  // original snap position, which then makes the scrollend handler below think the
  // user scrolled back and calls onTabChange with the old tab. Disabling
  // scroll-snap-type for the duration of the programmatic scroll (a known WebKit
  // workaround) prevents the revert. A position check on completion additionally
  // guarantees the final scrollLeft always matches activeTab.
  useEffect(() => {
    const el = snapRef.current;
    if (!el) return;

    // Whether activeTab changed since the last time this effect ran, updated before
    // any early return so the next run always compares against the correct baseline.
    const activeTabChangedSinceLastSync = lastSyncedActiveTabRef.current !== activeTab;
    lastSyncedActiveTabRef.current = activeTab;

    // A touch is already driving the scroll natively — starting a programmatic
    // scroll here would fight the user's finger.
    if (isTouchActiveRef.current) return;

    // Inertia/snap from a user swipe may still be settling after touchend and before
    // scrollend/detectTab. Defer a re-render-triggered flight during that window,
    // UNLESS activeTab actually changed — an explicit tab click should win
    // immediately (the flight below sets isProgrammaticRef, so the eventual
    // scrollend's detectTab is guarded and won't fight it).
    if (nativeSettlingRef.current && !activeTabChangedSinceLastSync) return;

    const idx = tabs.findIndex((t) => t.id === activeTab);
    if (idx === -1) return;
    const targetLeft = idx * el.clientWidth;
    if (Math.abs(el.scrollLeft - targetLeft) < 2) return;
    // Parent re-renders regenerate the tabs array on every render, which would
    // otherwise re-run this effect and restart the same in-flight animation.
    if (programmaticTargetRef.current === targetLeft) return;

    // A newer tap arrived before the previous scroll settled — retarget without
    // restoring scroll-snap-type, since we're continuing straight into a new flight.
    const retargeting = programmaticTargetRef.current !== -1;
    dropListenersRef.current?.();

    programmaticTargetRef.current = targetLeft;
    isProgrammaticRef.current = true;
    // This flight now owns scroll-snap-type; any prior settling window is over.
    nativeSettlingRef.current = false;
    if (!retargeting) {
      el.style.setProperty("scroll-snap-type", "none");
    }
    el.scrollTo({ left: targetLeft, behavior: "smooth" });

    let done = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    function dropListeners() {
      if (timer) clearTimeout(timer);
      el?.removeEventListener("scrollend", finish);
    }

    function teardown() {
      if (done) return;
      done = true;
      dropListeners();
      el?.style.removeProperty("scroll-snap-type");
      isProgrammaticRef.current = false;
      programmaticTargetRef.current = -1;
      cancelProgrammaticRef.current = null;
      dropListenersRef.current = null;
    }

    function finish() {
      if (done) return;
      // Recompute from clientWidth rather than closing over targetLeft — a screen
      // rotation mid-flight (up to 700ms) would otherwise correct to stale coordinates.
      const currentTargetLeft = el ? idx * el.clientWidth : targetLeft;
      if (el && Math.abs(el.scrollLeft - currentTargetLeft) >= 2) {
        el.scrollTo({ left: currentTargetLeft, behavior: "instant" });
      }
      teardown();
    }

    // No `{ once: true }` here — teardown() removes the listener explicitly, and a
    // fallback timer runs alongside since scrollend may not fire if the scroll
    // distance collapses mid-flight (e.g. an interrupted animation ends where it
    // started).
    if ("onscrollend" in window) {
      el.addEventListener("scrollend", finish);
    }
    timer = setTimeout(finish, 700);

    cancelProgrammaticRef.current = teardown;
    dropListenersRef.current = dropListeners;
  }, [activeTab, tabs]);

  // Deliberately separate from the effect above: that effect must NOT tear down
  // in-flight state on every dependency change (re-renders should be deduped, not
  // cancelled), only on unmount.
  useEffect(() => {
    return () => {
      cancelProgrammaticRef.current?.();
    };
  }, []);

  const handleTabClick = useCallback(
    (tabId: T) => {
      if (tabId === activeTabRef.current) return;
      onTabChange(tabId);
    },
    [onTabChange],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent, index: number) => {
      let targetId: T | undefined;
      if (e.key === "ArrowRight") {
        e.preventDefault();
        targetId = tabs[(index + 1) % tabs.length].id;
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        targetId = tabs[(index - 1 + tabs.length) % tabs.length].id;
      } else if (e.key === "Home") {
        e.preventDefault();
        const first = tabs[0].id;
        if (first !== activeTabRef.current) targetId = first;
      } else if (e.key === "End") {
        e.preventDefault();
        const last = tabs[tabs.length - 1].id;
        if (last !== activeTabRef.current) targetId = last;
      }
      if (targetId !== undefined) {
        onTabChange(targetId);
        document.getElementById(getMobileTabTriggerId(targetId))?.focus();
      }
    },
    [tabs, onTabChange],
  );

  const setPanelRef = useCallback((tabId: string, el: HTMLDivElement | null) => {
    if (el) {
      panelRefs.current.set(tabId, el);
    } else {
      panelRefs.current.delete(tabId);
    }
  }, []);

  return (
    <div className={className}>
      {/* Tab bar — sticky within SpScrollContainer */}
      <div
        role="tablist"
        aria-orientation="horizontal"
        className={cn(
          "sticky top-0 z-20 grid gap-1 rounded-lg bg-muted p-1 touch-pan-x",
          GRID_COLS[tabs.length],
        )}
      >
        {tabs.map((tab, index) => {
          const isVisuallyActive = index === visualTabIdx;
          return (
            <button
              key={tab.id}
              id={getMobileTabTriggerId(tab.id)}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              aria-controls={getMobileTabPanelId(tab.id)}
              tabIndex={activeTab === tab.id ? 0 : -1}
              className={cn(
                "min-w-0 rounded-md px-2 py-1.5 text-sm font-medium min-h-[36px] overflow-hidden",
                isVisuallyActive
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
              onClick={() => handleTabClick(tab.id)}
              onKeyDown={(e) => handleKeyDown(e, index)}
            >
              <span className="flex w-full items-center justify-center gap-1 whitespace-nowrap">
                <span className="truncate">{tab.label}</span>
                {tab.badge != null && tab.badge > 0 && (
                  <span className="shrink-0 text-xs">{tab.badge}</span>
                )}
              </span>
            </button>
          );
        })}
      </div>

      {children}

      {/* Scroll snap container — all tabs pre-rendered, each panel scrolls independently */}
      {currentTabIdx !== -1 && (
        <div
          ref={snapRef}
          className={cn(
            "flex [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
            swipeEnabled
              ? "overflow-x-auto snap-x snap-mandatory overscroll-x-contain"
              : "overflow-x-hidden",
          )}
          style={{ height: panelHeight }}
        >
          {tabs.map((tab) => {
            const isActive = tab.id === activeTab;
            return (
              <div
                key={tab.id}
                ref={(el) => setPanelRef(tab.id, el)}
                className="w-full shrink-0 snap-start snap-always overflow-y-auto overscroll-y-contain pt-3"
                style={{ paddingBottom: PANEL_BOTTOM_PADDING }}
                id={getMobileTabPanelId(tab.id)}
                role="tabpanel"
                aria-labelledby={getMobileTabTriggerId(tab.id)}
                {...(!isActive && { inert: true })}
              >
                {renderContent(tab.id)}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
