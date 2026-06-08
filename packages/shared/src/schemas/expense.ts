import { z } from "zod";
import { currencyCodeSchema } from "../currency";
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

const splitItemSchema = z.object({
  userId: z.string().check(z.guid()),
  amount: z.number().int().min(0).optional(),
});

const lineItemInputSchema = z.object({
  name: z.string().min(1).max(200),
  amount: z.number().int().min(1),
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
        const total = data.splits.reduce((sum, s) => sum + (s.amount ?? 0), 0);
        return total === data.amount;
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
    currency: currencyCodeSchema.optional().default("JPY"),
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
  .refine(
    (data) => {
      if (
        (data.splitType === "custom" || data.splitType === "itemized") &&
        data.splits &&
        data.amount !== undefined
      ) {
        const total = data.splits.reduce((sum, s) => sum + (s.amount ?? 0), 0);
        return total === data.amount;
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
