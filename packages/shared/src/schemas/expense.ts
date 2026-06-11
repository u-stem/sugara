import { z } from "zod";
import { currencyCodeSchema, toMinorUnits } from "../currency";
import { MAX_EXPENSES_PER_TRIP, MAX_LINE_ITEMS_PER_EXPENSE } from "../limits";

export const EXPENSE_TITLE_MAX_LENGTH = 200;

export const expenseSplitTypeSchema = z.enum(["equal", "custom", "itemized"]);
export type ExpenseSplitType = z.infer<typeof expenseSplitTypeSchema>;

export const expenseCategorySchema = z.enum([
  "transportation",
  "accommodation",
  "meals",
  "communication",
  "supplies",
  "entertainment",
  "conference",
  "other",
]);
export type ExpenseCategory = z.infer<typeof expenseCategorySchema>;

// Amounts use major units (e.g. 6.25 = $6.25); the service converts to minor units before DB write.
const splitItemSchema = z.object({
  userId: z.string().check(z.guid()),
  amount: z.number().min(0).optional(),
});

// Line item amounts also use major units; decimals are valid for non-JPY currencies.
const lineItemInputSchema = z.object({
  name: z.string().min(1).max(200),
  amount: z.number().positive(),
  memberIds: z.array(z.string().check(z.guid())).min(1),
});

export const createExpenseSchema = z
  .object({
    title: z.string().min(1).max(EXPENSE_TITLE_MAX_LENGTH),
    amount: z.number().positive(),
    paidByUserId: z.string().check(z.guid()),
    splitType: expenseSplitTypeSchema,
    category: expenseCategorySchema.optional(),
    currency: currencyCodeSchema.optional().default("JPY"),
    exchangeRate: z.number().positive().max(999999).optional(),
    splits: z.array(splitItemSchema).min(1),
    lineItems: z.array(lineItemInputSchema).max(MAX_LINE_ITEMS_PER_EXPENSE).optional(),
  })
  .refine(
    (data) => {
      const ids = data.splits.map((s) => s.userId);
      return new Set(ids).size === ids.length;
    },
    { message: "Duplicate userId in splits", path: ["splits"] },
  )
  .refine(
    (data) => {
      if (data.splitType === "custom" || data.splitType === "itemized") {
        return data.splits.every((s) => s.amount !== undefined);
      }
      return true;
    },
    { message: "Custom splits require amount for each member", path: ["splits"] },
  )
  .refine(
    (data) => {
      if (data.splitType === "custom" || data.splitType === "itemized") {
        // Compare in minor units so that e.g. 6.25 + 6.25 === 12.50 for USD
        // (floating-point addition of major units would lose precision).
        const splitMinor = data.splits.reduce(
          (sum, s) => sum + toMinorUnits(s.amount ?? 0, data.currency),
          0,
        );
        return splitMinor === toMinorUnits(data.amount, data.currency);
      }
      return true;
    },
    { message: "Split amounts must equal total amount", path: ["splits"] },
  )
  .refine(
    (data) => {
      if (data.splitType === "itemized") {
        return data.lineItems !== undefined && data.lineItems.length > 0;
      }
      return true;
    },
    { message: "Itemized split requires line items", path: ["lineItems"] },
  );

export const updateExpenseSchema = z
  .object({
    title: z.string().min(1).max(EXPENSE_TITLE_MAX_LENGTH),
    amount: z.number().positive(),
    paidByUserId: z.string().check(z.guid()),
    splitType: expenseSplitTypeSchema,
    category: expenseCategorySchema.nullable().optional(),
    // No default for partial updates: omitting currency keeps parsedCurrency=undefined,
    // which lets the service fall back to the existing expense's currency.
    currency: currencyCodeSchema.optional(),
    exchangeRate: z.number().positive().max(999999).optional(),
    splits: z.array(splitItemSchema).min(1),
    lineItems: z.array(lineItemInputSchema).max(MAX_LINE_ITEMS_PER_EXPENSE).optional(),
  })
  .partial()
  .refine(
    (data) => {
      // splitType and splits must be provided together
      if (data.splitType !== undefined && !data.splits) return false;
      if (data.splits && data.splitType === undefined) return false;
      return true;
    },
    { message: "splitType and splits must be provided together", path: ["splits"] },
  )
  .refine(
    (data) => {
      if (data.splits) {
        const ids = data.splits.map((s) => s.userId);
        return new Set(ids).size === ids.length;
      }
      return true;
    },
    { message: "Duplicate userId in splits", path: ["splits"] },
  )
  .refine(
    (data) => {
      if ((data.splitType === "custom" || data.splitType === "itemized") && data.splits) {
        return data.splits.every((s) => s.amount !== undefined);
      }
      return true;
    },
    { message: "Custom splits require amount for each member", path: ["splits"] },
  )
  // Note: the both-present amount/splits consistency check (when amount and splits are
  // both updated together) is intentionally omitted here. The schema layer cannot know
  // the existing expense currency when currency is absent from a partial update, so
  // minor-unit comparison is deferred to the service layer (updateExpenseCore).
  .refine(
    (data) => {
      if (data.splitType === "itemized") {
        return data.lineItems !== undefined && data.lineItems.length > 0;
      }
      return true;
    },
    { message: "Itemized split requires line items", path: ["lineItems"] },
  );

export const createSettlementPaymentSchema = z.object({
  fromUserId: z.string().check(z.guid()),
  toUserId: z.string().check(z.guid()),
  amount: z.number().int().positive(),
});

export const batchExpenseIdsSchema = z.object({
  expenseIds: z
    .array(z.string().check(z.guid()))
    .min(1)
    .max(MAX_EXPENSES_PER_TRIP)
    .refine((arr) => new Set(arr).size === arr.length, "Duplicate expense IDs are not allowed"),
});
