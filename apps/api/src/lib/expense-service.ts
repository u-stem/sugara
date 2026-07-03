import type { CurrencyCode } from "@sugara/shared";
import {
  convertToBase,
  type createExpenseSchema,
  formatCurrency,
  MAX_EXPENSES_PER_TRIP,
  toMinorUnits,
  type updateExpenseSchema,
} from "@sugara/shared";
import { count, eq, sql } from "drizzle-orm";
import type { z } from "zod";
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
import { logActivity } from "./activity-logger";
import { notifyUsers } from "./notifications";
import { calculateEqualSplit } from "./settlement";

type ExpenseRow = typeof expenses.$inferSelect;

type SplitRow = { userId: string; amount: number };

export type CreateExpenseResult =
  | { ok: true; expense: ExpenseRow; splits: SplitRow[] }
  | { ok: false; error: "exchange_rate_required" }
  | { ok: false; error: "limit_reached" }
  | { ok: false; error: "payer_not_member" }
  | { ok: false; error: "split_user_not_member" }
  | { ok: false; error: "amount_below_minor_unit" };

export type UpdateExpenseResult =
  | { ok: true; expense: ExpenseRow; splits?: SplitRow[] }
  | { ok: false; error: "not_found" }
  | { ok: false; error: "exchange_rate_required" }
  | { ok: false; error: "payer_not_member" }
  | { ok: false; error: "split_user_not_member" }
  | { ok: false; error: "split_amount_mismatch" }
  | { ok: false; error: "itemized_no_line_items" }
  | { ok: false; error: "amount_below_minor_unit" };

// Options shared by create and update operations.
// When memberIds is provided, the service skips its own DB member query and
// uses the supplied set directly — callers that already fetched members for
// other purposes (e.g. building a memberNoMap) can avoid a redundant round-trip.
type ExpenseCoreOptions = {
  memberIds?: ReadonlySet<string>;
};

/**
 * Core business logic for creating an expense.
 * Handles minor-unit conversion, exchange rate validation, member checks, and split calculation.
 * HTTP concerns (auth, param parsing, response mapping) stay in the route layer.
 *
 * @param actorName - Display name of the acting user, forwarded to push notifications.
 */
export async function createExpenseCore(
  tripId: string,
  userId: string,
  actorName: string,
  input: z.infer<typeof createExpenseSchema>,
  options?: ExpenseCoreOptions,
): Promise<CreateExpenseResult> {
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
  } = input;

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
    return { ok: false, error: "exchange_rate_required" };
  }

  // Compute baseAmount in trip currency (convertToBase expects minor units)
  const baseAmount =
    currency !== tripCurrency && exchangeRate
      ? convertToBase(minorAmount, currency as CurrencyCode, tripCurrency, exchangeRate)
      : null;

  // Verify all users are trip members.
  // When the caller already fetched members for another purpose (e.g. building
  // a memberNoMap), they can pass the set via options to skip this round-trip.
  const memberIds: ReadonlySet<string> =
    options?.memberIds ??
    new Set(
      (
        await db.query.tripMembers.findMany({
          where: eq(tripMembers.tripId, tripId),
        })
      ).map((m) => m.userId),
    );

  if (!memberIds.has(paidByUserId)) {
    return { ok: false, error: "payer_not_member" };
  }

  const allSplitUserIds = splits.map((s) => s.userId);
  if (allSplitUserIds.some((id) => !memberIds.has(id))) {
    return { ok: false, error: "split_user_not_member" };
  }

  if (lineItems?.some((item) => item.memberIds.some((id) => !memberIds.has(id)))) {
    return { ok: false, error: "split_user_not_member" };
  }

  // Guard against positive amounts that round to 0 minor units (e.g. $0.004 → 0 cents).
  // An explicit split amount of 0 is allowed as a zero-burden participant.
  if (splitType !== "equal") {
    for (const s of splits) {
      if (s.amount !== undefined && s.amount > 0 && toMinorUnits(s.amount, currency) === 0) {
        return { ok: false, error: "amount_below_minor_unit" };
      }
    }
  }
  if (lineItems) {
    for (const item of lineItems) {
      if (toMinorUnits(item.amount, currency) === 0) {
        return { ok: false, error: "amount_below_minor_unit" };
      }
    }
  }

  // Calculate split amounts for equal type (use baseAmount for settlement consistency).
  // For custom/itemized, convert each split's major-unit amount to minor units so that
  // storage matches the minor-unit convention used by expenses.amount.
  const splitAmounts =
    splitType === "equal"
      ? calculateEqualSplit(baseAmount ?? minorAmount, splits.length)
      : splits.map((s) => toMinorUnits(s.amount ?? 0, currency));

  const result = await db.transaction(async (tx) => {
    // Serialize concurrent creates per trip so the cap check cannot race:
    // two transactions could otherwise both read a count just under the cap
    // and both insert. Lock released at COMMIT.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`expense:trip:${tripId}`}))`);

    const [{ count: expenseCount }] = await tx
      .select({ count: count() })
      .from(expenses)
      .where(eq(expenses.tripId, tripId));
    if (expenseCount >= MAX_EXPENSES_PER_TRIP) {
      return null;
    }

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
            // Convert major-unit input to minor units for consistent DB storage.
            amount: toMinorUnits(item.amount, currency),
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

  if (!result) {
    return { ok: false, error: "limit_reached" };
  }

  logActivity({
    tripId,
    userId,
    action: "created",
    entityType: "expense",
    entityName: title,
    detail: formatCurrency(minorAmount, currency as CurrencyCode, "ja"),
  });

  notifyUsers({
    type: "expense_added",
    tripId,
    userIds: splits.filter((s) => s.userId !== userId).map((s) => s.userId),
    makePayload: (tripName) => ({
      actorName,
      tripName,
      entityName: title,
      amount: formatCurrency(minorAmount, currency as CurrencyCode, "ja"),
    }),
  });

  return {
    ok: true,
    expense: result,
    splits: splits.map((s, i) => ({ userId: s.userId, amount: splitAmounts[i] })),
  };
}

/**
 * Core business logic for updating an expense.
 * Handles minor-unit conversion, exchange rate validation, member checks, and split updates.
 * HTTP concerns (auth, param parsing, response mapping) stay in the route layer.
 */
export async function updateExpenseCore(
  tripId: string,
  expenseId: string,
  userId: string,
  input: z.infer<typeof updateExpenseSchema>,
  options?: ExpenseCoreOptions,
): Promise<UpdateExpenseResult> {
  const existing = await db.query.expenses.findFirst({
    where: eq(expenses.id, expenseId),
  });

  if (!existing || existing.tripId !== tripId) {
    return { ok: false, error: "not_found" };
  }

  const { splits, lineItems, exchangeRate, currency: parsedCurrency, ...restFields } = input;

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
    return { ok: false, error: "exchange_rate_required" };
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
    const memberIds: ReadonlySet<string> =
      options?.memberIds ??
      new Set(
        (
          await db.query.tripMembers.findMany({
            where: eq(tripMembers.tripId, tripId),
          })
        ).map((m) => m.userId),
      );

    if (updateFields.paidByUserId && !memberIds.has(updateFields.paidByUserId)) {
      return { ok: false, error: "payer_not_member" };
    }

    if (splits?.some((s) => !memberIds.has(s.userId))) {
      return { ok: false, error: "split_user_not_member" };
    }

    if (lineItems?.some((item) => item.memberIds.some((id) => !memberIds.has(id)))) {
      return { ok: false, error: "split_user_not_member" };
    }
  }

  // Guard against positive amounts that round to 0 minor units (e.g. $0.004 → 0 cents).
  // An explicit split amount of 0 is allowed as a zero-burden participant.
  if (splits && (updateFields.splitType ?? existing.splitType) !== "equal") {
    for (const s of splits) {
      if (s.amount !== undefined && s.amount > 0 && toMinorUnits(s.amount, finalCurrency) === 0) {
        return { ok: false, error: "amount_below_minor_unit" };
      }
    }
  }
  if (lineItems) {
    for (const item of lineItems) {
      if (toMinorUnits(item.amount, finalCurrency) === 0) {
        return { ok: false, error: "amount_below_minor_unit" };
      }
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
      return { ok: false, error: "split_amount_mismatch" };
    }
  }

  // When splits change, verify the new split total matches the effective expense amount in minor units.
  // "equal" is skipped: calculateEqualSplit recomputes amounts from the stored total.
  if (splits) {
    const effectiveSplitType = updateFields.splitType ?? existing.splitType;
    if (effectiveSplitType === "custom" || effectiveSplitType === "itemized") {
      // Use the incoming minor amount when amount is also being updated; otherwise fall back to the
      // existing stored minor-unit amount. This covers "splits-only" and "amount+splits" in one check.
      const expectedMinor = minorAmount ?? existing.amount;
      const splitsTotal = splits.reduce(
        (sum, s) => sum + toMinorUnits(s.amount ?? 0, finalCurrency),
        0,
      );
      if (splitsTotal !== expectedMinor) {
        return { ok: false, error: "split_amount_mismatch" };
      }
    }
  }

  // Reject empty lineItems when splitType remains itemized
  if (lineItems !== undefined) {
    const effectiveSplitType = updateFields.splitType ?? existing.splitType;
    if (effectiveSplitType === "itemized" && lineItems.length === 0) {
      return { ok: false, error: "itemized_no_line_items" };
    }
  }

  // Captured inside the transaction and returned to callers that already hold
  // the memberNoMap so they can skip a second DB round-trip for serialization.
  // Undefined when splits were not modified in this update.
  let computedSplits: SplitRow[] | undefined;
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
          : splits.map((s) => toMinorUnits(s.amount ?? 0, finalCurrency));

      // Capture for the return value before the DB operations consume the arrays.
      computedSplits = splits.map((s, i) => ({ userId: s.userId, amount: splitAmounts[i] }));
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
              amount: toMinorUnits(item.amount, finalCurrency),
              sortOrder: i,
            })),
          )
          .returning({ id: expenseLineItems.id, sortOrder: expenseLineItems.sortOrder });

        // Look up original lineItem by sortOrder via Map (see createExpenseCore for rationale).
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
    userId,
    action: "updated",
    entityType: "expense",
    entityName: updated.title,
    detail,
  });

  return { ok: true, expense: updated, splits: computedSplits };
}
