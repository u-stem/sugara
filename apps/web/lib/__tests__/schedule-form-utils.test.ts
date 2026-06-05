import { SCHEDULE_MAX_COST } from "@sugara/shared";
import { describe, expect, it } from "vitest";
import { buildSchedulePayload } from "../schedule-form-utils";

function makeFormData(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) {
    fd.set(k, v);
  }
  return fd;
}

const baseState = {
  category: "sightseeing" as const,
  color: "blue" as const,
  startTime: undefined,
  endTime: undefined,
  transportMethod: "" as const,
  endDayOffset: 0,
  urls: [] as string[],
};

describe("buildSchedulePayload", () => {
  it("returns basic fields from formData and state", () => {
    const fd = makeFormData({ name: "Kinkaku-ji", memo: "Golden Pavilion" });
    const result = buildSchedulePayload(fd, baseState);

    expect(result.name).toBe("Kinkaku-ji");
    expect(result.category).toBe("sightseeing");
    expect(result.color).toBe("blue");
    expect(result.memo).toBe("Golden Pavilion");
    expect(result.urls).toEqual([]);
  });

  it("filters out empty string URLs", () => {
    const fd = makeFormData({ name: "Place" });
    const result = buildSchedulePayload(fd, {
      ...baseState,
      urls: ["https://example.com", "", "https://maps.google.com", ""],
    });

    expect(result.urls).toEqual(["https://example.com", "https://maps.google.com"]);
  });

  it("filters out whitespace-only URLs", () => {
    const fd = makeFormData({ name: "Place" });
    const result = buildSchedulePayload(fd, {
      ...baseState,
      urls: ["  ", "https://example.com", "\t"],
    });

    expect(result.urls).toEqual(["https://example.com"]);
  });

  it("returns empty array when all URLs are empty", () => {
    const fd = makeFormData({ name: "Place" });
    const result = buildSchedulePayload(fd, {
      ...baseState,
      urls: ["", "  "],
    });

    expect(result.urls).toEqual([]);
  });

  it("includes transport fields when category is transport", () => {
    const fd = makeFormData({
      name: "Shinkansen",
      departurePlace: "Tokyo",
      arrivalPlace: "Osaka",
    });
    const result = buildSchedulePayload(fd, {
      ...baseState,
      category: "transport",
      transportMethod: "shinkansen",
    });

    expect(result.departurePlace).toBe("Tokyo");
    expect(result.arrivalPlace).toBe("Osaka");
    expect(result.transportMethod).toBe("shinkansen");
  });

  it("parses cost as an integer when category is transport", () => {
    const fd = makeFormData({ name: "Shinkansen", cost: "580" });
    const result = buildSchedulePayload(fd, {
      ...baseState,
      category: "transport",
      transportMethod: "shinkansen",
    });

    expect(result.cost).toBe(580);
  });

  it("sends null cost when the field is empty", () => {
    const fd = makeFormData({ name: "Walk", cost: "" });
    const result = buildSchedulePayload(fd, {
      ...baseState,
      category: "transport",
    });

    expect(result.cost).toBeNull();
  });

  it("sends null cost for non-integer or negative input", () => {
    const fd = makeFormData({ name: "Move", cost: "-5" });
    const result = buildSchedulePayload(fd, {
      ...baseState,
      category: "transport",
    });

    expect(result.cost).toBeNull();
  });

  it("sends null cost when input exceeds SCHEDULE_MAX_COST", () => {
    const fd = makeFormData({ name: "Move", cost: String(SCHEDULE_MAX_COST + 1) });
    const result = buildSchedulePayload(fd, {
      ...baseState,
      category: "transport",
    });

    expect(result.cost).toBeNull();
  });

  it("accepts cost exactly at SCHEDULE_MAX_COST", () => {
    const fd = makeFormData({ name: "Move", cost: String(SCHEDULE_MAX_COST) });
    const result = buildSchedulePayload(fd, {
      ...baseState,
      category: "transport",
    });

    expect(result.cost).toBe(SCHEDULE_MAX_COST);
  });

  it("excludes cost when category is not transport", () => {
    const fd = makeFormData({ name: "Place", cost: "500" });
    const result = buildSchedulePayload(fd, baseState);

    expect(result).not.toHaveProperty("cost");
  });

  it("excludes transport fields when category is not transport", () => {
    const fd = makeFormData({ name: "Place" });
    const result = buildSchedulePayload(fd, baseState);

    expect(result).not.toHaveProperty("departurePlace");
    expect(result).not.toHaveProperty("arrivalPlace");
    expect(result).not.toHaveProperty("transportMethod");
  });

  it("includes endDayOffset when greater than 0", () => {
    const fd = makeFormData({ name: "Hotel" });
    const result = buildSchedulePayload(fd, {
      ...baseState,
      endDayOffset: 2,
    });

    expect(result.endDayOffset).toBe(2);
  });

  it("excludes endDayOffset when 0", () => {
    const fd = makeFormData({ name: "Place" });
    const result = buildSchedulePayload(fd, baseState);

    expect(result).not.toHaveProperty("endDayOffset");
  });

  it("sends null for cleared memo (not undefined)", () => {
    const fd = makeFormData({ name: "Place", memo: "" });
    const result = buildSchedulePayload(fd, baseState);

    expect(result.memo).toBeNull();
  });

  it("sends null for cleared address (not undefined)", () => {
    const fd = makeFormData({ name: "Place", address: "" });
    const result = buildSchedulePayload(fd, baseState);

    expect(result.address).toBeNull();
  });

  it("sends null for cleared transport places", () => {
    const fd = makeFormData({ name: "Move", departurePlace: "", arrivalPlace: "" });
    const result = buildSchedulePayload(fd, {
      ...baseState,
      category: "transport",
    });

    expect(result.departurePlace).toBeNull();
    expect(result.arrivalPlace).toBeNull();
  });
});
