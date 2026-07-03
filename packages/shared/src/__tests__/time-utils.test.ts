import { describe, expect, test } from "vitest";
import { computeTimeDelta, minutesToTime, shiftTime, timeToMinutes } from "../time-utils";

describe("timeToMinutes", () => {
  test("converts HH:MM to total minutes", () => {
    expect(timeToMinutes("09:30")).toBe(570);
  });

  test("converts 00:00 to 0", () => {
    expect(timeToMinutes("00:00")).toBe(0);
  });

  test("converts 23:59 to 1439", () => {
    expect(timeToMinutes("23:59")).toBe(1439);
  });

  test("converts HH:MM:SS by ignoring seconds", () => {
    expect(timeToMinutes("10:30:00")).toBe(630);
  });

  test("throws for out-of-range hours", () => {
    expect(() => timeToMinutes("24:00")).toThrow("Invalid time format");
  });

  test("throws for out-of-range minutes", () => {
    expect(() => timeToMinutes("12:99")).toThrow("Invalid time format");
  });

  test("throws for a negative minute component", () => {
    expect(() => timeToMinutes("12:-5")).toThrow("Invalid time format");
  });
});

describe("minutesToTime", () => {
  test("converts total minutes to HH:MM", () => {
    expect(minutesToTime(570)).toBe("09:30");
  });

  test("converts 0 to 00:00", () => {
    expect(minutesToTime(0)).toBe("00:00");
  });

  test("converts 1439 to 23:59", () => {
    expect(minutesToTime(1439)).toBe("23:59");
  });

  test("throws for negative minutes", () => {
    expect(() => minutesToTime(-1)).toThrow();
  });

  test("throws for minutes > 1439", () => {
    expect(() => minutesToTime(1440)).toThrow();
  });
});

describe("shiftTime", () => {
  test("shifts forward", () => {
    expect(shiftTime("10:00", 15)).toBe("10:15");
  });

  test("shifts backward", () => {
    expect(shiftTime("10:00", -30)).toBe("09:30");
  });

  test("returns null when result exceeds 23:59", () => {
    expect(shiftTime("23:50", 15)).toBeNull();
  });

  test("returns null when result is before 00:00", () => {
    expect(shiftTime("00:10", -20)).toBeNull();
  });

  test("handles HH:MM:SS input", () => {
    expect(shiftTime("10:30:00", 15)).toBe("10:45");
  });

  test("shifts to exactly 00:00", () => {
    expect(shiftTime("00:30", -30)).toBe("00:00");
  });

  test("shifts to exactly 23:59", () => {
    expect(shiftTime("23:00", 59)).toBe("23:59");
  });
});

describe("computeTimeDelta", () => {
  test("detects start time change", () => {
    const result = computeTimeDelta(
      { startTime: "10:00", endTime: "12:00" },
      { startTime: "10:30", endTime: "12:00" },
    );
    expect(result).toEqual({ delta: 30, source: "start" });
  });

  test("detects end time change", () => {
    const result = computeTimeDelta(
      { startTime: "10:00", endTime: "12:00" },
      { startTime: "10:00", endTime: "12:30" },
    );
    expect(result).toEqual({ delta: 30, source: "end" });
  });

  test("prioritizes end time when both changed", () => {
    const result = computeTimeDelta(
      { startTime: "10:00", endTime: "12:00" },
      { startTime: "10:15", endTime: "12:30" },
    );
    expect(result).toEqual({ delta: 30, source: "end" });
  });

  test("returns null when no time changed", () => {
    const result = computeTimeDelta(
      { startTime: "10:00", endTime: "12:00" },
      { startTime: "10:00", endTime: "12:00" },
    );
    expect(result).toBeNull();
  });

  test("returns null when original has no times", () => {
    const result = computeTimeDelta({}, { startTime: "10:00" });
    expect(result).toBeNull();
  });

  test("ignores end time change when endDayOffset differs", () => {
    const result = computeTimeDelta(
      { startTime: "10:00", endTime: "12:00", endDayOffset: 0 },
      { startTime: "10:30", endTime: "06:00", endDayOffset: 1 },
    );
    expect(result).toEqual({ delta: 30, source: "start" });
  });

  test("detects negative delta", () => {
    const result = computeTimeDelta(
      { startTime: "10:00", endTime: "12:00" },
      { startTime: "09:45", endTime: "12:00" },
    );
    expect(result).toEqual({ delta: -15, source: "start" });
  });

  test("returns null when end time string differs but delta is zero", () => {
    // DB stores "HH:MM:SS" while the form produces "HH:MM": string comparison
    // sees a change, but the actual minute value is identical.
    const result = computeTimeDelta(
      { startTime: "10:00:00", endTime: "12:00:00" },
      { startTime: "10:00:00", endTime: "12:00" },
    );
    expect(result).toBeNull();
  });

  test("returns null when only start time string differs but delta is zero (end branch not entered)", () => {
    const result = computeTimeDelta(
      { startTime: "10:00:00", endTime: "12:00" },
      { startTime: "10:00", endTime: "12:00" },
    );
    expect(result).toBeNull();
  });

  test("falls through to start branch when end delta is zero but start changed", () => {
    // End is only a string difference (delta 0), so it must defer to the real
    // start change rather than returning a zero-delta end result.
    const result = computeTimeDelta(
      { startTime: "10:00", endTime: "12:00:00" },
      { startTime: "10:30", endTime: "12:00" },
    );
    expect(result).toEqual({ delta: 30, source: "start" });
  });
});
