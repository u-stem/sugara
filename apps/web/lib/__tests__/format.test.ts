import { describe, expect, it } from "vitest";
import {
  compareByStartTime,
  formatDate,
  formatDateFromISO,
  formatDateRange,
  formatDateShort,
  formatTime,
  formatTimeRange,
  getDayCount,
  isSafeUrl,
  validateTimeRange,
} from "../format";

describe("formatDate", () => {
  it("formats a date string to Japanese format", () => {
    expect(formatDate("2025-04-01")).toBe("2025年4月1日");
  });

  it("handles double-digit months and days", () => {
    expect(formatDate("2025-12-25")).toBe("2025年12月25日");
  });

  it("handles single-digit month and day", () => {
    expect(formatDate("2025-01-03")).toBe("2025年1月3日");
  });
});

describe("formatDateFromISO", () => {
  it("formats an ISO datetime string to Japanese format", () => {
    expect(formatDateFromISO("2026-02-18T00:00:00.000Z")).toBe("2026年2月18日");
  });

  it("formats an ISO datetime with timezone offset", () => {
    expect(formatDateFromISO("2026-03-06T15:00:00+09:00")).toBe("2026年3月6日");
  });
});

describe("formatDateShort", () => {
  it("formats as M/D without year", () => {
    expect(formatDateShort("2025-04-01")).toBe("4/1");
  });

  it("handles double-digit months and days", () => {
    expect(formatDateShort("2025-12-25")).toBe("12/25");
  });
});

describe("formatDateRange", () => {
  it("formats a date range", () => {
    expect(formatDateRange("2025-04-01", "2025-04-03")).toBe("2025年4月1日 - 2025年4月3日");
  });
});

describe("formatTime", () => {
  it("strips seconds from HH:MM:SS format", () => {
    expect(formatTime("09:00:00")).toBe("09:00");
  });

  it("returns HH:MM as-is when no seconds", () => {
    expect(formatTime("14:45")).toBe("14:45");
  });
});

describe("formatTimeRange", () => {
  it("formats both start and end time", () => {
    expect(formatTimeRange("09:00", "17:30")).toBe("09:00 - 17:30");
  });

  it("strips seconds from HH:MM:SS format", () => {
    expect(formatTimeRange("09:00:00", "17:30:00")).toBe("09:00 - 17:30");
  });

  it("formats start time only", () => {
    expect(formatTimeRange("09:00", null)).toBe("09:00");
  });

  it("formats end time only", () => {
    expect(formatTimeRange(null, "17:30")).toBe("- 17:30");
  });

  it("returns empty string when both are null", () => {
    expect(formatTimeRange(null, null)).toBe("");
  });

  it("returns empty string when both are undefined", () => {
    expect(formatTimeRange(undefined, undefined)).toBe("");
  });
});

describe("validateTimeRange", () => {
  it("returns null when both times are valid", () => {
    expect(validateTimeRange("09:00", "17:00")).toBeNull();
  });

  it("returns null when only start time is set", () => {
    expect(validateTimeRange("09:00", undefined)).toBeNull();
  });

  it("returns null when neither time is set", () => {
    expect(validateTimeRange(undefined, undefined)).toBeNull();
  });

  it("returns message key when end time is set without start time", () => {
    expect(validateTimeRange(undefined, "17:00")).toBe("timeStartRequired");
  });

  it("returns message key when start time equals end time", () => {
    expect(validateTimeRange("09:00", "09:00")).toBe("timeEndBeforeStart");
  });

  it("returns message key when start time is after end time", () => {
    expect(validateTimeRange("18:00", "09:00")).toBe("timeEndBeforeStart");
  });

  it("allows overnight time range for hotel category", () => {
    expect(validateTimeRange("15:00", "10:00", { allowOvernight: true })).toBeNull();
  });

  it("still requires start time for hotel when only end time is set", () => {
    expect(validateTimeRange(undefined, "10:00", { allowOvernight: true })).toBe(
      "timeStartRequired",
    );
  });

  it("returns hotel-specific key when end time is set without start time", () => {
    expect(validateTimeRange(undefined, "10:00", { category: "hotel" })).toBe(
      "timeHotelCheckinRequired",
    );
  });

  it("returns transport-specific key when end time is set without start time", () => {
    expect(validateTimeRange(undefined, "10:00", { category: "transport" })).toBe(
      "timeTransportDepartureRequired",
    );
  });

  it("returns hotel-specific key when end time is before start time", () => {
    expect(validateTimeRange("18:00", "09:00", { category: "hotel" })).toBe(
      "timeHotelCheckoutAfter",
    );
  });

  it("returns transport-specific key when end time is before start time", () => {
    expect(validateTimeRange("18:00", "09:00", { category: "transport" })).toBe(
      "timeTransportArrivalAfter",
    );
  });
});

describe("compareByStartTime", () => {
  it("sorts spots with earlier startTime first", () => {
    expect(compareByStartTime({ startTime: "09:00" }, { startTime: "10:00" })).toBeLessThan(0);
  });

  it("sorts spots with later startTime after", () => {
    expect(compareByStartTime({ startTime: "14:00" }, { startTime: "09:00" })).toBeGreaterThan(0);
  });

  it("returns 0 for equal startTimes", () => {
    expect(compareByStartTime({ startTime: "09:00" }, { startTime: "09:00" })).toBe(0);
  });

  it("returns 0 when both have no startTime", () => {
    expect(compareByStartTime({ startTime: null }, { startTime: null })).toBe(0);
  });

  it("returns 0 when both startTime are undefined", () => {
    expect(compareByStartTime({}, {})).toBe(0);
  });

  it("places spot without startTime after spot with startTime", () => {
    expect(compareByStartTime({ startTime: "09:00" }, { startTime: null })).toBeLessThan(0);
  });

  it("places spot without startTime after spot with startTime (reversed)", () => {
    expect(compareByStartTime({ startTime: null }, { startTime: "09:00" })).toBeGreaterThan(0);
  });

  it("handles HH:MM:SS format", () => {
    expect(compareByStartTime({ startTime: "09:00:00" }, { startTime: "10:00:00" })).toBeLessThan(
      0,
    );
  });
});

describe("getDayCount", () => {
  it("returns 1 for same start and end date", () => {
    expect(getDayCount("2025-04-01", "2025-04-01")).toBe(1);
  });

  it("returns correct count for multi-day range", () => {
    expect(getDayCount("2025-04-01", "2025-04-03")).toBe(3);
  });

  it("handles month boundaries", () => {
    expect(getDayCount("2025-01-30", "2025-02-01")).toBe(3);
  });

  it("handles year boundaries", () => {
    expect(getDayCount("2025-12-30", "2026-01-02")).toBe(4);
  });
});

describe("isSafeUrl", () => {
  it.each(["https://example.com", "http://example.com/path?q=1", "https://a.b.c:8080/"])(
    "returns true for safe URL '%s'",
    (url) => {
      expect(isSafeUrl(url)).toBe(true);
    },
  );

  it.each([
    "javascript:alert(1)",
    "javascript:void(0)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox",
    "not-a-url",
    "",
  ])("returns false for dangerous or invalid URL '%s'", (url) => {
    expect(isSafeUrl(url)).toBe(false);
  });
});
