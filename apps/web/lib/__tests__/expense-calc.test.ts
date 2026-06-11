import { describe, expect, it } from "vitest";
import { calculateItemizedSplits, type ExpenseLineItem } from "../expense-calc";

describe("calculateItemizedSplits", () => {
  const memberA = "00000000-0000-0000-0000-000000000001";
  const memberB = "00000000-0000-0000-0000-000000000002";
  const memberC = "00000000-0000-0000-0000-000000000003";

  it("splits a single item equally among all members", () => {
    const items: ExpenseLineItem[] = [
      { id: "1", name: "料理", amount: 3000, memberIds: new Set([memberA, memberB, memberC]) },
    ];
    const result = calculateItemizedSplits(items, "JPY");
    expect(result).toEqual([
      { userId: memberA, amount: 1000 },
      { userId: memberB, amount: 1000 },
      { userId: memberC, amount: 1000 },
    ]);
  });

  it("handles remainder distribution (1 yen to first members)", () => {
    const items: ExpenseLineItem[] = [
      { id: "1", name: "料理", amount: 1000, memberIds: new Set([memberA, memberB, memberC]) },
    ];
    const result = calculateItemizedSplits(items, "JPY");
    expect(result).toEqual([
      { userId: memberA, amount: 334 },
      { userId: memberB, amount: 333 },
      { userId: memberC, amount: 333 },
    ]);
    expect(result.reduce((s, r) => s + r.amount, 0)).toBe(1000);
  });

  it("splits multiple items with different members", () => {
    const items: ExpenseLineItem[] = [
      { id: "1", name: "料理", amount: 3000, memberIds: new Set([memberA, memberB, memberC]) },
      { id: "2", name: "ビール", amount: 1500, memberIds: new Set([memberA, memberB]) },
      { id: "3", name: "ソフトドリンク", amount: 500, memberIds: new Set([memberC]) },
    ];
    const result = calculateItemizedSplits(items, "JPY");
    const map = new Map(result.map((r) => [r.userId, r.amount]));
    expect(map.get(memberA)).toBe(1750);
    expect(map.get(memberB)).toBe(1750);
    expect(map.get(memberC)).toBe(1500);
    expect(result.reduce((s, r) => s + r.amount, 0)).toBe(5000);
  });

  it("includes split-the-rest item", () => {
    const items: ExpenseLineItem[] = [
      { id: "1", name: "ビール", amount: 1000, memberIds: new Set([memberA]) },
      { id: "rest", name: "その他", amount: 4000, memberIds: new Set([memberA, memberB]) },
    ];
    const result = calculateItemizedSplits(items, "JPY");
    const map = new Map(result.map((r) => [r.userId, r.amount]));
    expect(map.get(memberA)).toBe(3000);
    expect(map.get(memberB)).toBe(2000);
  });

  it("returns empty array for empty items", () => {
    expect(calculateItemizedSplits([], "JPY")).toEqual([]);
  });

  it("splits based on item amounts only", () => {
    const items: ExpenseLineItem[] = [
      { id: "1", name: "料理", amount: 4000, memberIds: new Set([memberA, memberB]) },
    ];
    const result = calculateItemizedSplits(items, "JPY");
    expect(result.reduce((s, r) => s + r.amount, 0)).toBe(4000);
  });

  it("splits a fractional USD amount correctly without floating-point errors", () => {
    // $5.99 split between 2 members: 300 cents / 2 = 150 each → $3.00 + $2.99
    const items: ExpenseLineItem[] = [
      { id: "1", name: "Coffee", amount: 5.99, memberIds: new Set([memberA, memberB]) },
    ];
    const result = calculateItemizedSplits(items, "USD");
    const map = new Map(result.map((r) => [r.userId, r.amount]));
    expect(map.get(memberA)).toBe(3.0);
    expect(map.get(memberB)).toBe(2.99);
    expect(result.reduce((s, r) => s + r.amount, 0)).toBeCloseTo(5.99, 10);
  });
});
