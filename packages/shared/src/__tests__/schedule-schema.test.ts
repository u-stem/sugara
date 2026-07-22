import { describe, expect, it } from "vitest";
import {
  createCandidateSchema,
  createScheduleSchema,
  reorderSchedulesSchema,
  scheduleCategorySchema,
  transportMethodSchema,
  updateScheduleSchema,
} from "../schemas/schedule";

describe("scheduleCategorySchema", () => {
  it.each(["sightseeing", "restaurant", "hotel", "transport", "activity", "other"])(
    "accepts '%s'",
    (cat) => {
      expect(scheduleCategorySchema.safeParse(cat).success).toBe(true);
    },
  );

  it("rejects invalid category", () => {
    expect(scheduleCategorySchema.safeParse("invalid").success).toBe(false);
  });
});

describe("createScheduleSchema", () => {
  it("validates a valid schedule", () => {
    const result = createScheduleSchema.safeParse({
      name: "Kinkaku-ji",
      category: "sightseeing",
    });
    expect(result.success).toBe(true);
  });

  it("validates schedule with all optional fields", () => {
    const result = createScheduleSchema.safeParse({
      name: "Kinkaku-ji",
      category: "sightseeing",
      address: "1 Kinkakujicho, Kita Ward, Kyoto",
      startTime: "09:00",
      endTime: "10:30",
      memo: "Golden Pavilion",
      urls: ["https://example.com"],
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty name", () => {
    const result = createScheduleSchema.safeParse({
      name: "",
      category: "sightseeing",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid time format", () => {
    const result = createScheduleSchema.safeParse({
      name: "Schedule",
      category: "sightseeing",
      startTime: "9:00",
    });
    expect(result.success).toBe(false);
  });

  it.each(["https://example.com", "http://example.com/path?q=1"])(
    "accepts safe URL '%s'",
    (url) => {
      const result = createScheduleSchema.safeParse({
        name: "Place",
        category: "sightseeing",
        urls: [url],
      });
      expect(result.success).toBe(true);
    },
  );

  it("accepts multiple URLs up to 5", () => {
    const result = createScheduleSchema.safeParse({
      name: "Place",
      category: "sightseeing",
      urls: ["https://example.com", "https://maps.google.com", "https://review.example.com"],
    });
    expect(result.success).toBe(true);
  });

  it("rejects more than 5 URLs", () => {
    const result = createScheduleSchema.safeParse({
      name: "Place",
      category: "sightseeing",
      urls: Array.from({ length: 6 }, (_, i) => `https://example.com/${i}`),
    });
    expect(result.success).toBe(false);
  });

  it("rejects duplicate URLs", () => {
    const result = createScheduleSchema.safeParse({
      name: "Place",
      category: "sightseeing",
      urls: ["https://example.com", "https://example.com"],
    });
    expect(result.success).toBe(false);
  });

  it("defaults urls to empty array when omitted", () => {
    const result = createScheduleSchema.safeParse({
      name: "Place",
      category: "sightseeing",
    });
    expect(result.success).toBe(true);
    expect(result.data?.urls).toEqual([]);
  });

  it("accepts explicit empty array for urls", () => {
    const result = createScheduleSchema.safeParse({
      name: "Place",
      category: "sightseeing",
      urls: [],
    });
    expect(result.success).toBe(true);
    expect(result.data?.urls).toEqual([]);
  });

  it.each([
    "javascript:alert(1)",
    "javascript:void(0)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox",
  ])("rejects dangerous URL '%s'", (url) => {
    const result = createScheduleSchema.safeParse({
      name: "Place",
      category: "sightseeing",
      urls: [url],
    });
    expect(result.success).toBe(false);
  });
});

describe("updateScheduleSchema", () => {
  it("accepts partial update with name only", () => {
    const result = updateScheduleSchema.safeParse({ name: "New Name" });
    expect(result.success).toBe(true);
  });

  it("accepts empty object", () => {
    const result = updateScheduleSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("rejects invalid category", () => {
    const result = updateScheduleSchema.safeParse({ category: "invalid" });
    expect(result.success).toBe(false);
  });
});

describe("transportMethodSchema", () => {
  it.each(["train", "shinkansen", "bus", "taxi", "walk", "car", "airplane", "bicycle"])(
    "accepts '%s'",
    (method) => {
      expect(transportMethodSchema.safeParse(method).success).toBe(true);
    },
  );

  it("rejects invalid method", () => {
    expect(transportMethodSchema.safeParse("helicopter").success).toBe(false);
  });
});

describe("createScheduleSchema transport fields", () => {
  it("accepts transport-specific fields", () => {
    const result = createScheduleSchema.safeParse({
      name: "Tokyo to Osaka",
      category: "transport",
      departurePlace: "Tokyo Station",
      arrivalPlace: "Shin-Osaka Station",
      transportMethod: "train",
    });
    expect(result.success).toBe(true);
  });

  it("accepts without transport-specific fields", () => {
    const result = createScheduleSchema.safeParse({
      name: "Tokyo to Osaka",
      category: "transport",
    });
    expect(result.success).toBe(true);
  });

  it("accepts bicycle transportMethod", () => {
    const result = createScheduleSchema.safeParse({
      name: "Riverside ride",
      category: "transport",
      transportMethod: "bicycle",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a non-negative integer cost", () => {
    const result = createScheduleSchema.safeParse({
      name: "Tokyo to Osaka",
      category: "transport",
      transportMethod: "train",
      cost: 580,
    });
    expect(result.success).toBe(true);
    expect(result.data?.cost).toBe(580);
  });

  it("accepts zero cost", () => {
    const result = createScheduleSchema.safeParse({
      name: "Walk",
      category: "transport",
      cost: 0,
    });
    expect(result.success).toBe(true);
  });

  it("accepts null cost", () => {
    const result = createScheduleSchema.safeParse({
      name: "Walk",
      category: "transport",
      cost: null,
    });
    expect(result.success).toBe(true);
  });

  it("rejects negative cost", () => {
    const result = createScheduleSchema.safeParse({
      name: "Tokyo to Osaka",
      category: "transport",
      cost: -1,
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-integer cost", () => {
    const result = createScheduleSchema.safeParse({
      name: "Tokyo to Osaka",
      category: "transport",
      cost: 12.5,
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid transportMethod", () => {
    const result = createScheduleSchema.safeParse({
      name: "Tokyo to Osaka",
      category: "transport",
      transportMethod: "helicopter",
    });
    expect(result.success).toBe(false);
  });
});

describe("createScheduleSchema endDayOffset", () => {
  it("accepts endDayOffset of 1", () => {
    const result = createScheduleSchema.safeParse({
      name: "Hotel",
      category: "hotel",
      endDayOffset: 1,
    });
    expect(result.success).toBe(true);
  });

  it("accepts endDayOffset of 30", () => {
    const result = createScheduleSchema.safeParse({
      name: "Hotel",
      category: "hotel",
      endDayOffset: 30,
    });
    expect(result.success).toBe(true);
  });

  it("rejects endDayOffset of 0", () => {
    const result = createScheduleSchema.safeParse({
      name: "Hotel",
      category: "hotel",
      endDayOffset: 0,
    });
    expect(result.success).toBe(false);
  });

  it("rejects endDayOffset greater than 30", () => {
    const result = createScheduleSchema.safeParse({
      name: "Hotel",
      category: "hotel",
      endDayOffset: 31,
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-integer endDayOffset", () => {
    const result = createScheduleSchema.safeParse({
      name: "Hotel",
      category: "hotel",
      endDayOffset: 1.5,
    });
    expect(result.success).toBe(false);
  });

  it("accepts schedule without endDayOffset", () => {
    const result = createScheduleSchema.safeParse({
      name: "Hotel",
      category: "hotel",
    });
    expect(result.success).toBe(true);
  });

  it("accepts null endDayOffset", () => {
    const result = createScheduleSchema.safeParse({
      name: "Hotel",
      category: "hotel",
      endDayOffset: null,
    });
    expect(result.success).toBe(true);
  });
});

describe("reorderSchedulesSchema", () => {
  it("accepts valid UUIDs", () => {
    const result = reorderSchedulesSchema.safeParse({
      scheduleIds: ["550e8400-e29b-41d4-a716-446655440000"],
    });
    expect(result.success).toBe(true);
  });

  it("rejects non-UUID strings", () => {
    const result = reorderSchedulesSchema.safeParse({
      scheduleIds: ["not-a-uuid"],
    });
    expect(result.success).toBe(false);
  });

  it("accepts empty array", () => {
    const result = reorderSchedulesSchema.safeParse({ scheduleIds: [] });
    expect(result.success).toBe(true);
  });

  it("rejects empty scheduleIds with clearAnchors=true", () => {
    const result = reorderSchedulesSchema.safeParse({
      scheduleIds: [],
      clearAnchors: true,
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty scheduleIds with non-empty anchors", () => {
    const result = reorderSchedulesSchema.safeParse({
      scheduleIds: [],
      anchors: [
        {
          scheduleId: "550e8400-e29b-41d4-a716-446655440000",
          anchor: "after",
          anchorSourceId: "550e8400-e29b-41d4-a716-446655440001",
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("accepts empty scheduleIds with clearAnchors=false (explicit falsy)", () => {
    const result = reorderSchedulesSchema.safeParse({
      scheduleIds: [],
      clearAnchors: false,
    });
    expect(result.success).toBe(true);
  });

  it("accepts empty scheduleIds with empty anchors array", () => {
    const result = reorderSchedulesSchema.safeParse({
      scheduleIds: [],
      anchors: [],
    });
    expect(result.success).toBe(true);
  });

  it("accepts non-empty scheduleIds with clearAnchors=true", () => {
    const result = reorderSchedulesSchema.safeParse({
      scheduleIds: ["550e8400-e29b-41d4-a716-446655440000"],
      clearAnchors: true,
    });
    expect(result.success).toBe(true);
  });
});

describe("createCandidateSchema", () => {
  it("accepts name and category only", () => {
    const result = createCandidateSchema.safeParse({
      name: "Cafe",
      category: "restaurant",
    });
    expect(result.success).toBe(true);
  });

  it("accepts urls", () => {
    const result = createCandidateSchema.safeParse({
      name: "Cafe",
      category: "restaurant",
      urls: ["https://example.com"],
    });
    expect(result.success).toBe(true);
    expect(result.data?.urls).toEqual(["https://example.com"]);
  });

  it("accepts memo and urls together", () => {
    const result = createCandidateSchema.safeParse({
      name: "Cafe",
      category: "restaurant",
      memo: "Good reviews",
      urls: ["https://example.com"],
    });
    expect(result.success).toBe(true);
    expect(result.data?.memo).toBe("Good reviews");
    expect(result.data?.urls).toEqual(["https://example.com"]);
  });

  it("accepts all schedule fields", () => {
    const result = createCandidateSchema.safeParse({
      name: "Tokyo to Osaka",
      category: "transport",
      address: "Tokyo Station",
      startTime: "08:00",
      endTime: "10:30",
      memo: "Nozomi express",
      urls: ["https://example.com"],
      departurePlace: "Tokyo Station",
      arrivalPlace: "Shin-Osaka Station",
      transportMethod: "shinkansen",
      color: "red",
      endDayOffset: 1,
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid time format", () => {
    const result = createCandidateSchema.safeParse({
      name: "Spot",
      category: "sightseeing",
      startTime: "9:00",
    });
    expect(result.success).toBe(false);
  });
});
