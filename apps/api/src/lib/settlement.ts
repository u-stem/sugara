import type { ExpenseSplitType, MemberTotal } from "@sugara/shared";
import { logger } from "./logger";

export type ExpenseData = {
  paidByUserId: string;
  amount: number;
  splits: { userId: string; amount: number }[];
};

type UserInfo = { id: string; name: string };

type Settlement = {
  totalAmount: number;
  balances: { userId: string; name: string; net: number }[];
  transfers: { from: UserInfo; to: UserInfo; amount: number }[];
};

export function calculateEqualSplit(totalAmount: number, memberCount: number): number[] {
  if (memberCount === 0) return [];
  const base = Math.floor(totalAmount / memberCount);
  const remainder = totalAmount - base * memberCount;
  return Array.from({ length: memberCount }, (_, i) => (i < remainder ? base + 1 : base));
}

export function calculateSettlement(expenses: ExpenseData[], members: UserInfo[]): Settlement {
  const memberMap = new Map(members.map((m) => [m.id, m]));
  const netMap = new Map(members.map((m) => [m.id, 0]));

  let totalAmount = 0;

  for (const expense of expenses) {
    totalAmount += expense.amount;
    netMap.set(expense.paidByUserId, (netMap.get(expense.paidByUserId) ?? 0) + expense.amount);
    for (const split of expense.splits) {
      netMap.set(split.userId, (netMap.get(split.userId) ?? 0) - split.amount);
    }
  }

  const balances = members.map((m) => ({
    userId: m.id,
    name: m.name,
    net: netMap.get(m.id) ?? 0,
  }));

  // Greedy algorithm: match largest debtor with largest creditor
  const creditors: { user: UserInfo; amount: number }[] = [];
  const debtors: { user: UserInfo; amount: number }[] = [];

  for (const [userId, net] of netMap) {
    const user = memberMap.get(userId);
    if (!user) {
      logger.warn({ userId }, "User found in expenses but not in member list");
      continue;
    }
    if (net > 0) creditors.push({ user, amount: net });
    if (net < 0) debtors.push({ user, amount: -net });
  }

  // Sort descending by amount
  creditors.sort((a, b) => b.amount - a.amount);
  debtors.sort((a, b) => b.amount - a.amount);

  const transfers: Settlement["transfers"] = [];
  let ci = 0;
  let di = 0;

  while (ci < creditors.length && di < debtors.length) {
    const transfer = Math.min(creditors[ci].amount, debtors[di].amount);
    if (transfer > 0) {
      transfers.push({
        from: debtors[di].user,
        to: creditors[ci].user,
        amount: transfer,
      });
    }
    creditors[ci].amount -= transfer;
    debtors[di].amount -= transfer;
    if (creditors[ci].amount === 0) ci++;
    if (debtors[di].amount === 0) di++;
  }

  return { totalAmount, balances, transfers };
}

/**
 * Advance-based transfers: each member repays the person who actually paid for
 * the expense, with reciprocal debts between the same pair netted out. Unlike
 * the minimal settlement, this preserves "who covered for whom", which matches
 * users' intuition at the cost of more transfers.
 */
export function calculateDirectTransfers(
  expenses: ExpenseData[],
  members: UserInfo[],
): { from: UserInfo; to: UserInfo; amount: number }[] {
  const memberMap = new Map(members.map((m) => [m.id, m]));

  // debtMap[debtor][creditor] = amount the debtor owes the creditor
  const debtMap = new Map<string, Map<string, number>>();
  const addDebt = (debtor: string, creditor: string, amount: number) => {
    // set() is a no-op when `inner` is the existing reference, but required
    // for the newly created Map on first access of this debtor.
    const inner = debtMap.get(debtor) ?? new Map<string, number>();
    inner.set(creditor, (inner.get(creditor) ?? 0) + amount);
    debtMap.set(debtor, inner);
  };

  for (const expense of expenses) {
    const payer = expense.paidByUserId;
    if (!memberMap.has(payer)) {
      logger.warn({ userId: payer }, "Payer found in expenses but not in member list");
      continue;
    }
    for (const split of expense.splits) {
      if (split.userId === payer) continue; // payer self-funds their own share
      if (!memberMap.has(split.userId)) {
        logger.warn({ userId: split.userId }, "User found in expenses but not in member list");
        continue;
      }
      addDebt(split.userId, payer, split.amount);
    }
  }

  // Net out reciprocal debts per unordered pair, visiting each pair once.
  const transfers: { from: UserInfo; to: UserInfo; amount: number }[] = [];
  const seen = new Set<string>();
  for (const [a, creditors] of debtMap) {
    for (const b of creditors.keys()) {
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const aToB = debtMap.get(a)?.get(b) ?? 0;
      const bToA = debtMap.get(b)?.get(a) ?? 0;
      const net = aToB - bToA;
      if (net === 0) continue;

      const fromId = net > 0 ? a : b;
      const toId = net > 0 ? b : a;
      const from = memberMap.get(fromId);
      const to = memberMap.get(toId);
      if (!from || !to) continue;
      transfers.push({ from, to, amount: Math.abs(net) });
    }
  }

  return transfers.sort((x, y) => y.amount - x.amount);
}

type BurdenExpenseData = {
  splitType: ExpenseSplitType;
  /** Original-currency amount in minor units. */
  amount: number;
  /** Trip-currency amount in minor units, or null when the expense is already in trip currency. */
  baseAmount: number | null;
  splits: { userId: string; amount: number }[];
};

/**
 * Per-member spending total in trip currency. Splits are stored in mixed
 * currencies: equal splits and same-currency custom/itemized splits are already
 * in trip currency, while foreign-currency custom/itemized splits hold the
 * original currency. The latter are converted via baseAmount so the per-member
 * totals sum to the same trip-currency grand total as the category breakdown.
 */
export function calculateMemberBurdens(
  expenses: BurdenExpenseData[],
  members: UserInfo[],
): MemberTotal[] {
  const memberMap = new Map(members.map((m) => [m.id, m]));
  const totals = new Map<string, number>(members.map((m) => [m.id, 0]));

  for (const expense of expenses) {
    for (const { userId, amount } of resolveBurdens(expense)) {
      if (!memberMap.has(userId)) {
        logger.warn({ userId }, "User found in expense splits but not in member list");
        continue;
      }
      totals.set(userId, (totals.get(userId) ?? 0) + amount);
    }
  }

  return members
    .map((m) => ({ userId: m.id, name: m.name, total: totals.get(m.id) ?? 0 }))
    .filter((m) => m.total > 0)
    .sort((a, b) => b.total - a.total);
}

// Exported so the expenses route can convert splits to trip currency before
// feeding them to calculateSettlement / calculateDirectTransfers, keeping the
// settlement nets consistent with calculateMemberBurdens for foreign splits.
export function resolveBurdens(expense: BurdenExpenseData): { userId: string; amount: number }[] {
  // equal splits are pre-converted to trip currency on save; same-currency
  // custom/itemized splits (baseAmount null) are already in trip currency too.
  if (expense.splitType === "equal" || expense.baseAmount == null) {
    return expense.splits.map((s) => ({ userId: s.userId, amount: s.amount }));
  }
  // Foreign-currency custom/itemized: distribute baseAmount by each split's
  // share of the original amount, assigning rounding remainder to the largest
  // fractional parts so the per-expense total matches baseAmount exactly.
  return distributeByShare(expense.splits, expense.amount, expense.baseAmount);
}

// Precondition: sum(splits[i].amount) === amount (guaranteed at save time, where
// custom/itemized splits must cover the full expense amount). If that invariant
// breaks, the floored sum could exceed baseAmount and remainder would go negative.
function distributeByShare(
  splits: { userId: string; amount: number }[],
  amount: number,
  baseAmount: number,
): { userId: string; amount: number }[] {
  if (amount <= 0) {
    return splits.map((s) => ({ userId: s.userId, amount: 0 }));
  }
  const ideal = splits.map((s) => (s.amount * baseAmount) / amount);
  const floored = ideal.map((v) => Math.floor(v));
  const remainder = baseAmount - floored.reduce((sum, v) => sum + v, 0);
  const byFraction = ideal
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac);
  const result = floored.slice();
  for (let k = 0; k < remainder && k < byFraction.length; k++) {
    result[byFraction[k].i] += 1;
  }
  return splits.map((s, i) => ({ userId: s.userId, amount: result[i] }));
}

/**
 * Normalize stored expenses into trip-currency settlement inputs. Both the paid
 * amount (baseAmount ?? amount) and every split are expressed in trip currency,
 * so callers of calculateSettlement / calculateDirectTransfers stay consistent
 * for foreign custom/itemized splits. Use this everywhere settlement is computed
 * (the expenses list and settlement-payment validation) to avoid drift.
 */
export function toSettlementExpenses(
  expenses: (BurdenExpenseData & { paidByUserId: string })[],
): ExpenseData[] {
  return expenses.map((e) => ({
    paidByUserId: e.paidByUserId,
    amount: e.baseAmount ?? e.amount,
    splits: resolveBurdens(e),
  }));
}
