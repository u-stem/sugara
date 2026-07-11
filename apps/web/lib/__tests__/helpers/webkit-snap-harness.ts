import { screen } from "@testing-library/react";
import { vi } from "vitest";

// jsdom leaves clientWidth/scrollWidth at 0 and does not implement scroll-snap or
// programmatic scrollTo, so this harness injects WebKit-like DOM behavior manually.
// Shared by sp-swipe-tabs.test.tsx and dialog-swipe-tabs.test.tsx, which both render
// role="tabpanel" panels inside a single scroll-snap container.
export function getSnapContainer(): HTMLElement {
  const panel = screen.getAllByRole("tabpanel", { hidden: true })[0];
  const container = panel.parentElement;
  if (!container) throw new Error("snap container not found in DOM");
  return container;
}

export type WebkitHarness = {
  setPropertySpy: ReturnType<typeof vi.fn>;
  removePropertySpy: ReturnType<typeof vi.fn>;
  scrollToSpy: ReturnType<typeof vi.fn>;
  callOrder: string[];
};

// Emulates the WebKit bug the scroll-snap-type workaround targets: a smooth
// scrollTo() on a snap-mandatory container is reverted unless scroll-snap-type is
// disabled first (tracked via the style.setProperty/removeProperty spies), or the
// scroll is instant.
export function setupWebkitHarness(
  el: HTMLElement,
  panelWidth = 320,
  panelCount = 3,
): WebkitHarness {
  let snapDisabled = false;
  const callOrder: string[] = [];

  Object.defineProperty(el, "clientWidth", { value: panelWidth, configurable: true });
  Object.defineProperty(el, "scrollWidth", { value: panelWidth * panelCount, configurable: true });
  Object.defineProperty(el, "scrollLeft", { value: 0, writable: true, configurable: true });

  const setPropertySpy = vi.fn((prop: string, value: string) => {
    callOrder.push(`setProperty:${prop}:${value}`);
    if (prop === "scroll-snap-type") snapDisabled = value === "none";
  });
  const removePropertySpy = vi.fn((prop: string) => {
    callOrder.push(`removeProperty:${prop}`);
    if (prop === "scroll-snap-type") snapDisabled = false;
  });
  Object.defineProperty(el.style, "setProperty", { value: setPropertySpy, configurable: true });
  Object.defineProperty(el.style, "removeProperty", {
    value: removePropertySpy,
    configurable: true,
  });

  const scrollToSpy = vi.fn((opts: ScrollToOptions) => {
    callOrder.push(`scrollTo:${opts.left}:${opts.behavior}`);
    if (opts.left === undefined) return;
    if (snapDisabled || opts.behavior === "instant") {
      el.scrollLeft = opts.left;
    }
  });
  Object.defineProperty(el, "scrollTo", { value: scrollToSpy, configurable: true });

  return { setPropertySpy, removePropertySpy, scrollToSpy, callOrder };
}
