import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseForecast } from "./jma-weather";

const fixture = (office: string) =>
  JSON.parse(
    readFileSync(join(__dirname, "../__tests__/fixtures", `jma-forecast-${office}.json`), "utf-8"),
  );

describe("parseForecast", () => {
  it("parses the Tokyo (130000) weekly forecast", () => {
    const result = parseForecast(fixture("130000"));
    expect(result).not.toBeNull();
    if (!result) return;

    expect(result.reportDatetime).toBe("2026-06-19T11:00:00+09:00");
    expect(result.days).toHaveLength(7);
    // Sorted ascending, starting today (the 3-day forecast supplies today).
    expect(result.days.map((d) => d.date)).toEqual([
      "2026-06-19",
      "2026-06-20",
      "2026-06-21",
      "2026-06-22",
      "2026-06-23",
      "2026-06-24",
      "2026-06-25",
    ]);
  });

  it("uses the 3-day detail for today and the boundary day", () => {
    const result = parseForecast(fixture("130000"));
    if (!result) throw new Error("expected parse");
    const today = result.days[0];
    expect(today).toEqual({
      date: "2026-06-19",
      weatherCode: "111",
      pop: 30, // max of the 6h buckets
      // The 3-day series has only one spot reading for today, so tempMin is left
      // null rather than mirroring tempMax (avoids a misleading "30°/30°").
      tempMin: null,
      tempMax: 30,
      reliability: null,
    });
    // Boundary day: weekly is empty, filled by the 3-day forecast.
    const tomorrow = result.days[1];
    expect(tomorrow).toEqual({
      date: "2026-06-20",
      weatherCode: "214",
      pop: 70,
      tempMin: 21,
      tempMax: 26,
      reliability: null,
    });
  });

  it("uses the clean weekly min/max temps and reliability for later days", () => {
    const result = parseForecast(fixture("130000"));
    if (!result) throw new Error("expected parse");
    const day = result.days.find((d) => d.date === "2026-06-22");
    expect(day).toEqual({
      date: "2026-06-22",
      weatherCode: "200",
      pop: 40,
      tempMin: 19,
      tempMax: 26,
      reliability: "C",
    });
  });

  it("selects a sub-area by code within a shared parent file (十勝 in 014100)", () => {
    // 014030 (十勝) has no standalone file; it is a secondary area in 014100.
    const result = parseForecast(fixture("014100"), "014030");
    if (!result) throw new Error("expected parse");
    // Weekly-only (3-day enrichment skipped for sub-area offices): starts at the
    // weekly boundary day and uses 帯広's temperatures, not 釧路's.
    const day = result.days.find((d) => d.date === "2026-06-21");
    expect(day).toMatchObject({ weatherCode: "200", pop: 40, tempMin: 11, tempMax: 18 });
    // The last weekly day differs from the representative area (014100 -> "200").
    expect(result.days.find((d) => d.date === "2026-06-26")?.weatherCode).toBe("201");
  });

  it("falls back to the representative area when no areaCode is given", () => {
    const result = parseForecast(fixture("014100"));
    if (!result) throw new Error("expected parse");
    // Representative area 0 is 釧路 (temps 10/15 on 06-21), not 帯広 (11/18).
    const day = result.days.find((d) => d.date === "2026-06-21");
    expect(day).toMatchObject({ tempMin: 10, tempMax: 15 });
  });

  it("parses a Hokkaido sub-region office (016000) without throwing", () => {
    const result = parseForecast(fixture("016000"));
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.days.length).toBeGreaterThan(0);
    expect(result.days.length).toBeLessThanOrEqual(7);
    for (const d of result.days) {
      expect(d.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(typeof d.weatherCode).toBe("string");
    }
  });

  it("returns null for structurally invalid input", () => {
    expect(parseForecast(null)).toBeNull();
    expect(parseForecast([])).toBeNull();
    expect(parseForecast([{}])).toBeNull(); // missing weekly element
    expect(parseForecast([{}, {}])).toBeNull(); // weekly has no timeSeries
    expect(
      parseForecast([{}, { timeSeries: [{ timeDefines: [], areas: [{ weatherCodes: [] }] }] }]),
    ).toBeNull(); // empty weekly dates
  });
});
