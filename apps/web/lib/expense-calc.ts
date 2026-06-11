import type { CurrencyCode } from "@sugara/shared";
import { fromMinorUnits, toMinorUnits } from "@sugara/shared";

/**
 * Compare two major-unit amounts for equality in minor-unit space.
 * Direct === on major units is unreliable: IEEE 754 float addition (e.g.
 * 0.1 + 0.1 + 0.1) does not produce exactly 0.3, so splitting $0.10 three
 * ways would always show a false mismatch. Converting to minor units first
 * rounds to integers, eliminating the rounding error.
 */
export function minorUnitsEqual(a: number, b: number, currency: CurrencyCode): boolean {
  return toMinorUnits(a, currency) === toMinorUnits(b, currency);
}

export type ExpenseLineItem = {
  id: string;
  name: string;
  amount: number;
  memberIds: Set<string>;
};

/**
 * Convert line items into per-member split amounts.
 * Each item's amount (major units) is converted to minor units for integer
 * arithmetic, distributed equally with remainder assigned to first members,
 * then converted back to major units. This avoids floating-point errors when
 * items have fractional major-unit amounts (e.g. USD $5.99).
 * Returns major-unit amounts to match the API submission contract.
 */
export function calculateItemizedSplits(
  items: ExpenseLineItem[],
  currency: CurrencyCode,
): { userId: string; amount: number }[] {
  const memberTotals = new Map<string, number>();

  for (const item of items) {
    const members = Array.from(item.memberIds);
    if (members.length === 0 || item.amount <= 0) continue;

    // Work in minor units so remainder distribution stays integer
    const minorTotal = toMinorUnits(item.amount, currency);
    const base = Math.floor(minorTotal / members.length);
    const remainder = minorTotal - base * members.length;

    for (let i = 0; i < members.length; i++) {
      const share = i < remainder ? base + 1 : base;
      memberTotals.set(members[i], (memberTotals.get(members[i]) ?? 0) + share);
    }
  }

  return Array.from(memberTotals.entries())
    .map(([userId, minorAmount]) => ({ userId, amount: fromMinorUnits(minorAmount, currency) }))
    .sort((a, b) => a.userId.localeCompare(b.userId));
}
