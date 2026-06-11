import { describe, expect, it } from "vitest";
import { z } from "zod";
import { INPUT_SHAPES } from "../tools.js";

describe("INPUT_SHAPES", () => {
  it("defines 7 tools", () => {
    // Arrange + Act
    const toolNames = Object.keys(INPUT_SHAPES);

    // Assert
    expect(toolNames).toHaveLength(7);
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
