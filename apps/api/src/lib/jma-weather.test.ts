import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchOfficeForecast, parseForecast } from "./jma-weather";

vi.mock("./logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

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

  it("uses the 3-day detail for today (omitted by the weekly feed)", () => {
    const result = parseForecast(fixture("130000"));
    if (!result) throw new Error("expected parse");
    expect(result.days[0]).toEqual({
      date: "2026-06-19",
      weatherCode: "111",
      pop: 30, // max of the 6h buckets
      // The 3-day series has only one spot reading for today, so tempMin is left
      // null rather than mirroring tempMax (avoids a misleading "30°/30°").
      tempMin: null,
      tempMax: 30,
      reliability: null,
    });
  });

  it("fills the boundary day (empty in weekly) from the 3-day forecast", () => {
    const result = parseForecast(fixture("130000"));
    if (!result) throw new Error("expected parse");
    expect(result.days[1]).toEqual({
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

  it("drops days whose weather code is missing (empty string)", () => {
    const raw = [
      {}, // 3-day element absent, so only the weekly pass runs
      {
        reportDatetime: "2026-06-19T11:00:00+09:00",
        timeSeries: [
          {
            timeDefines: ["2026-06-20T00:00:00+09:00", "2026-06-21T00:00:00+09:00"],
            areas: [{ area: { code: "x" }, weatherCodes: ["200", ""], pops: ["10", "20"] }],
          },
        ],
      },
    ];
    const result = parseForecast(raw);
    if (!result) throw new Error("expected parse");
    expect(result.days.map((d) => d.date)).toEqual(["2026-06-20"]);
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

function streamedResponse(body: Uint8Array, headers: Record<string, string> = {}): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(body);
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers });
}

describe("fetchOfficeForecast", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parses a streamed forecast body", async () => {
    const bytes = new TextEncoder().encode(JSON.stringify(fixture("130000")));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(streamedResponse(bytes)));
    const result = await fetchOfficeForecast("130000");
    expect(result?.days).toHaveLength(7);
  });

  it("returns null when the streamed body exceeds the size cap", async () => {
    const huge = new Uint8Array(5_000_001);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(streamedResponse(huge)));
    const result = await fetchOfficeForecast("130000");
    expect(result).toBeNull();
  });

  it("returns null on a non-OK response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 503 })));
    const result = await fetchOfficeForecast("130000");
    expect(result).toBeNull();
  });
});
