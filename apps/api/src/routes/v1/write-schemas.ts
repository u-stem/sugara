// v1 write-operation request and response schemas.
//
// Request schemas are v1-specific because:
//   - Trip create/update strips internal-storage fields (coverImageUrl,
//     coverImagePosition) — external callers must not write internal Storage URLs.
//   - Schedule create/update strips anchoring fields (crossDayAnchor*,
//     expectedUpdatedAt) that only make sense in the real-time UI flow.
//   - Expense create/update replaces userId fields with memberNo so that the v1
//     caller never handles internal UUIDs.
//
// Response schemas define the external DTO shape. Internal UUIDs (ownerId,
// paidByUserId, splits.userId) are never included.

import {
  createArticleSchema,
  createBookmarkListSchema,
  createBookmarkSchema,
  createScheduleSchema,
  createTripBaseSchema,
  currencyCodeSchema,
  EXPENSE_TITLE_MAX_LENGTH,
  expenseCategorySchema,
  expenseSplitTypeSchema,
  MAX_LINE_ITEMS_PER_EXPENSE,
  updateArticleSchema,
  updateBookmarkListSchema,
  updateBookmarkSchema,
  updateTripBaseSchema,
} from "@sugara/shared";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Re-exports: bookmark and article schemas are used as-is in v1
// ---------------------------------------------------------------------------

export {
  createBookmarkListSchema as v1CreateBookmarkListSchema,
  createBookmarkSchema as v1CreateBookmarkSchema,
  createArticleSchema as v1CreateArticleSchema,
  updateBookmarkListSchema as v1UpdateBookmarkListSchema,
  updateBookmarkSchema as v1UpdateBookmarkSchema,
  updateArticleSchema as v1UpdateArticleSchema,
};

// ---------------------------------------------------------------------------
// Trip request schemas
// ---------------------------------------------------------------------------

// v1 trip create omits internal-storage fields: callers supply dates and
// basic metadata only. The date order refine is re-applied here (it lives on
// the refined schema, not the base schema that .omit() operates on).
export const v1CreateTripSchema = createTripBaseSchema
  .omit({ coverImageUrl: true, coverImagePosition: true })
  .refine((data) => data.endDate >= data.startDate, {
    message: "End date must be on or after start date",
    path: ["endDate"],
  });

export type V1CreateTripInput = z.infer<typeof v1CreateTripSchema>;

// v1 trip update omits the same internal-storage fields.
// updateTripBaseSchema has both dates optional; the refine only fires when both
// are present (same cross-field guard as the internal updateTripSchema).
export const v1UpdateTripSchema = updateTripBaseSchema
  .omit({ coverImageUrl: true, coverImagePosition: true })
  .refine(
    (data) => {
      if (data.startDate && data.endDate) return data.endDate >= data.startDate;
      return true;
    },
    { message: "End date must be on or after start date", path: ["endDate"] },
  );

export type V1UpdateTripInput = z.infer<typeof v1UpdateTripSchema>;

// ---------------------------------------------------------------------------
// Schedule request schemas
// ---------------------------------------------------------------------------

// Strip anchoring fields that only make sense in the real-time drag-and-drop
// flow, and geolocation fields that no v1 DTO (write response or GET /trips/:id)
// returns — accepting write-only fields would let callers store values they can
// never read back. Callers can still set start/end times, cost, URLs, etc.
export const v1CreateScheduleSchema = createScheduleSchema.omit({
  crossDayAnchor: true,
  crossDayAnchorSourceId: true,
  latitude: true,
  longitude: true,
  placeId: true,
});

export type V1CreateScheduleInput = z.infer<typeof v1CreateScheduleSchema>;

// Partial update: all fields optional, same anchor omission, no expectedUpdatedAt.
export const v1UpdateScheduleSchema = v1CreateScheduleSchema.partial();

export type V1UpdateScheduleInput = z.infer<typeof v1UpdateScheduleSchema>;

// ---------------------------------------------------------------------------
// Expense request schemas (memberNo-based)
// ---------------------------------------------------------------------------

// v1 expense split references a member by the stable, non-secret memberNo
// instead of an internal userId UUID.
const v1SplitItemSchema = z.object({
  memberNo: z.number().int().positive(),
  amount: z.number().int().min(0).optional(),
});

const v1LineItemInputSchema = z.object({
  name: z.string().min(1).max(200),
  amount: z.number().int().min(1),
  // Parallel to lineItems[].memberIds in the internal schema but using memberNos.
  memberNos: z.array(z.number().int().positive()).min(1),
});

// Validation logic mirrors createExpenseSchema but with memberNo references.
export const v1CreateExpenseSchema = z
  .object({
    title: z.string().min(1).max(EXPENSE_TITLE_MAX_LENGTH),
    amount: z.number().positive(),
    paidByMemberNo: z.number().int().positive(),
    splitType: expenseSplitTypeSchema,
    category: expenseCategorySchema.optional(),
    currency: currencyCodeSchema.optional().default("JPY"),
    exchangeRate: z.number().positive().max(999999).optional(),
    splits: z.array(v1SplitItemSchema).min(1),
    lineItems: z.array(v1LineItemInputSchema).max(MAX_LINE_ITEMS_PER_EXPENSE).optional(),
  })
  .refine(
    (data) => {
      const nos = data.splits.map((s) => s.memberNo);
      return new Set(nos).size === nos.length;
    },
    { message: "Duplicate memberNo in splits", path: ["splits"] },
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

export type V1CreateExpenseInput = z.infer<typeof v1CreateExpenseSchema>;

// Partial update mirrors updateExpenseSchema but with memberNo fields.
// The refines only fire when the relevant partial fields are present.
export const v1UpdateExpenseSchema = z
  .object({
    title: z.string().min(1).max(EXPENSE_TITLE_MAX_LENGTH),
    amount: z.number().positive(),
    paidByMemberNo: z.number().int().positive(),
    splitType: expenseSplitTypeSchema,
    category: expenseCategorySchema.nullable().optional(),
    currency: currencyCodeSchema.optional().default("JPY"),
    exchangeRate: z.number().positive().max(999999).optional(),
    splits: z.array(v1SplitItemSchema).min(1),
    lineItems: z.array(v1LineItemInputSchema).max(MAX_LINE_ITEMS_PER_EXPENSE).optional(),
  })
  .partial()
  .refine(
    (data) => {
      // splitType and splits must always travel together
      if (data.splitType !== undefined && !data.splits) return false;
      if (data.splits && data.splitType === undefined) return false;
      return true;
    },
    { message: "splitType and splits must be provided together", path: ["splits"] },
  )
  .refine(
    (data) => {
      if (data.splits) {
        const nos = data.splits.map((s) => s.memberNo);
        return new Set(nos).size === nos.length;
      }
      return true;
    },
    { message: "Duplicate memberNo in splits", path: ["splits"] },
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
      // When amount and splits are both replaced in one request, neither of the
      // single-field consistency checks in updateExpenseCore fires — this refine
      // is the only guard against storing splits that do not sum to the amount
      // (mirrors the both-present refine in the shared updateExpenseSchema).
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

export type V1UpdateExpenseInput = z.infer<typeof v1UpdateExpenseSchema>;

// ---------------------------------------------------------------------------
// Response schemas — external DTO shapes for write operations
// ---------------------------------------------------------------------------

// Trip write response: basic fields only, no ownerId or cover image internals.
export const v1TripWriteResponseSchema = z.object({
  id: z.string(),
  title: z.string(),
  destination: z.string().nullable(),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  currency: z.string(),
  status: z.enum(["scheduling", "draft", "planned", "active", "completed"]),
  createdAt: z.string(),
  updatedAt: z.string(),
});

// Schedule write response: all non-internal fields.
export const v1ScheduleWriteResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.enum(["sightseeing", "restaurant", "hotel", "transport", "activity", "other"]),
  startTime: z.string().nullable(),
  endTime: z.string().nullable(),
  address: z.string().nullable(),
  memo: z.string().nullable(),
  urls: z.array(z.string()),
  departurePlace: z.string().nullable(),
  arrivalPlace: z.string().nullable(),
  transportMethod: z.string().nullable(),
  cost: z.number().int().nullable(),
  color: z.string(),
  endDayOffset: z.number().int().nullable(),
  sortOrder: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

// Expense write response: memberNo-based references, no internal userId exposure.
const v1ExpenseMemberRefWriteSchema = z.object({
  memberNo: z.number().int().optional(),
  displayName: z.string(),
});

const v1ExpenseSplitWriteSchema = v1ExpenseMemberRefWriteSchema.extend({
  amount: z.number().int(),
});

export const v1ExpenseWriteResponseSchema = z.object({
  id: z.string(),
  title: z.string(),
  amount: z.number().int(),
  currency: z.string(),
  category: z.string().nullable(),
  date: z.string(), // ISO 8601 (createdAt)
  paidBy: v1ExpenseMemberRefWriteSchema,
  splits: z.array(v1ExpenseSplitWriteSchema),
});

// Bookmark list write response.
export const v1BookmarkListWriteResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  visibility: z.enum(["private", "friends_only", "public"]),
  sortOrder: z.number().int(),
  bookmarkCount: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

// Bookmark write response.
export const v1BookmarkWriteResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  memo: z.string().nullable(),
  urls: z.array(z.string()),
  sortOrder: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

// Article write response: no ownerId, no likeCount (caller owns the article).
export const v1ArticleWriteResponseSchema = z.object({
  id: z.string(),
  title: z.string(),
  content: z.string(),
  tags: z.array(z.string()),
  visibility: z.enum(["private", "friends_only", "public"]),
  tripIds: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
});
