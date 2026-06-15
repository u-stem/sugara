import { describe, expect, it } from "vitest";
import { z } from "zod";
import { INPUT_SHAPES } from "../tools.js";

describe("INPUT_SHAPES", () => {
  it("defines 29 tools", () => {
    // Arrange + Act
    const toolNames = Object.keys(INPUT_SHAPES);

    // Assert
    expect(toolNames).toHaveLength(29);
  });

  it("includes the candidate and souvenir tools including batch variants", () => {
    const toolNames = Object.keys(INPUT_SHAPES);

    expect(toolNames).toEqual(
      expect.arrayContaining([
        "list_candidates",
        "create_candidate",
        "update_candidate",
        "batch_create_candidates",
        "list_souvenirs",
        "create_souvenir",
        "update_souvenir",
        "batch_create_souvenirs",
        "delete_candidate",
        "delete_souvenir",
      ]),
    );
  });
});

describe("create_candidate input schema", () => {
  const schema = z.object(INPUT_SHAPES.create_candidate);

  it("requires tripId, name, and category", () => {
    expect(schema.safeParse({ tripId: crypto.randomUUID(), name: "Tower" }).success).toBe(false);
    expect(
      schema.safeParse({ tripId: crypto.randomUUID(), name: "Tower", category: "sightseeing" })
        .success,
    ).toBe(true);
  });

  it("rejects an invalid category", () => {
    const result = schema.safeParse({
      tripId: crypto.randomUUID(),
      name: "Tower",
      category: "nope",
    });
    expect(result.success).toBe(false);
  });
});

describe("create_souvenir input schema", () => {
  const schema = z.object(INPUT_SHAPES.create_souvenir);

  it("requires tripId and name", () => {
    expect(schema.safeParse({ tripId: crypto.randomUUID() }).success).toBe(false);
    expect(schema.safeParse({ tripId: crypto.randomUUID(), name: "KitKat" }).success).toBe(true);
  });

  it("rejects an invalid shareStyle", () => {
    const result = schema.safeParse({
      tripId: crypto.randomUUID(),
      name: "KitKat",
      shareStyle: "gift",
    });
    expect(result.success).toBe(false);
  });
});

describe("update_souvenir input schema", () => {
  const schema = z.object(INPUT_SHAPES.update_souvenir);

  it("accepts isPurchased toggle", () => {
    const result = schema.safeParse({
      tripId: crypto.randomUUID(),
      itemId: crypto.randomUUID(),
      isPurchased: true,
    });
    expect(result.success).toBe(true);
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

  it("accepts decimal split amount for non-JPY currency", () => {
    // Splits use major units (e.g. 6.25 = $6.25), so decimals must be allowed.
    const result = schema.safeParse({
      ...validBase,
      currency: "USD",
      splitType: "custom" as const,
      splits: [
        { memberNo: 1, amount: 6.25 },
        { memberNo: 2, amount: 6.25 },
      ],
    });

    expect(result.success).toBe(true);
  });

  it("accepts decimal line item amount for non-JPY currency", () => {
    // Line items also use major units.
    const result = schema.safeParse({
      ...validBase,
      currency: "USD",
      splitType: "itemized" as const,
      splits: [{ memberNo: 1, amount: 12.5 }],
      lineItems: [{ name: "Pasta", amount: 12.5, memberNos: [1] }],
    });

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

// ---------------------------------------------------------------------------
// q (name/title search) parameter in list schemas
// ---------------------------------------------------------------------------

describe("list_candidates q parameter", () => {
  const schema = z.object(INPUT_SHAPES.list_candidates);

  it("preserves q in parsed output so the tool handler can forward it", () => {
    // Zod strips unknown keys by default, so q must be declared in the schema
    // for it to survive parsing. This test would fail without q in INPUT_SHAPES.
    const result = schema.safeParse({ tripId: crypto.randomUUID(), q: "Tokyo" });

    expect(result.success).toBe(true);
    expect(result.data?.q).toBe("Tokyo");
  });

  it("preserves q as undefined when absent", () => {
    const result = schema.safeParse({ tripId: crypto.randomUUID() });

    expect(result.success).toBe(true);
    expect(result.data?.q).toBeUndefined();
  });
});

describe("list_souvenirs q parameter", () => {
  const schema = z.object(INPUT_SHAPES.list_souvenirs);

  it("preserves q in parsed output", () => {
    const result = schema.safeParse({ tripId: crypto.randomUUID(), q: "Matcha" });

    expect(result.success).toBe(true);
    expect(result.data?.q).toBe("Matcha");
  });
});

describe("list_articles q parameter", () => {
  const schema = z.object(INPUT_SHAPES.list_articles);

  it("preserves q in parsed output", () => {
    const result = schema.safeParse({ q: "Kyoto" });

    expect(result.success).toBe(true);
    expect(result.data?.q).toBe("Kyoto");
  });
});

describe("list_bookmarks q parameter", () => {
  const schema = z.object(INPUT_SHAPES.list_bookmarks);

  it("preserves q in parsed output alongside listId", () => {
    const result = schema.safeParse({ listId: crypto.randomUUID(), q: "Senso" });

    expect(result.success).toBe(true);
    expect(result.data?.q).toBe("Senso");
  });
});

// ---------------------------------------------------------------------------
// Batch create schemas
// ---------------------------------------------------------------------------

describe("batch_create_candidates input schema", () => {
  const schema = z.object(INPUT_SHAPES.batch_create_candidates);
  const validItem = { name: "Tokyo Tower", category: "sightseeing" as const };

  it("requires tripId and at least one item", () => {
    expect(schema.safeParse({ tripId: crypto.randomUUID(), items: [] }).success).toBe(false);
    expect(schema.safeParse({ tripId: crypto.randomUUID(), items: [validItem] }).success).toBe(
      true,
    );
  });

  it("rejects more than 50 items", () => {
    const items = Array.from({ length: 51 }, () => validItem);
    const result = schema.safeParse({ tripId: crypto.randomUUID(), items });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid category in items", () => {
    const result = schema.safeParse({
      tripId: crypto.randomUUID(),
      items: [{ name: "Tower", category: "nope" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid onConflict value", () => {
    const result = schema.safeParse({
      tripId: crypto.randomUUID(),
      items: [validItem],
      onConflict: "upsert",
    });
    expect(result.success).toBe(false);
  });

  it("accepts onConflict skip", () => {
    const result = schema.safeParse({
      tripId: crypto.randomUUID(),
      items: [validItem],
      onConflict: "skip",
    });
    expect(result.success).toBe(true);
  });

  it("accepts onConflict create", () => {
    const result = schema.safeParse({
      tripId: crypto.randomUUID(),
      items: [validItem],
      onConflict: "create",
    });
    expect(result.success).toBe(true);
  });
});

describe("delete_candidate input schema", () => {
  const schema = z.object(INPUT_SHAPES.delete_candidate);

  it("requires tripId and scheduleId", () => {
    expect(schema.safeParse({ tripId: crypto.randomUUID() }).success).toBe(false);
    expect(
      schema.safeParse({ tripId: crypto.randomUUID(), scheduleId: crypto.randomUUID() }).success,
    ).toBe(true);
  });

  it("rejects non-UUID scheduleId", () => {
    const result = schema.safeParse({ tripId: crypto.randomUUID(), scheduleId: "not-uuid" });
    expect(result.success).toBe(false);
  });
});

describe("delete_souvenir input schema", () => {
  const schema = z.object(INPUT_SHAPES.delete_souvenir);

  it("requires tripId and itemId", () => {
    expect(schema.safeParse({ tripId: crypto.randomUUID() }).success).toBe(false);
    expect(
      schema.safeParse({ tripId: crypto.randomUUID(), itemId: crypto.randomUUID() }).success,
    ).toBe(true);
  });

  it("rejects non-UUID itemId", () => {
    const result = schema.safeParse({ tripId: crypto.randomUUID(), itemId: "not-uuid" });
    expect(result.success).toBe(false);
  });
});

describe("batch_create_souvenirs input schema", () => {
  const schema = z.object(INPUT_SHAPES.batch_create_souvenirs);
  const validItem = { name: "Matcha KitKat" };

  it("requires tripId and at least one item", () => {
    expect(schema.safeParse({ tripId: crypto.randomUUID(), items: [] }).success).toBe(false);
    expect(schema.safeParse({ tripId: crypto.randomUUID(), items: [validItem] }).success).toBe(
      true,
    );
  });

  it("rejects more than 50 items", () => {
    const items = Array.from({ length: 51 }, () => validItem);
    const result = schema.safeParse({ tripId: crypto.randomUUID(), items });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid shareStyle in items", () => {
    const result = schema.safeParse({
      tripId: crypto.randomUUID(),
      items: [{ name: "KitKat", shareStyle: "gift" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid priority in items", () => {
    const result = schema.safeParse({
      tripId: crypto.randomUUID(),
      items: [{ name: "KitKat", priority: "low" }],
    });
    expect(result.success).toBe(false);
  });

  it("accepts onConflict skip", () => {
    const result = schema.safeParse({
      tripId: crypto.randomUUID(),
      items: [validItem],
      onConflict: "skip",
    });
    expect(result.success).toBe(true);
  });
});
