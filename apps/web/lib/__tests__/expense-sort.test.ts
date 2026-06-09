import type { ExpenseItem } from "@sugara/shared";
import { describe, expect, it } from "vitest";
import { sortExpenses } from "../expense-sort";

function makeExpense(o: {
  id: string;
  amount: number;
  baseAmount?: number | null;
  createdAt: string;
}): ExpenseItem {
  return {
    id: o.id,
    title: o.id,
    amount: o.amount,
    currency: "JPY",
    exchangeRate: null,
    baseAmount: o.baseAmount ?? null,
    splitType: "equal",
    category: null,
    paidByUserId: "u1",
    paidByUser: { id: "u1", name: "U" },
    splits: [],
    lineItems: [],
    createdAt: o.createdAt,
  };
}

const a = makeExpense({ id: "a", amount: 100, createdAt: "2026-01-01T00:00:00Z" });
const b = makeExpense({ id: "b", amount: 300, createdAt: "2026-01-03T00:00:00Z" });
// Foreign-currency expense: amount is in the original currency, baseAmount in trip currency.
const c = makeExpense({
  id: "c",
  amount: 200,
  baseAmount: 5000,
  createdAt: "2026-01-02T00:00:00Z",
});

describe("sortExpenses", () => {
  it("newest: createdAt descending", () => {
    expect(sortExpenses([a, b, c], "newest").map((e) => e.id)).toEqual(["b", "c", "a"]);
  });

  it("oldest: createdAt ascending", () => {
    expect(sortExpenses([a, b, c], "oldest").map((e) => e.id)).toEqual(["a", "c", "b"]);
  });

  it("amountHigh: uses baseAmount (trip currency) when present", () => {
    // a=100, b=300, c=5000 (baseAmount) -> c, b, a
    expect(sortExpenses([a, b, c], "amountHigh").map((e) => e.id)).toEqual(["c", "b", "a"]);
  });

  it("amountLow: ascending by trip-currency amount", () => {
    expect(sortExpenses([a, b, c], "amountLow").map((e) => e.id)).toEqual(["a", "b", "c"]);
  });

  it("does not mutate the input array", () => {
    const arr = [a, b, c];
    sortExpenses(arr, "amountHigh");
    expect(arr.map((e) => e.id)).toEqual(["a", "b", "c"]);
  });
});
