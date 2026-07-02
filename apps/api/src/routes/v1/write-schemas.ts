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
  createDayPatternSchema,
  createScheduleSchema,
  createSouvenirSchema,
  createTripBaseSchema,
  currencyCodeSchema,
  EXPENSE_TITLE_MAX_LENGTH,
  expenseCategorySchema,
  expenseSplitTypeSchema,
  MAX_LINE_ITEMS_PER_EXPENSE,
  overwriteDayPatternSchema,
  splitsTotalMatchesAmount,
  tripStatusSchema,
  updateArticleSchema,
  updateBookmarkListSchema,
  updateBookmarkSchema,
  updateSouvenirSchema,
  updateTripBaseSchema,
} from "@sugara/shared";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Re-exports: bookmark, article, and pattern schemas are used as-is in v1
// ---------------------------------------------------------------------------

export {
  createBookmarkListSchema as v1CreateBookmarkListSchema,
  createBookmarkSchema as v1CreateBookmarkSchema,
  createArticleSchema as v1CreateArticleSchema,
  createSouvenirSchema as v1CreateSouvenirSchema,
  // Rename shares the create shape ({ label }) — sortOrder stays internal-only.
  createDayPatternSchema as v1CreatePatternSchema,
  createDayPatternSchema as v1UpdatePatternSchema,
  overwriteDayPatternSchema as v1OverwritePatternSchema,
  updateBookmarkListSchema as v1UpdateBookmarkListSchema,
  updateBookmarkSchema as v1UpdateBookmarkSchema,
  updateArticleSchema as v1UpdateArticleSchema,
  updateSouvenirSchema as v1UpdateSouvenirSchema,
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

// POST .../days/:dayNumber/schedules body: an optional patternId lets callers
// target a non-default pattern. Omitted → falls back to the day's isDefault
// pattern (unchanged behavior for existing callers).
export const v1CreateScheduleBodySchema = v1CreateScheduleSchema.extend({
  patternId: z.string().check(z.guid()).optional(),
});

export type V1CreateScheduleBodyInput = z.infer<typeof v1CreateScheduleBodySchema>;

// ---------------------------------------------------------------------------
// Candidate assignment / schedule move request schemas
// ---------------------------------------------------------------------------

export const v1AssignCandidateSchema = z.object({
  patternId: z.string().check(z.guid()),
});

export type V1AssignCandidateInput = z.infer<typeof v1AssignCandidateSchema>;

export const v1MoveScheduleSchema = z.object({
  patternId: z.string().check(z.guid()),
});

export type V1MoveScheduleInput = z.infer<typeof v1MoveScheduleSchema>;

// ---------------------------------------------------------------------------
// Expense request schemas (memberNo-based)
// ---------------------------------------------------------------------------

// v1 expense split references a member by the stable, non-secret memberNo
// instead of an internal userId UUID.
// Amounts use major units (e.g. 6.25 = $6.25); the service converts to minor units before DB write.
const v1SplitItemSchema = z.object({
  memberNo: z.number().int().positive(),
  amount: z.number().min(0).optional(),
});

// Line item amounts also use major units; decimals are valid for non-JPY currencies.
const v1LineItemInputSchema = z.object({
  name: z.string().min(1).max(200),
  amount: z.number().positive(),
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
  .refine((data) => splitsTotalMatchesAmount(data), {
    message: "Split amounts must equal total amount",
    path: ["splits"],
  })
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
    // No default for partial updates: omitting currency keeps parsedCurrency=undefined,
    // which lets the service fall back to the existing expense's currency.
    currency: currencyCodeSchema.optional(),
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
  // Note: the both-present amount/splits consistency check is omitted intentionally.
  // The schema cannot know the existing expense currency when currency is absent from
  // a partial update, so minor-unit comparison is deferred to the service layer
  // (updateExpenseCore).
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

// _meta: count/limit context returned on write operations where callers need to
// know the resulting item count relative to the per-resource cap.
export const v1WriteMetaSchema = z.object({
  count: z.number().int(),
  max: z.number().int(),
});

// Trip write response: basic fields only, no ownerId or cover image internals.
export const v1TripWriteResponseSchema = z.object({
  id: z.string(),
  title: z.string(),
  destination: z.string().nullable(),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  currency: z.string(),
  status: tripStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});

// Schedule write response: all non-internal fields.
// Used by trips-write (POST/PATCH /schedules) which are not cap-context aware.
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

// Candidate write response = schedule DTO + _meta (count of ALL schedules in the
// trip vs. MAX_SCHEDULES_PER_TRIP). Only candidate routes include _meta because
// they write to the trip-wide schedule pool that callers need to track.
export const v1CandidateWriteResponseSchema = v1ScheduleWriteResponseSchema.extend({
  _meta: v1WriteMetaSchema,
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

// Souvenir write response: owner expressed as a memberNo-based ref (no internal
// userId). Matches serializeSouvenirDto.
const v1SouvenirOwnerSchema = z.object({
  memberNo: z.number().int().optional(),
  displayName: z.string(),
});

// Base souvenir DTO shape (without _meta) reused by both the single-create and
// the batch-create response schemas.
const v1SouvenirDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  recipient: z.string().nullable(),
  urls: z.array(z.string()),
  addresses: z.array(z.string()),
  memo: z.string().nullable(),
  priority: z.enum(["high", "medium"]).nullable(),
  isPurchased: z.boolean(),
  isShared: z.boolean(),
  shareStyle: z.enum(["recommend", "errand"]).nullable(),
  owner: v1SouvenirOwnerSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const v1SouvenirWriteResponseSchema = v1SouvenirDtoSchema.extend({
  _meta: v1WriteMetaSchema,
});

// ---------------------------------------------------------------------------
// Batch write schemas — shared helpers
// ---------------------------------------------------------------------------

// Skipped-item type carried in both candidate and souvenir batch responses.
const v1BatchSkippedItemSchema = z.object({
  name: z.string(),
  reason: z.enum(["duplicate", "limit_reached"]),
});

// Conflict resolution for batch creates.
// "create" (default): always insert — matches single-create semantics.
// "skip": items whose name (trim + toLowerCase) matches an existing entry in
//   the trip/user scope OR an earlier item in the same batch are skipped with
//   reason "duplicate". This is an exact-match check; unlike list q= which
//   uses partial/case-insensitive substring matching.
const v1BatchOnConflictSchema = z.enum(["create", "skip"]).default("create");

// ---------------------------------------------------------------------------
// Candidate batch schemas
// ---------------------------------------------------------------------------

export const v1BatchCreateCandidateSchema = z.object({
  items: z.array(v1CreateScheduleSchema).min(1).max(50),
  onConflict: v1BatchOnConflictSchema,
});

export type V1BatchCreateCandidateInput = z.infer<typeof v1BatchCreateCandidateSchema>;

// Batch response: created carries plain schedule DTOs (no per-item _meta);
// _meta at the response root reflects the post-batch trip-wide schedule count.
export const v1CandidateBatchWriteResponseSchema = z.object({
  created: z.array(v1ScheduleWriteResponseSchema),
  skipped: z.array(v1BatchSkippedItemSchema),
  _meta: v1WriteMetaSchema,
});

// ---------------------------------------------------------------------------
// Souvenir batch schemas
// ---------------------------------------------------------------------------

export const v1BatchCreateSouvenirSchema = z.object({
  items: z.array(createSouvenirSchema).min(1).max(50),
  onConflict: v1BatchOnConflictSchema,
});

export type V1BatchCreateSouvenirInput = z.infer<typeof v1BatchCreateSouvenirSchema>;

// Batch response: created items use the base souvenir DTO without per-item _meta.
export const v1SouvenirBatchWriteResponseSchema = z.object({
  created: z.array(v1SouvenirDtoSchema),
  skipped: z.array(v1BatchSkippedItemSchema),
  _meta: v1WriteMetaSchema,
});

// ---------------------------------------------------------------------------
// Delete response schema — shared by candidate and souvenir delete endpoints
// ---------------------------------------------------------------------------

// Idempotent delete: always returns 200. deleted:true when the item was found
// and removed; deleted:false when the item was already gone, belongs to another
// trip, or (for souvenirs) is owned by a different user. remaining carries the
// same cap context as the create response for the same resource type, computed
// after the operation.
export const v1DeleteResponseSchema = z.object({
  id: z.string(),
  deleted: z.boolean(),
  remaining: v1WriteMetaSchema,
});

// ---------------------------------------------------------------------------
// Pattern write response schemas
// ---------------------------------------------------------------------------

// Pattern DTO: tripDayId is never exposed — v1 identifies a pattern by
// tripId + patternId alone (day scoping is an internal detail).
export const v1PatternWriteResponseSchema = z.object({
  id: z.string(),
  label: z.string(),
  isDefault: z.boolean(),
  sortOrder: z.number().int(),
  createdAt: z.string(),
});

// Pattern delete has no cap-context to report (patterns are capped per-day, not
// per-trip), so unlike v1DeleteResponseSchema this has no `remaining` field.
export const v1PatternDeleteResponseSchema = z.object({
  id: z.string(),
  deleted: z.boolean(),
});
