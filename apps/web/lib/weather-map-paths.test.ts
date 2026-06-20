import { describe, expect, it } from "vitest";
import { WEATHER_GROUPS } from "./weather-area-i18n";
import { WEATHER_MAP_PATHS } from "./weather-map-paths";

// Guards against adding a forecast region without regenerating the map: every
// officeCode the navigator can route to must have a path to highlight.
describe("weather-map-paths", () => {
  it("has a path for every forecast region in WEATHER_GROUPS", () => {
    const missing = WEATHER_GROUPS.flatMap((g) => g.officeCodes).filter(
      (code) => !WEATHER_MAP_PATHS[code],
    );
    expect(missing).toEqual([]);
  });
});
