import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DialogSwipeTabs } from "../../components/dialog-swipe-tabs";
import { getSnapContainer, setupWebkitHarness } from "./helpers/webkit-snap-harness";

const TABS = [
  { id: "a", label: "Tab A" },
  { id: "b", label: "Tab B" },
  { id: "c", label: "Tab C" },
] as const;

type TabId = (typeof TABS)[number]["id"];

function StatefulTabs() {
  const [activeTab, setActiveTab] = useState<TabId>("a");
  return (
    <DialogSwipeTabs
      tabs={[...TABS]}
      activeTab={activeTab}
      onTabChange={setActiveTab}
      renderContent={(id: TabId) => <div>Content {id}</div>}
    />
  );
}

// Externally driven (non-stateful) render — activeTab only changes via rerender,
// mirroring how a parent dialog passes the already-updated tab down as a prop.
function renderControlled() {
  const onTabChange = vi.fn();
  const stableTabs = [...TABS];
  const renderContent = (id: TabId) => <div>Content {id}</div>;
  const utils = render(
    <DialogSwipeTabs
      tabs={stableTabs}
      activeTab="a"
      onTabChange={onTabChange}
      renderContent={renderContent}
    />,
  );
  function setActiveTab(activeTab: TabId, tabs = stableTabs) {
    utils.rerender(
      <DialogSwipeTabs
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={onTabChange}
        renderContent={renderContent}
      />,
    );
  }
  return { ...utils, onTabChange, setActiveTab };
}

describe("DialogSwipeTabs iOS WebKit tap-to-scroll fix", () => {
  afterEach(() => {
    cleanup();
  });

  describe("with scrollend support", () => {
    beforeEach(() => {
      Object.defineProperty(window, "onscrollend", {
        value: null,
        writable: true,
        configurable: true,
      });
    });

    afterEach(() => {
      Reflect.deleteProperty(window, "onscrollend");
    });

    it("keeps the tapped tab selected after a WebKit-reverted scroll fires two scrollend events", () => {
      render(<StatefulTabs />);
      const el = getSnapContainer();
      setupWebkitHarness(el);

      fireEvent.click(screen.getByRole("tab", { name: "Tab B" }));
      fireEvent(el, new Event("scrollend"));
      fireEvent(el, new Event("scrollend"));

      expect(screen.getByRole("tab", { name: "Tab B" }).getAttribute("aria-selected")).toBe("true");
    });

    it("disables scroll-snap-type before calling scrollTo", () => {
      const { setActiveTab } = renderControlled();
      const el = getSnapContainer();
      const harness = setupWebkitHarness(el);

      setActiveTab("b");

      const setPropertyIdx = harness.callOrder.findIndex((c) =>
        c.startsWith("setProperty:scroll-snap-type"),
      );
      const scrollToIdx = harness.callOrder.findIndex((c) => c.startsWith("scrollTo:"));
      expect(setPropertyIdx).toBeGreaterThanOrEqual(0);
      expect(setPropertyIdx).toBeLessThan(scrollToIdx);
    });

    it("re-enables scroll-snap-type after scrollend fires", () => {
      const { setActiveTab } = renderControlled();
      const el = getSnapContainer();
      const harness = setupWebkitHarness(el);

      setActiveTab("b");
      fireEvent(el, new Event("scrollend"));

      expect(harness.removePropertySpy).toHaveBeenCalledWith("scroll-snap-type");
    });

    it("restores scroll-snap-type when a touchstart interrupts an in-flight scroll", () => {
      const { setActiveTab } = renderControlled();
      const el = getSnapContainer();
      const harness = setupWebkitHarness(el);

      setActiveTab("b");
      fireEvent.touchStart(el);

      expect(harness.removePropertySpy).toHaveBeenCalledWith("scroll-snap-type");
    });

    it("detects a tab reached by a native swipe after a touch interrupts the animation", () => {
      const { setActiveTab, onTabChange } = renderControlled();
      const el = getSnapContainer();
      setupWebkitHarness(el);

      setActiveTab("b");
      fireEvent.touchStart(el);
      el.scrollLeft = 640; // user swipes past the interrupted target, landing on tab c
      fireEvent(el, new Event("scrollend"));

      expect(onTabChange).toHaveBeenCalledWith("c");
    });

    it("does not call scrollTo again while a touch is active, even if a re-render changes the tabs reference", () => {
      const { setActiveTab } = renderControlled();
      const el = getSnapContainer();
      Object.defineProperty(el, "clientWidth", { value: 320, configurable: true });
      Object.defineProperty(el, "scrollLeft", { value: 0, writable: true, configurable: true });
      // scrollLeft intentionally never updates, simulating a flight still in progress
      const scrollToSpy = vi.fn();
      Object.defineProperty(el, "scrollTo", { value: scrollToSpy, configurable: true });

      setActiveTab("b");
      fireEvent.touchStart(el);
      // Parent re-render regenerates tabs mid-touch while the user's finger is still
      // on the screen — this must not restart the animation.
      setActiveTab("b", [...TABS]);

      expect(scrollToSpy).toHaveBeenCalledTimes(1);
    });
  });
});
