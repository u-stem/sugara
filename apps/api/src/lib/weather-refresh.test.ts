import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockFetchOfficeForecast, mockInsertValues, mockTransaction } = vi.hoisted(() => ({
  mockFetchOfficeForecast: vi.fn(),
  mockInsertValues: vi.fn(),
  mockTransaction: vi.fn(),
}));

vi.mock("./jma-weather", () => ({
  fetchOfficeForecast: (...args: unknown[]) => mockFetchOfficeForecast(...args),
}));

// db.transaction runs the callback with a tx that records insert().values()
// and delete().where(); mockTransaction lets a test force a DB failure.
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
});

describe("refreshAllWeather", () => {
  it("upserts each office that parses and counts updated/skipped", async () => {
    mockFetchOfficeForecast
      .mockResolvedValueOnce(parsed())
      .mockResolvedValueOnce(null) // fetch/parse failed -> skipped, retains prior data
      .mockResolvedValueOnce(parsed());

    const result = await refreshAllWeather({
      delayMs: 0,
      areas: [area("130000"), area("016000"), area("270000")],
    });

    expect(result).toEqual({ updated: 2, skipped: 1, total: 3 });
    expect(mockInsertValues).toHaveBeenCalledTimes(2);
    expect(mockFetchOfficeForecast).toHaveBeenCalledTimes(3);
  });

  it("fetches sub-area offices from their parent file with the area code", async () => {
    mockFetchOfficeForecast.mockResolvedValue(parsed());

    await refreshAllWeather({
      delayMs: 0,
      areas: [area("014030", { forecastOffice: "014100", areaCode: "014030" })],
    });

    expect(mockFetchOfficeForecast).toHaveBeenCalledWith("014100", "014030");
  });

  it("skips offices whose parsed forecast has no days", async () => {
    mockFetchOfficeForecast.mockResolvedValue({
      reportDatetime: "2026-06-19T11:00:00+09:00",
      days: [],
    });

    const result = await refreshAllWeather({ delayMs: 0, areas: [area("130000")] });

    expect(result).toEqual({ updated: 0, skipped: 1, total: 1 });
    expect(mockInsertValues).not.toHaveBeenCalled();
  });

  it("does not let one fetch failure abort the whole run", async () => {
    mockFetchOfficeForecast.mockResolvedValueOnce(null).mockResolvedValueOnce(parsed());

    const result = await refreshAllWeather({
      delayMs: 0,
      areas: [area("a"), area("b")],
    });

    expect(result.updated).toBe(1);
    expect(result.skipped).toBe(1);
  });

  it("counts a DB failure as a skip without aborting other offices", async () => {
    mockFetchOfficeForecast.mockResolvedValue(parsed());
    // First office's transaction throws (e.g. transient pooler error); the
    // second must still be processed.
    mockTransaction
      .mockRejectedValueOnce(new Error("pooler down"))
      .mockImplementationOnce((fn: (t: typeof tx) => Promise<unknown>) => fn(tx));

    const result = await refreshAllWeather({
      delayMs: 0,
      areas: [area("a"), area("b")],
    });

    expect(result).toEqual({ updated: 1, skipped: 1, total: 2 });
  });
});
