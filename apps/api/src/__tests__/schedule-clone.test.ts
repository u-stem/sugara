import { describe, expect, it } from "vitest";
import { buildScheduleCloneValues } from "../lib/schedule-clone";

describe("buildScheduleCloneValues", () => {
  const source = {
    id: "orig-id",
    tripId: "orig-trip",
    dayPatternId: "orig-pattern",
    name: "Tokyo Tower",
    category: "place" as const,
    address: "Minato, Tokyo",
    startTime: "09:00",
    endTime: "11:00",
    sortOrder: 5,
    memo: "Some notes",
    urls: ["https://example.com"],
    departurePlace: "Station A",
    arrivalPlace: "Station B",
    transportMethod: "train" as const,
    cost: 580,
    color: "red" as const,
    latitude: 35.6586,
    longitude: 139.7454,
    placeId: "ChIJCewJkL2LGGAR3Qmk0vCTGkg",
    endDayOffset: 1,
    createdAt: new Date("2025-01-01"),
    updatedAt: new Date("2025-01-01"),
  };

  it("copies all content fields from source", () => {
    const result = buildScheduleCloneValues(source);

    expect(result).toEqual({
      name: "Tokyo Tower",
      category: "place",
      address: "Minato, Tokyo",
      startTime: "09:00",
      endTime: "11:00",
      sortOrder: 5,
      memo: "Some notes",
      urls: ["https://example.com"],
      departurePlace: "Station A",
      arrivalPlace: "Station B",
      transportMethod: "train",
      cost: 580,
      color: "red",
      latitude: 35.6586,
      longitude: 139.7454,
      placeId: "ChIJCewJkL2LGGAR3Qmk0vCTGkg",
      endDayOffset: 1,
    });
  });

  it("excludes id, tripId, dayPatternId, createdAt, updatedAt", () => {
    const result = buildScheduleCloneValues(source);

    expect(result).not.toHaveProperty("id");
    expect(result).not.toHaveProperty("tripId");
    expect(result).not.toHaveProperty("dayPatternId");
    expect(result).not.toHaveProperty("createdAt");
    expect(result).not.toHaveProperty("updatedAt");
  });

  it("applies overrides", () => {
    const result = buildScheduleCloneValues(source, { sortOrder: 99 });

    expect(result.sortOrder).toBe(99);
    expect(result.name).toBe("Tokyo Tower");
  });

  it("handles null fields", () => {
    const nullSource = {
      ...source,
      address: null,
      startTime: null,
      endTime: null,
      memo: null,
      departurePlace: null,
      arrivalPlace: null,
      transportMethod: null,
      cost: null,
      latitude: null,
      longitude: null,
      placeId: null,
      endDayOffset: null,
    };
    const result = buildScheduleCloneValues(nullSource);

    expect(result.address).toBeNull();
    expect(result.startTime).toBeNull();
    expect(result.endTime).toBeNull();
    expect(result.memo).toBeNull();
    expect(result.departurePlace).toBeNull();
    expect(result.arrivalPlace).toBeNull();
    expect(result.transportMethod).toBeNull();
    expect(result.cost).toBeNull();
    expect(result.latitude).toBeNull();
    expect(result.longitude).toBeNull();
    expect(result.placeId).toBeNull();
    expect(result.endDayOffset).toBeNull();
  });
});
