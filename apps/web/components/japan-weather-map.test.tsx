import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renderWithIntl } from "@/lib/test-utils";
import { JapanWeatherMap } from "./japan-weather-map";

describe("JapanWeatherMap", () => {
  afterEach(cleanup);

  it("highlights the active region path", () => {
    const { container } = renderWithIntl(<JapanWeatherMap officeCode="130000" />);
    const active = container.querySelector('path[data-office="130000"]');
    expect(active?.getAttribute("class")).toContain("fill-chart-1");
  });

  it("does not highlight sibling regions in the same center region", () => {
    // 080000 (Ibaraki) shares the Kanto-Koshin center region with 130000 (Tokyo).
    const { container } = renderWithIntl(<JapanWeatherMap officeCode="130000" />);
    const sibling = container.querySelector('path[data-office="080000"]');
    expect(sibling?.getAttribute("class")).not.toContain("fill-chart-1");
  });

  it("renders only the active center region's offices", () => {
    // 011000 (Soya, Hokkaido) is outside Tokyo's center region, so it is not drawn.
    const { container } = renderWithIntl(<JapanWeatherMap officeCode="130000" />);
    expect(container.querySelector('path[data-office="011000"]')).toBeNull();
  });

  it("keeps subdivided Hokkaido regions as distinct paths", () => {
    const { container } = renderWithIntl(<JapanWeatherMap officeCode="014030" />);
    const tokachi = container.querySelector('path[data-office="014030"]');
    const kushiro = container.querySelector('path[data-office="014100"]');
    expect(tokachi).not.toBe(kushiro);
  });

  it("exposes the map as an accessible image", () => {
    renderWithIntl(<JapanWeatherMap officeCode="130000" />);
    expect(screen.getByRole("img")).toBeDefined();
  });

  it("renders nothing for an unknown officeCode", () => {
    const { container } = renderWithIntl(<JapanWeatherMap officeCode="999999" />);
    expect(container.querySelector("svg")).toBeNull();
  });
});
