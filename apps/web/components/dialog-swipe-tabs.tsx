"use client";

import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export type DialogTab<T extends string = string> = {
  id: T;
  label: string;
};

interface DialogSwipeTabsProps<T extends string> {
  tabs: DialogTab<T>[];
  activeTab: T;
  onTabChange: (tabId: T) => void;
  renderContent: (tabId: T) => ReactNode;
}

export function DialogSwipeTabs<T extends string>({
  tabs,
  activeTab,
  onTabChange,
  renderContent,
}: DialogSwipeTabsProps<T>) {
  const snapRef = useRef<HTMLDivElement>(null);
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
  // must not restart a programmatic scroll while the user's finger is still driving
  // the native scroll.
  const isTouchActiveRef = useRef(false);
  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;

  const currentIdx = tabs.findIndex((t) => t.id === activeTab);
  const [visualIdx, setVisualIdx] = useState(currentIdx);

  useEffect(() => {
    setVisualIdx(currentIdx);
  }, [currentIdx]);

  // Detect tab from scroll position
  useEffect(() => {
    const el = snapRef.current;
    if (!el) return;

    function handleScroll() {
      if (!el || isProgrammaticRef.current) return;
      const w = el.clientWidth;
      if (w === 0) return;
      const idx = Math.round(el.scrollLeft / w);
      if (idx >= 0 && idx < tabs.length && idx !== visualIdx) {
        setVisualIdx(idx);
      }
    }

    function detectTab() {
      if (!el || isProgrammaticRef.current) return;
      const w = el.clientWidth;
      if (w === 0) return;
      const idx = Math.round(el.scrollLeft / w);
      const tab = tabs[idx];
      if (tab && tab.id !== activeTabRef.current) {
        onTabChange(tab.id);
      }
    }

    const hasScrollEnd = "onscrollend" in window;
    let timer: ReturnType<typeof setTimeout> | undefined;

    function onScroll() {
      handleScroll();
      if (!hasScrollEnd) {
        clearTimeout(timer);
        timer = setTimeout(detectTab, 150);
      }
    }

    el.addEventListener("scroll", onScroll, { passive: true });
    if (hasScrollEnd) el.addEventListener("scrollend", detectTab);

    return () => {
      clearTimeout(timer);
      el.removeEventListener("scroll", onScroll);
      if (hasScrollEnd) el.removeEventListener("scrollend", detectTab);
    };
  }, [tabs, onTabChange, visualIdx]);

  // Interrupt an in-flight programmatic scroll as soon as the user touches the
  // container — mirrors SpSwipeTabs' handleTouchStart/handleTouchEnd.
  useEffect(() => {
    const el = snapRef.current;
    if (!el) return;

    function handleTouchStart() {
      // A touch during a programmatic scroll means the user wants control back —
      // restore scroll-snap-type immediately so the native snap takes over from here.
      cancelProgrammaticRef.current?.();
      isProgrammaticRef.current = false;
      isTouchActiveRef.current = true;
    }

    function handleTouchEnd() {
      // Touch ended — native snap will settle and scrollend/detectTab syncs
      // activeTab, so it's safe to let the sync effect drive scrollTo again.
      isTouchActiveRef.current = false;
    }

    el.addEventListener("touchstart", handleTouchStart, { passive: true });
    el.addEventListener("touchend", handleTouchEnd, { passive: true });
    el.addEventListener("touchcancel", handleTouchEnd, { passive: true });

    return () => {
      el.removeEventListener("touchstart", handleTouchStart);
      el.removeEventListener("touchend", handleTouchEnd);
      el.removeEventListener("touchcancel", handleTouchEnd);
    };
  }, []);

  // Sync activeTab to scroll position on tab click
  //
  // iOS WebKit reverts a smooth scrollTo() on a snap-mandatory container back to the
  // original snap position, which then makes the scrollend handler above think the
  // user scrolled back and calls onTabChange with the old tab. Disabling
  // scroll-snap-type for the duration of the programmatic scroll (a known WebKit
  // workaround) prevents the revert. A position check on completion additionally
  // guarantees the final scrollLeft always matches activeTab.
  useEffect(() => {
    const el = snapRef.current;
    if (!el) return;
    // A touch is already driving the scroll natively — starting a programmatic
    // scroll here would fight the user's finger.
    if (isTouchActiveRef.current) return;
    const idx = tabs.findIndex((t) => t.id === activeTab);
    if (idx === -1) return;
    const target = idx * el.clientWidth;
    if (Math.abs(el.scrollLeft - target) < 2) return;
    // Dialogs re-render tabs on every parent render, which would otherwise re-run
    // this effect and restart the same in-flight animation.
    if (programmaticTargetRef.current === target) return;

    // A newer tap arrived before the previous scroll settled — retarget without
    // restoring scroll-snap-type, since we're continuing straight into a new flight.
    const retargeting = programmaticTargetRef.current !== -1;
    dropListenersRef.current?.();

    programmaticTargetRef.current = target;
    isProgrammaticRef.current = true;
    if (!retargeting) {
      el.style.setProperty("scroll-snap-type", "none");
    }
    el.scrollTo({ left: target, behavior: "smooth" });

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
      // Recompute from clientWidth rather than closing over target — a screen
      // rotation mid-flight (up to 700ms) would otherwise correct to stale coordinates.
      const currentTarget = el ? idx * el.clientWidth : target;
      if (el && Math.abs(el.scrollLeft - currentTarget) >= 2) {
        el.scrollTo({ left: currentTarget, behavior: "instant" });
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
      if (tabId !== activeTabRef.current) onTabChange(tabId);
    },
    [onTabChange],
  );

  const gridCols = tabs.length === 2 ? "grid-cols-2" : "grid-cols-3";

  return (
    <div>
      <div role="tablist" className={cn("grid gap-1 rounded-lg bg-muted p-1", gridCols)}>
        {tabs.map((tab, i) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            className={cn(
              "rounded-md px-2 py-1.5 text-sm font-medium",
              i === visualIdx
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
            onClick={() => handleTabClick(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div
        ref={snapRef}
        className="mt-1 flex overflow-x-auto snap-x snap-mandatory overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className="w-full shrink-0 snap-start snap-always p-0.5"
            role="tabpanel"
            {...(tab.id !== activeTab && { inert: true })}
          >
            {renderContent(tab.id)}
          </div>
        ))}
      </div>
    </div>
  );
}
