import { describe, expect, it } from "vitest";
import { z } from "zod";
import { INPUT_SHAPES } from "../tools.js";

describe("INPUT_SHAPES", () => {
  it("defines 19 tools", () => {
    // Arrange + Act
    const toolNames = Object.keys(INPUT_SHAPES);

    // Assert
    expect(toolNames).toHaveLength(19);
  });
});

describe("list_trips input schema", () => {
  const schema = z.object(INPUT_SHAPES.list_trips);

  it("rejects limit greater than 100", () => {
    // Arrange + Act
    const result = schema.safeParse({ limit: 101 });

    // Assert
    expect(result.success).toBe(false);
  });

  it("rejects limit less than 1", () => {
    // Arrange + Act
    const result = schema.safeParse({ limit: 0 });

    // Assert
    expect(result.success).toBe(false);
  });

  it("rejects invalid scope value", () => {
    // Arrange + Act
    const result = schema.safeParse({ scope: "all" });

    // Assert
    expect(result.success).toBe(false);
  });

  it("accepts valid scope owned", () => {
    // Arrange + Act
    const result = schema.safeParse({ scope: "owned" });

    // Assert
    expect(result.success).toBe(true);
  });
});

describe("get_trip input schema", () => {
  const schema = z.object(INPUT_SHAPES.get_trip);

  it("rejects non-UUID id", () => {
    // Arrange + Act
    const result = schema.safeParse({ id: "not-a-uuid" });

    // Assert
    expect(result.success).toBe(false);
  });

  it("accepts valid UUID", () => {
    // Arrange + Act
    const result = schema.safeParse({ id: "550e8400-e29b-41d4-a716-446655440000" });

    // Assert
    expect(result.success).toBe(true);
  });
});

describe("list_trip_expenses input schema", () => {
  const schema = z.object(INPUT_SHAPES.list_trip_expenses);

  it("rejects non-UUID tripId", () => {
    // Arrange + Act
    const result = schema.safeParse({ tripId: "not-a-uuid" });

    // Assert
    expect(result.success).toBe(false);
  });

  it("rejects limit greater than 100", () => {
    // Arrange + Act
    const result = schema.safeParse({ tripId: "550e8400-e29b-41d4-a716-446655440000", limit: 101 });

    // Assert
    expect(result.success).toBe(false);
  });
});

describe("list_bookmarks input schema", () => {
  const schema = z.object(INPUT_SHAPES.list_bookmarks);

  it("rejects non-UUID listId", () => {
    // Arrange + Act
    const result = schema.safeParse({ listId: "not-a-uuid" });

    // Assert
    expect(result.success).toBe(false);
  });
});

describe("get_article input schema", () => {
  const schema = z.object(INPUT_SHAPES.get_article);

  it("rejects non-UUID id", () => {
    // Arrange + Act
    const result = schema.safeParse({ id: "not-a-uuid" });

    // Assert
    expect(result.success).toBe(false);
  });

  it("rejects negative offset for list_articles", () => {
    // Arrange
    const listSchema = z.object(INPUT_SHAPES.list_articles);

    // Act
    const result = listSchema.safeParse({ offset: -1 });

    // Assert
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Write tool input schemas
// ---------------------------------------------------------------------------

describe("create_trip input schema", () => {
  const schema = z.object(INPUT_SHAPES.create_trip);

  it("rejects missing title", () => {
    // Arrange + Act
    const result = schema.safeParse({ startDate: "2025-01-01", endDate: "2025-01-03" });

    // Assert
    expect(result.success).toBe(false);
  });

  it("rejects title longer than 100 characters", () => {
    // Arrange + Act
    const result = schema.safeParse({
      title: "a".repeat(101),
      startDate: "2025-01-01",
      endDate: "2025-01-03",
    });

    // Assert
    expect(result.success).toBe(false);
  });

  it("rejects non-date startDate", () => {
    // Arrange + Act
    const result = schema.safeParse({
      title: "Trip",
      startDate: "not-a-date",
      endDate: "2025-01-03",
    });

    // Assert
    expect(result.success).toBe(false);
  });

  it("rejects invalid currency code", () => {
    // Arrange + Act
    const result = schema.safeParse({
      title: "Trip",
      startDate: "2025-01-01",
      endDate: "2025-01-03",
      currency: "XYZ",
    });

    // Assert
    expect(result.success).toBe(false);
  });

  it("accepts valid minimal input", () => {
    // Arrange + Act
    const result = schema.safeParse({
      title: "Test Trip",
      startDate: "2025-01-01",
      endDate: "2025-01-05",
    });

    // Assert
    expect(result.success).toBe(true);
  });
});

describe("update_trip input schema", () => {
  const schema = z.object(INPUT_SHAPES.update_trip);

  it("rejects non-UUID id", () => {
    // Arrange + Act
    const result = schema.safeParse({ id: "bad-id" });

    // Assert
    expect(result.success).toBe(false);
  });

  it("rejects invalid status value", () => {
    // Arrange + Act
    const result = schema.safeParse({
      id: "550e8400-e29b-41d4-a716-446655440000",
      status: "unknown",
    });

    // Assert
    expect(result.success).toBe(false);
  });

  it("accepts valid uuid with no other fields", () => {
    // Arrange + Act
    const result = schema.safeParse({ id: "550e8400-e29b-41d4-a716-446655440000" });

    // Assert
    expect(result.success).toBe(true);
  });
});

describe("create_schedule input schema", () => {
  const schema = z.object(INPUT_SHAPES.create_schedule);
  const validBase = {
    tripId: "550e8400-e29b-41d4-a716-446655440000",
    dayNumber: 1,
    name: "Lunch at Ramen shop",
    category: "restaurant" as const,
  };

  it("rejects dayNumber less than 1", () => {
    // Arrange + Act
    const result = schema.safeParse({ ...validBase, dayNumber: 0 });

    // Assert
    expect(result.success).toBe(false);
  });

  it("rejects invalid category", () => {
    // Arrange + Act
    const result = schema.safeParse({ ...validBase, category: "unknown" });

    // Assert
    expect(result.success).toBe(false);
  });

  it("rejects cost exceeding maximum", () => {
    // Arrange + Act
    const result = schema.safeParse({ ...validBase, cost: 100000000 });

    // Assert
    expect(result.success).toBe(false);
  });

  it("rejects urls array longer than 5", () => {
    // Arrange + Act
    const result = schema.safeParse({
      ...validBase,
      urls: ["u1", "u2", "u3", "u4", "u5", "u6"],
    });

    // Assert
    expect(result.success).toBe(false);
  });

  it("accepts valid minimal input", () => {
    // Arrange + Act
    const result = schema.safeParse(validBase);

    // Assert
    expect(result.success).toBe(true);
  });
});

describe("update_schedule input schema", () => {
  const schema = z.object(INPUT_SHAPES.update_schedule);

  it("rejects non-UUID scheduleId", () => {
    // Arrange + Act
    const result = schema.safeParse({
      tripId: "550e8400-e29b-41d4-a716-446655440000",
      scheduleId: "not-uuid",
    });

    // Assert
    expect(result.success).toBe(false);
  });

  it("accepts valid input with no update fields", () => {
    // Arrange + Act
    const result = schema.safeParse({
      tripId: "550e8400-e29b-41d4-a716-446655440000",
      scheduleId: "550e8400-e29b-41d4-a716-446655440001",
    });

    // Assert
    expect(result.success).toBe(true);
  });
});

describe("create_expense input schema", () => {
  const schema = z.object(INPUT_SHAPES.create_expense);
  const validBase = {
    tripId: "550e8400-e29b-41d4-a716-446655440000",
    title: "Dinner",
    amount: 3000,
    paidByMemberNo: 1,
    splitType: "equal" as const,
    splits: [{ memberNo: 1 }, { memberNo: 2 }],
  };

  it("rejects zero amount", () => {
    // Arrange + Act
    const result = schema.safeParse({ ...validBase, amount: 0 });

    // Assert
    expect(result.success).toBe(false);
  });

  it("rejects paidByMemberNo of 0", () => {
    // Arrange + Act
    const result = schema.safeParse({ ...validBase, paidByMemberNo: 0 });

    // Assert
    expect(result.success).toBe(false);
  });

  it("rejects invalid splitType", () => {
    // Arrange + Act
    const result = schema.safeParse({ ...validBase, splitType: "random" });

    // Assert
    expect(result.success).toBe(false);
  });

  it("rejects empty splits array", () => {
    // Arrange + Act
    const result = schema.safeParse({ ...validBase, splits: [] });

    // Assert
    expect(result.success).toBe(false);
  });

  it("rejects lineItems array longer than 50", () => {
    // Arrange
    const lineItems = Array.from({ length: 51 }, (_, i) => ({
      name: `Item ${i}`,
      amount: 100,
      memberNos: [1],
    }));

    // Act
    const result = schema.safeParse({ ...validBase, lineItems });

    // Assert
    expect(result.success).toBe(false);
  });

  it("accepts valid equal-split expense", () => {
    // Arrange + Act
    const result = schema.safeParse(validBase);

    // Assert
    expect(result.success).toBe(true);
  });
});

describe("update_expense input schema", () => {
  const schema = z.object(INPUT_SHAPES.update_expense);

  it("rejects non-UUID expenseId", () => {
    // Arrange + Act
    const result = schema.safeParse({
      tripId: "550e8400-e29b-41d4-a716-446655440000",
      expenseId: "bad",
    });

    // Assert
    expect(result.success).toBe(false);
  });

  it("accepts minimal input with only IDs", () => {
    // Arrange + Act
    const result = schema.safeParse({
      tripId: "550e8400-e29b-41d4-a716-446655440000",
      expenseId: "550e8400-e29b-41d4-a716-446655440001",
    });

    // Assert
    expect(result.success).toBe(true);
  });
});

describe("create_bookmark_list input schema", () => {
  const schema = z.object(INPUT_SHAPES.create_bookmark_list);

  it("rejects empty name", () => {
    // Arrange + Act
    const result = schema.safeParse({ name: "" });

    // Assert
    expect(result.success).toBe(false);
  });

  it("rejects name longer than 50 characters", () => {
    // Arrange + Act
    const result = schema.safeParse({ name: "a".repeat(51) });

    // Assert
    expect(result.success).toBe(false);
  });

  it("rejects invalid visibility", () => {
    // Arrange + Act
    const result = schema.safeParse({ name: "My list", visibility: "secret" });

    // Assert
    expect(result.success).toBe(false);
  });

  it("accepts valid name", () => {
    // Arrange + Act
    const result = schema.safeParse({ name: "Japan 2025" });

    // Assert
    expect(result.success).toBe(true);
  });
});

describe("update_bookmark_list input schema", () => {
  const schema = z.object(INPUT_SHAPES.update_bookmark_list);

  it("rejects non-UUID listId", () => {
    // Arrange + Act
    const result = schema.safeParse({ listId: "not-uuid" });

    // Assert
    expect(result.success).toBe(false);
  });

  it("accepts valid listId with no update fields", () => {
    // Arrange + Act
    const result = schema.safeParse({ listId: "550e8400-e29b-41d4-a716-446655440000" });

    // Assert
    expect(result.success).toBe(true);
  });
});

describe("create_bookmark input schema", () => {
  const schema = z.object(INPUT_SHAPES.create_bookmark);

  it("rejects empty name", () => {
    // Arrange + Act
    const result = schema.safeParse({ listId: "550e8400-e29b-41d4-a716-446655440000", name: "" });

    // Assert
    expect(result.success).toBe(false);
  });

  it("rejects urls array longer than 5", () => {
    // Arrange + Act
    const result = schema.safeParse({
      listId: "550e8400-e29b-41d4-a716-446655440000",
      name: "Tokyo Tower",
      urls: ["u1", "u2", "u3", "u4", "u5", "u6"],
    });

    // Assert
    expect(result.success).toBe(false);
  });

  it("accepts valid minimal input", () => {
    // Arrange + Act
    const result = schema.safeParse({
      listId: "550e8400-e29b-41d4-a716-446655440000",
      name: "Tokyo Tower",
    });

    // Assert
    expect(result.success).toBe(true);
  });
});

describe("update_bookmark input schema", () => {
  const schema = z.object(INPUT_SHAPES.update_bookmark);

  it("rejects non-UUID bookmarkId", () => {
    // Arrange + Act
    const result = schema.safeParse({
      listId: "550e8400-e29b-41d4-a716-446655440000",
      bookmarkId: "not-uuid",
    });

    // Assert
    expect(result.success).toBe(false);
  });
});

describe("create_article input schema", () => {
  const schema = z.object(INPUT_SHAPES.create_article);

  it("rejects title longer than 100 characters", () => {
    // Arrange + Act
    const result = schema.safeParse({ title: "a".repeat(101) });

    // Assert
    expect(result.success).toBe(false);
  });

  it("rejects tags array longer than 5", () => {
    // Arrange + Act
    const result = schema.safeParse({ title: "My Article", tags: ["a", "b", "c", "d", "e", "f"] });

    // Assert
    expect(result.success).toBe(false);
  });

  it("rejects a tag longer than 20 characters", () => {
    // Arrange + Act
    const result = schema.safeParse({ title: "My Article", tags: ["a".repeat(21)] });

    // Assert
    expect(result.success).toBe(false);
  });

  it("rejects invalid visibility", () => {
    // Arrange + Act
    const result = schema.safeParse({ title: "My Article", visibility: "secret" });

    // Assert
    expect(result.success).toBe(false);
  });

  it("accepts valid minimal input", () => {
    // Arrange + Act
    const result = schema.safeParse({ title: "My Travel Story" });

    // Assert
    expect(result.success).toBe(true);
  });
});

describe("update_article input schema", () => {
  const schema = z.object(INPUT_SHAPES.update_article);

  it("rejects non-UUID id", () => {
    // Arrange + Act
    const result = schema.safeParse({ id: "bad-id" });

    // Assert
    expect(result.success).toBe(false);
  });

  it("accepts valid uuid with no update fields", () => {
    // Arrange + Act
    const result = schema.safeParse({ id: "550e8400-e29b-41d4-a716-446655440000" });

    // Assert
    expect(result.success).toBe(true);
  });
});
