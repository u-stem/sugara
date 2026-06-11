import { describe, expect, it } from "vitest";
import { createExpenseSchema, updateExpenseSchema } from "../schemas/expense";

// USD decimal-amount splits (the bug: .int() rejects 6.25 and major-unit comparison fails)
describe("createExpenseSchema with non-JPY decimal amounts", () => {
  it("accepts USD amount 12.5 with custom splits summing to 12.5", () => {
    // Arrange
    const input = {
      title: "Dinner",
      amount: 12.5,
      paidByUserId: "550e8400-e29b-41d4-a716-446655440000",
      splitType: "custom",
      currency: "USD",
      splits: [
        { userId: "550e8400-e29b-41d4-a716-446655440000", amount: 6.25 },
        { userId: "550e8400-e29b-41d4-a716-446655440001", amount: 6.25 },
      ],
    };

    // Act
    const result = createExpenseSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(true);
  });

  it("rejects USD amount 12.5 when custom splits do not sum to 12.5 in minor units", () => {
    // Arrange — 6.25 + 6.30 = 12.55 ≠ 12.50 (1255 ≠ 1250 minor units)
    const input = {
      title: "Dinner",
      amount: 12.5,
      paidByUserId: "550e8400-e29b-41d4-a716-446655440000",
      splitType: "custom",
      currency: "USD",
      splits: [
        { userId: "550e8400-e29b-41d4-a716-446655440000", amount: 6.25 },
        { userId: "550e8400-e29b-41d4-a716-446655440001", amount: 6.3 },
      ],
    };

    // Act
    const result = createExpenseSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(false);
  });
});

describe("updateExpenseSchema", () => {
  it("rejects splitType without splits", () => {
    const result = updateExpenseSchema.safeParse({ splitType: "custom" });
    expect(result.success).toBe(false);
  });

  it("rejects splits without splitType", () => {
    const result = updateExpenseSchema.safeParse({
      splits: [{ userId: "550e8400-e29b-41d4-a716-446655440000", amount: 500 }],
    });
    expect(result.success).toBe(false);
  });

  it("accepts splitType with splits and amount together", () => {
    const result = updateExpenseSchema.safeParse({
      splitType: "custom",
      amount: 1000,
      splits: [
        { userId: "550e8400-e29b-41d4-a716-446655440000", amount: 600 },
        { userId: "550e8400-e29b-41d4-a716-446655440001", amount: 400 },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("accepts title-only update", () => {
    const result = updateExpenseSchema.safeParse({ title: "Dinner" });
    expect(result.success).toBe(true);
  });

  it("accepts amount-only update", () => {
    const result = updateExpenseSchema.safeParse({ amount: 2000 });
    expect(result.success).toBe(true);
  });

  it("accepts equal split with splits and amount", () => {
    const result = updateExpenseSchema.safeParse({
      splitType: "equal",
      amount: 1000,
      splits: [
        { userId: "550e8400-e29b-41d4-a716-446655440000" },
        { userId: "550e8400-e29b-41d4-a716-446655440001" },
      ],
    });
    expect(result.success).toBe(true);
  });
});
