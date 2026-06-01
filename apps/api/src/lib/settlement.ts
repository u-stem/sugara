import { logger } from "./logger";

type ExpenseData = {
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
