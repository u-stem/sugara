import type { CurrencyCode, ExpenseCategory } from "@sugara/shared";
import {
  convertToBase,
  createExpenseSchema,
  EXPENSE_CATEGORY_LABELS,
  formatCurrency,
  MAX_EXPENSES_PER_TRIP,
  toMinorUnits,
  updateExpenseSchema,
} from "@sugara/shared";
import { count, eq } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db/index";
import {
  expenseLineItemMembers,
  expenseLineItems,
  expenseSplits,
  expenses,
  settlementPayments,
  tripMembers,
  trips,
} from "../db/schema";
import { logActivity } from "../lib/activity-logger";
import { ERROR_MSG } from "../lib/constants";
import { notifyUsers } from "../lib/notifications";
import { getParam } from "../lib/params";
import {
  calculateDirectTransfers,
  calculateEqualSplit,
  calculateSettlement,
} from "../lib/settlement";
import { requireAuth } from "../middleware/auth";
import { requireTripAccess } from "../middleware/require-trip-access";
import type { AppEnv } from "../types";

const expenseRoutes = new Hono<AppEnv>();
expenseRoutes.use("*", requireAuth);

// List expenses with settlement summary
expenseRoutes.get("/:tripId/expenses", requireTripAccess(), async (c) => {
  const tripId = getParam(c, "tripId");

  const [expenseList, members, tripRow] = await Promise.all([
    db.query.expenses.findMany({
      where: eq(expenses.tripId, tripId),
      with: {
        paidByUser: { columns: { id: true, name: true } },
        splits: { with: { user: { columns: { id: true, name: true } } } },
        lineItems: {
          with: { members: true },
          orderBy: (lineItems, { asc }) => [asc(lineItems.sortOrder)],
        },
      },
      orderBy: (expenses, { desc }) => [desc(expenses.createdAt)],
    }),
    db.query.tripMembers.findMany({
      where: eq(tripMembers.tripId, tripId),
      with: { user: { columns: { id: true, name: true } } },
    }),
    db.query.trips.findFirst({
      where: eq(trips.id, tripId),
      columns: { currency: true },
    }),
  ]);
  const tripCurrency = (tripRow?.currency ?? "JPY") as CurrencyCode;

  const memberInfos = members.map((m) => ({ id: m.user.id, name: m.user.name }));
  const expenseData = expenseList.map((e) => ({
    paidByUserId: e.paidByUserId,
    amount: e.baseAmount ?? e.amount,
    splits: e.splits.map((s) => ({ userId: s.userId, amount: s.amount })),
  }));

  const settlement = {
    ...calculateSettlement(expenseData, memberInfos),
    directTransfers: calculateDirectTransfers(expenseData, memberInfos),
  };

  const categoryMap = new Map<string, { total: number; count: number }>();
  for (const e of expenseList) {
    if (e.category) {
      const existing = categoryMap.get(e.category) ?? { total: 0, count: 0 };
      existing.total += e.baseAmount ?? e.amount;
      existing.count += 1;
      categoryMap.set(e.category, existing);
    }
  }

  const categoryTotals = Array.from(categoryMap.entries()).map(([category, data]) => ({
    category: category as ExpenseCategory,
    label: EXPENSE_CATEGORY_LABELS[category as ExpenseCategory],
    total: data.total,
    count: data.count,
  }));

  const payments = await db.query.settlementPayments.findMany({
    where: eq(settlementPayments.tripId, tripId),
  });

  return c.json({
    tripCurrency,
    expenses: expenseList,
    settlement,
    settlementPayments: payments,
    categoryTotals,
  });
});

// Create expense
expenseRoutes.post("/:tripId/expenses", requireTripAccess("editor"), async (c) => {
  const user = c.get("user");
  const tripId = getParam(c, "tripId");

  const body = await c.req.json();
  const parsed = createExpenseSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  const {
    title,
    amount,
    paidByUserId,
    splitType,
    splits,
    lineItems,
    category,
    currency,
    exchangeRate,
  } = parsed.data;

  // Convert display amount to minor units (e.g. $12.50 -> 1250 cents)
  const minorAmount = toMinorUnits(amount, currency as CurrencyCode);

  // Fetch trip currency to validate exchange rate and compute baseAmount
  const trip = await db.query.trips.findFirst({
    where: eq(trips.id, tripId),
    columns: { currency: true },
  });
  const tripCurrency = (trip?.currency ?? "JPY") as CurrencyCode;

  // Validate exchangeRate when expense currency differs from trip currency
  if (currency !== tripCurrency && !exchangeRate) {
    return c.json(
      { error: "exchangeRate is required when currency differs from trip currency" },
      400,
    );
  }

  // Compute baseAmount in trip currency (convertToBase expects minor units)
  const baseAmount =
    currency !== tripCurrency && exchangeRate
      ? convertToBase(minorAmount, currency as CurrencyCode, tripCurrency, exchangeRate)
      : null;

  // Check expense count limit
  const [{ count: expenseCount }] = await db
    .select({ count: count() })
    .from(expenses)
    .where(eq(expenses.tripId, tripId));

  if (expenseCount >= MAX_EXPENSES_PER_TRIP) {
    return c.json({ error: ERROR_MSG.LIMIT_EXPENSES }, 409);
  }

  // Verify all users are trip members
  const members = await db.query.tripMembers.findMany({
    where: eq(tripMembers.tripId, tripId),
  });
  const memberIds = new Set(members.map((m) => m.userId));

  if (!memberIds.has(paidByUserId)) {
    return c.json({ error: ERROR_MSG.EXPENSE_PAYER_NOT_MEMBER }, 400);
  }

  const allSplitUserIds = splits.map((s) => s.userId);
  if (allSplitUserIds.some((id) => !memberIds.has(id))) {
    return c.json({ error: ERROR_MSG.EXPENSE_SPLIT_USER_NOT_MEMBER }, 400);
  }

  if (lineItems?.some((item) => item.memberIds.some((id) => !memberIds.has(id)))) {
    return c.json({ error: ERROR_MSG.EXPENSE_SPLIT_USER_NOT_MEMBER }, 400);
  }

  // Calculate split amounts for equal type (use baseAmount for settlement consistency)
  const splitAmounts =
    splitType === "equal"
      ? calculateEqualSplit(baseAmount ?? minorAmount, splits.length)
      : splits.map((s) => s.amount ?? 0);

  const result = await db.transaction(async (tx) => {
    const [expense] = await tx
      .insert(expenses)
      .values({
        tripId,
        paidByUserId,
        title,
        amount: minorAmount,
        currency,
        ...(exchangeRate !== undefined ? { exchangeRate: String(exchangeRate) } : {}),
        baseAmount,
        splitType,
        category: category ?? null,
      })
      .returning();

    await tx.insert(expenseSplits).values(
      splits.map((s, i) => ({
        expenseId: expense.id,
        userId: s.userId,
        amount: splitAmounts[i],
      })),
    );

    if (lineItems && lineItems.length > 0) {
      const insertedItems = await tx
        .insert(expenseLineItems)
        .values(
          lineItems.map((item, i) => ({
            expenseId: expense.id,
            name: item.name,
            amount: item.amount,
            sortOrder: i,
          })),
        )
        .returning({ id: expenseLineItems.id, sortOrder: expenseLineItems.sortOrder });

      // PostgreSQL does not guarantee RETURNING row order for multi-row inserts, so look up
      // the original lineItem by sortOrder via a Map rather than relying on array index order.
      const lineItemsBySortOrder = new Map(lineItems.map((item, i) => [i, item]));
      const memberRows = insertedItems.flatMap((row) => {
        const source = lineItemsBySortOrder.get(row.sortOrder);
        if (!source) return [];
        return source.memberIds.map((userId) => ({ lineItemId: row.id, userId }));
      });
      if (memberRows.length > 0) {
        await tx.insert(expenseLineItemMembers).values(memberRows);
      }
    }

    // Auto-reset settlement payments when expenses change
    await tx.delete(settlementPayments).where(eq(settlementPayments.tripId, tripId));

    return expense;
  });

  logActivity({
    tripId,
    userId: user.id,
    action: "created",
    entityType: "expense",
    entityName: title,
    detail: formatCurrency(minorAmount, currency as CurrencyCode, "ja"),
  });

  notifyUsers({
    type: "expense_added",
    tripId,
    userIds: splits.filter((s) => s.userId !== user.id).map((s) => s.userId),
    makePayload: (tripName) => ({
      actorName: user.name,
      tripName,
      entityName: title,
      amount: formatCurrency(minorAmount, currency as CurrencyCode, "ja"),
    }),
  });

  return c.json(result, 201);
});

// Update expense
expenseRoutes.patch("/:tripId/expenses/:expenseId", requireTripAccess("editor"), async (c) => {
  const user = c.get("user");
  const tripId = getParam(c, "tripId");
  const expenseId = getParam(c, "expenseId");

  const body = await c.req.json();
  const parsed = updateExpenseSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  const existing = await db.query.expenses.findFirst({
    where: eq(expenses.id, expenseId),
  });

  if (!existing || existing.tripId !== tripId) {
    return c.json({ error: ERROR_MSG.EXPENSE_NOT_FOUND }, 404);
  }

  const { splits, lineItems, exchangeRate, currency: parsedCurrency, ...restFields } = parsed.data;

  // Fetch trip currency when amount or currency changes (needed for baseAmount recalculation)
  const finalCurrency = (parsedCurrency ?? existing.currency ?? "JPY") as CurrencyCode;
  const needsTripCurrency =
    parsedCurrency !== undefined || restFields.amount !== undefined || exchangeRate !== undefined;
  let tripCurrency: CurrencyCode = "JPY";
  if (needsTripCurrency) {
    const trip = await db.query.trips.findFirst({
      where: eq(trips.id, tripId),
      columns: { currency: true },
    });
    tripCurrency = (trip?.currency ?? "JPY") as CurrencyCode;
  }

  // Validate exchangeRate when expense currency differs from trip currency
  const finalExchangeRate =
    exchangeRate ?? (existing.exchangeRate ? Number(existing.exchangeRate) : undefined);
  if (needsTripCurrency && finalCurrency !== tripCurrency && !finalExchangeRate) {
    return c.json(
      { error: "exchangeRate is required when currency differs from trip currency" },
      400,
    );
  }

  // Convert display amount to minor units when amount is provided
  const minorAmount =
    restFields.amount !== undefined ? toMinorUnits(restFields.amount, finalCurrency) : undefined;

  // Compute baseAmount in trip currency (convertToBase expects minor units)
  const finalMinorAmount = minorAmount ?? existing.amount;
  let baseAmount: number | null = null;
  if (needsTripCurrency) {
    baseAmount =
      finalCurrency !== tripCurrency && finalExchangeRate
        ? convertToBase(finalMinorAmount, finalCurrency, tripCurrency, finalExchangeRate)
        : null;
  }

  // Drizzle's numeric column expects string; convert from the Zod number type
  // Replace display amount with minor units for DB storage
  const { amount: _displayAmount, ...restFieldsWithoutAmount } = restFields;
  const updateFields = {
    ...restFieldsWithoutAmount,
    ...(minorAmount !== undefined ? { amount: minorAmount } : {}),
    ...(parsedCurrency !== undefined ? { currency: parsedCurrency } : {}),
    ...(exchangeRate !== undefined ? { exchangeRate: String(exchangeRate) } : {}),
    ...(needsTripCurrency ? { baseAmount } : {}),
  };

  // Verify member constraints when paidByUserId, splits, or lineItems change
  if (updateFields.paidByUserId || splits || lineItems) {
    const members = await db.query.tripMembers.findMany({
      where: eq(tripMembers.tripId, tripId),
    });
    const memberIds = new Set(members.map((m) => m.userId));

    if (updateFields.paidByUserId && !memberIds.has(updateFields.paidByUserId)) {
      return c.json({ error: ERROR_MSG.EXPENSE_PAYER_NOT_MEMBER }, 400);
    }

    if (splits?.some((s) => !memberIds.has(s.userId))) {
      return c.json({ error: ERROR_MSG.EXPENSE_SPLIT_USER_NOT_MEMBER }, 400);
    }

    if (lineItems?.some((item) => item.memberIds.some((id) => !memberIds.has(id)))) {
      return c.json({ error: ERROR_MSG.EXPENSE_SPLIT_USER_NOT_MEMBER }, 400);
    }
  }

  // When only amount changes (no splits provided), verify existing splits still sum correctly.
  // Without this check, the expense amount and split totals would become inconsistent.
  if (updateFields.amount !== undefined && !splits) {
    const existingSplits = await db.query.expenseSplits.findMany({
      where: eq(expenseSplits.expenseId, expenseId),
    });
    const existingTotal = existingSplits.reduce((sum, s) => sum + s.amount, 0);
    if (existingTotal !== updateFields.amount) {
      return c.json({ error: ERROR_MSG.EXPENSE_SPLIT_AMOUNT_MISMATCH }, 400);
    }
  }

  // When only splits change (no amount provided), verify new splits sum matches existing amount.
  // "equal" is skipped because calculateEqualSplit recalculates amounts from existing.amount.
  if (splits && updateFields.amount === undefined) {
    const effectiveSplitType = updateFields.splitType ?? existing.splitType;
    if (effectiveSplitType === "custom" || effectiveSplitType === "itemized") {
      const splitsTotal = splits.reduce((sum, s) => sum + (s.amount ?? 0), 0);
      if (splitsTotal !== existing.amount) {
        return c.json({ error: ERROR_MSG.EXPENSE_SPLIT_AMOUNT_MISMATCH }, 400);
      }
    }
  }

  // Reject empty lineItems when splitType remains itemized
  if (lineItems !== undefined) {
    const effectiveSplitType = updateFields.splitType ?? existing.splitType;
    if (effectiveSplitType === "itemized" && lineItems.length === 0) {
      return c.json({ error: "Itemized split requires line items" }, 400);
    }
  }

  const updated = await db.transaction(async (tx) => {
    const [result] = await tx
      .update(expenses)
      .set({ ...updateFields, updatedAt: new Date() })
      .where(eq(expenses.id, expenseId))
      .returning();

    if (splits) {
      const effectiveBaseAmount = needsTripCurrency
        ? (baseAmount ?? finalMinorAmount)
        : (existing.baseAmount ?? existing.amount);
      const finalSplitType = updateFields.splitType ?? existing.splitType;
      const splitAmounts =
        finalSplitType === "equal"
          ? calculateEqualSplit(effectiveBaseAmount, splits.length)
          : splits.map((s) => s.amount ?? 0);

      await tx.delete(expenseSplits).where(eq(expenseSplits.expenseId, expenseId));
      await tx.insert(expenseSplits).values(
        splits.map((s, i) => ({
          expenseId,
          userId: s.userId,
          amount: splitAmounts[i],
        })),
      );
    }

    if (lineItems !== undefined) {
      await tx.delete(expenseLineItems).where(eq(expenseLineItems.expenseId, expenseId));
      if (lineItems.length > 0) {
        const insertedItems = await tx
          .insert(expenseLineItems)
          .values(
            lineItems.map((item, i) => ({
              expenseId,
              name: item.name,
              amount: item.amount,
              sortOrder: i,
            })),
          )
          .returning({ id: expenseLineItems.id, sortOrder: expenseLineItems.sortOrder });

        // Look up original lineItem by sortOrder via Map (see POST path for rationale).
        const lineItemsBySortOrder = new Map(lineItems.map((item, i) => [i, item]));
        const memberRows = insertedItems.flatMap((row) => {
          const source = lineItemsBySortOrder.get(row.sortOrder);
          if (!source) return [];
          return source.memberIds.map((userId) => ({ lineItemId: row.id, userId }));
        });
        if (memberRows.length > 0) {
          await tx.insert(expenseLineItemMembers).values(memberRows);
        }
      }
    } else if (updateFields.splitType && updateFields.splitType !== "itemized") {
      // splitType changed away from itemized: clean up orphaned line items
      await tx.delete(expenseLineItems).where(eq(expenseLineItems.expenseId, expenseId));
    }

    // Auto-reset settlement payments when expenses change
    await tx.delete(settlementPayments).where(eq(settlementPayments.tripId, tripId));

    return result;
  });

  const oldAmount = existing.amount;
  const newAmount = updated.amount;
  const updatedCurrency = (updated.currency ?? "JPY") as CurrencyCode;
  const existingCurrency = (existing.currency ?? "JPY") as CurrencyCode;
  const detail =
    oldAmount !== newAmount || existingCurrency !== updatedCurrency
      ? `${formatCurrency(oldAmount, existingCurrency, "ja")} → ${formatCurrency(newAmount, updatedCurrency, "ja")}`
      : formatCurrency(newAmount, updatedCurrency, "ja");

  logActivity({
    tripId,
    userId: user.id,
    action: "updated",
    entityType: "expense",
    entityName: updated.title,
    detail,
  });

  return c.json(updated);
});

// Delete expense
expenseRoutes.delete("/:tripId/expenses/:expenseId", requireTripAccess("editor"), async (c) => {
  const user = c.get("user");
  const tripId = getParam(c, "tripId");
  const expenseId = getParam(c, "expenseId");

  const existing = await db.query.expenses.findFirst({
    where: eq(expenses.id, expenseId),
  });

  if (!existing || existing.tripId !== tripId) {
    return c.json({ error: ERROR_MSG.EXPENSE_NOT_FOUND }, 404);
  }

  await db.transaction(async (tx) => {
    await tx.delete(expenses).where(eq(expenses.id, expenseId));
    // Auto-reset settlement payments when expenses change
    await tx.delete(settlementPayments).where(eq(settlementPayments.tripId, tripId));
  });

  logActivity({
    tripId,
    userId: user.id,
    action: "deleted",
    entityType: "expense",
    entityName: existing.title,
    detail: formatCurrency(existing.amount, (existing.currency ?? "JPY") as CurrencyCode, "ja"),
  });

  return c.body(null, 204);
});

export { expenseRoutes };
