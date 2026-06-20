import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockFetchOfficeForecast, mockInsertValues, mockTransaction, mockFreshRows } = vi.hoisted(
  () => ({
    mockFetchOfficeForecast: vi.fn(),
    mockInsertValues: vi.fn(),
    mockTransaction: vi.fn(),
    mockFreshRows: vi.fn(),
  }),
);

vi.mock("./jma-weather", () => ({
  fetchOfficeForecast: (...args: unknown[]) => mockFetchOfficeForecast(...args),
}));

// db.transaction runs the callback with a tx that records insert().values()
// and delete().where(); mockTransaction lets a test force a DB failure.
// selectDistinct(...).from(...).where(...) resolves to the "fresh" office rows
// for onlyStale runs.
const tx = {
  insert: () => ({
    values: (...args: unknown[]) => {
      mockInsertValues(...args);
      return { onConflictDoUpdate: () => Promise.resolve() };
    },
  }),
  delete: () => ({ where: () => Promise.resolve() }),
};

vi.mock("../db/index", () => ({
  db: {
    transaction: (fn: (t: typeof tx) => Promise<unknown>) => mockTransaction(fn),
    selectDistinct: () => ({ from: () => ({ where: () => mockFreshRows() }) }),
  },
}));

import type { WeatherAreaSeed } from "../db/weather-areas-data";
import { refreshAllWeather } from "./weather-refresh";

const area = (officeCode: string, extra: Partial<WeatherAreaSeed> = {}): WeatherAreaSeed => ({
  officeCode,
  name: officeCode,
  centerCode: "c",
  centerName: "center",
  sortOrder: 0,
  ...extra,
});

const parsed = () => ({
  reportDatetime: "2026-06-19T11:00:00+09:00",
  days: [
    {
      date: "2026-06-19",
      weatherCode: "100",
      pop: 10,
      tempMin: 20,
      tempMax: 28,
      reliability: null,
    },
  ],
});

beforeEach(() => {
  vi.clearAllMocks();
  mockTransaction.mockImplementation((fn: (t: typeof tx) => Promise<unknown>) => fn(tx));
  mockFreshRows.mockResolvedValue([]);
});

describe("refreshAllWeather", () => {
  it("upserts each office that parses and counts updated/skipped", async () => {
    mockFetchOfficeForecast
      .mockResolvedValueOnce(parsed())
      .mockResolvedValueOnce(null) // fetch/parse failed -> skipped, retains prior data
      .mockResolvedValueOnce(parsed());

    const result = await refreshAllWeather({
      areas: [area("130000"), area("016000"), area("270000")],
    });

    expect(result).toEqual({ updated: 2, skipped: 1, remaining: 0, total: 3 });
  });

  it("writes one row set per office that parsed", async () => {
    mockFetchOfficeForecast.mockResolvedValueOnce(parsed()).mockResolvedValueOnce(parsed());

    await refreshAllWeather({ areas: [area("130000"), area("270000")] });

    expect(mockInsertValues).toHaveBeenCalledTimes(2);
  });

  it("fetches sub-area offices from their parent file with the area code", async () => {
    mockFetchOfficeForecast.mockResolvedValue(parsed());

    await refreshAllWeather({
      areas: [area("014030", { forecastOffice: "014100", areaCode: "014030" })],
    });

    expect(mockFetchOfficeForecast).toHaveBeenCalledWith("014100", "014030");
  });

  it("skips offices whose parsed forecast has no days", async () => {
    mockFetchOfficeForecast.mockResolvedValue({
      reportDatetime: "2026-06-19T11:00:00+09:00",
      days: [],
    });

    const result = await refreshAllWeather({ areas: [area("130000")] });

    expect(result).toEqual({ updated: 0, skipped: 1, remaining: 0, total: 1 });
  });

  it("does not write a row set for an office with no days", async () => {
    mockFetchOfficeForecast.mockResolvedValue({
      reportDatetime: "2026-06-19T11:00:00+09:00",
      days: [],
    });

    await refreshAllWeather({ areas: [area("130000")] });

    expect(mockInsertValues).not.toHaveBeenCalled();
  });

  it("does not let one fetch failure abort the whole run", async () => {
    mockFetchOfficeForecast.mockResolvedValueOnce(null).mockResolvedValueOnce(parsed());

    const result = await refreshAllWeather({ areas: [area("a"), area("b")] });

    expect(result).toMatchObject({ updated: 1, skipped: 1 });
  });

  it("counts a DB failure as a skip without aborting other offices", async () => {
    mockFetchOfficeForecast.mockResolvedValue(parsed());
    // First office's transaction throws (e.g. transient pooler error); the
    // second must still be processed.
    mockTransaction
      .mockRejectedValueOnce(new Error("pooler down"))
      .mockImplementationOnce((fn: (t: typeof tx) => Promise<unknown>) => fn(tx));

    const result = await refreshAllWeather({ areas: [area("a"), area("b")] });

    expect(result).toEqual({ updated: 1, skipped: 1, remaining: 0, total: 2 });
  });

  describe("onlyStale", () => {
    it("skips offices already refreshed today", async () => {
      mockFreshRows.mockResolvedValue([{ officeCode: "130000" }]);
      mockFetchOfficeForecast.mockResolvedValue(parsed());

      await refreshAllWeather({ onlyStale: true, areas: [area("130000"), area("270000")] });

      expect(mockFetchOfficeForecast).toHaveBeenCalledExactlyOnceWith("270000", undefined);
    });

    it("reports total against all offices, not just the stale subset", async () => {
      mockFreshRows.mockResolvedValue([{ officeCode: "130000" }]);
      mockFetchOfficeForecast.mockResolvedValue(parsed());

      const result = await refreshAllWeather({
        onlyStale: true,
        areas: [area("130000"), area("270000")],
      });

      expect(result).toEqual({ updated: 1, skipped: 0, remaining: 0, total: 2 });
    });
  });

  describe("deadlineMs", () => {
    it("leaves all offices as remaining when the budget is already spent", async () => {
      mockFetchOfficeForecast.mockResolvedValue(parsed());

      const result = await refreshAllWeather({
        areas: [area("a"), area("b")],
        deadlineMs: Date.now() - 1,
      });

      expect(result).toEqual({ updated: 0, skipped: 0, remaining: 2, total: 2 });
    });

    it("does not fetch any office once the budget is spent", async () => {
      mockFetchOfficeForecast.mockResolvedValue(parsed());

      await refreshAllWeather({ areas: [area("a")], deadlineMs: Date.now() - 1 });

      expect(mockFetchOfficeForecast).not.toHaveBeenCalled();
    });

    it("counts only stale-and-unprocessed offices as remaining", async () => {
      // 130000 is fresh (skipped before the budget check); of the two stale
      // offices the budget is already spent, so both stay remaining.
      mockFreshRows.mockResolvedValue([{ officeCode: "130000" }]);
      mockFetchOfficeForecast.mockResolvedValue(parsed());

      const result = await refreshAllWeather({
        onlyStale: true,
        areas: [area("130000"), area("270000"), area("016000")],
        deadlineMs: Date.now() - 1,
      });

      expect(result).toEqual({ updated: 0, skipped: 0, remaining: 2, total: 3 });
    });
  });
});
