import type { ExpenseItem } from "@sugara/shared";

export const EXPENSE_SORT_KEYS = ["newest", "oldest", "amountHigh", "amountLow"] as const;
export type ExpenseSortKey = (typeof EXPENSE_SORT_KEYS)[number];

/**
 * Sort expenses for display. Amount sorts use baseAmount (trip currency) when
 * present so foreign-currency expenses order correctly against same-currency ones.
 * Returns a new array; the input is not mutated.
 */
export function sortExpenses(expenses: ExpenseItem[], key: ExpenseSortKey): ExpenseItem[] {
  const amountOf = (e: ExpenseItem) => e.baseAmount ?? e.amount;
  const arr = [...expenses];
  switch (key) {
    case "oldest":
      return arr.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    case "amountHigh":
      return arr.sort((a, b) => amountOf(b) - amountOf(a));
    case "amountLow":
      return arr.sort((a, b) => amountOf(a) - amountOf(b));
    default:
      return arr.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}
