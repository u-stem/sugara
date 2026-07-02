import { z } from "zod";

// Response schemas for the v1 external API.
// Each schema mirrors the exact shape returned by its corresponding handler in
// index.ts and the assertions in v1-routes.test.ts. Kept in a separate file so
// that the route file stays focused on business logic.

// ---------------------------------------------------------------------------
// Shared — pagination and error
// ---------------------------------------------------------------------------

export const paginationSchema = z.object({
  limit: z.number().int(),
  offset: z.number().int(),
  total: z.number().int(),
});

// All v1 error responses share this shape: { error: { code, message } }.
// `reason` (fine-grained machine-readable code, e.g. "trip_limit_reached") and
// `details` (structured data such as { max }) are additive and optional so the
// frozen top-level `code` set stays backward compatible.
export const errorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    reason: z.string().optional(),
    details: z.unknown().optional(),
  }),
});

// ---------------------------------------------------------------------------
// Trip list — GET /trips
// ---------------------------------------------------------------------------

const tripSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  currency: z.string(),
  role: z.enum(["owner", "editor", "viewer"]),
  memberCount: z.number().int(),
  updatedAt: z.string(), // ISO 8601 datetime
});

export const tripListResponseSchema = z.object({
  data: z.array(tripSummarySchema),
  pagination: paginationSchema,
});

// ---------------------------------------------------------------------------
// Trip detail — GET /trips/{id}
// ---------------------------------------------------------------------------

// memberNo is absent in the rare defensive-fallback case (removed member).
const tripMemberSchema = z.object({
  memberNo: z.number().int().optional(),
  displayName: z.string(),
  role: z.enum(["owner", "editor", "viewer"]),
});

const scheduleItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  // DB: scheduleCategoryEnum("category").notNull() — always one of these six values.
  category: z.enum(["sightseeing", "restaurant", "hotel", "transport", "activity", "other"]),
  startTime: z.string().nullable(),
  endTime: z.string().nullable(),
  address: z.string().nullable(),
  memo: z.string().nullable(),
});

// A day can have up to MAX_PATTERNS_PER_DAY (3) alternative schedule variants
// (e.g. "sunny plan" / "rainy plan"); each pattern carries its own schedules[].
const tripDayPatternSchema = z.object({
  id: z.string(),
  label: z.string(),
  isDefault: z.boolean(),
  schedules: z.array(scheduleItemSchema),
});

const tripDaySchema = z.object({
  dayNumber: z.number().int(),
  // DB: date("date").notNull() — never null.
  date: z.string(),
  patterns: z.array(tripDayPatternSchema),
});

export const tripDetailResponseSchema = z.object({
  id: z.string(),
  title: z.string(),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  currency: z.string(),
  role: z.enum(["owner", "editor", "viewer"]),
  members: z.array(tripMemberSchema),
  days: z.array(tripDaySchema),
});

// ---------------------------------------------------------------------------
// Expenses — GET /trips/{tripId}/expenses
// ---------------------------------------------------------------------------

// memberNo is absent in the rare defensive-fallback case (removed member).
const expenseMemberRefSchema = z.object({
  memberNo: z.number().int().optional(),
  displayName: z.string(),
});

const expenseSplitSchema = expenseMemberRefSchema.extend({
  // DB: integer("amount").notNull()
  amount: z.number().int(),
});

const expenseItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  // DB: integer("amount").notNull()
  amount: z.number().int(),
  currency: z.string(),
  category: z.string().nullable(),
  date: z.string(), // ISO 8601 datetime (createdAt)
  paidBy: expenseMemberRefSchema,
  splits: z.array(expenseSplitSchema),
});

export const expenseListResponseSchema = z.object({
  data: z.array(expenseItemSchema),
  pagination: paginationSchema,
});

// ---------------------------------------------------------------------------
// Bookmark lists — GET /bookmark-lists
// ---------------------------------------------------------------------------

const bookmarkListSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  // DB: bookmarkListVisibilityEnum — "private" | "friends_only" | "public"
  visibility: z.enum(["private", "friends_only", "public"]),
  sortOrder: z.number().int(),
  bookmarkCount: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const bookmarkListsResponseSchema = z.object({
  data: z.array(bookmarkListSummarySchema),
  pagination: paginationSchema,
});

// ---------------------------------------------------------------------------
// Bookmarks in a list — GET /bookmark-lists/{listId}/bookmarks
// ---------------------------------------------------------------------------

const bookmarkItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  memo: z.string().nullable(),
  urls: z.array(z.string()),
  sortOrder: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const bookmarksResponseSchema = z.object({
  data: z.array(bookmarkItemSchema),
  pagination: paginationSchema,
});

// ---------------------------------------------------------------------------
// Articles list — GET /articles
// ---------------------------------------------------------------------------

const articleSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  tags: z.array(z.string()),
  // DB: articleVisibilityEnum — "private" | "friends_only" | "public"
  visibility: z.enum(["private", "friends_only", "public"]),
  tripIds: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const articleListResponseSchema = z.object({
  data: z.array(articleSummarySchema),
  pagination: paginationSchema,
});

// ---------------------------------------------------------------------------
// Candidates — GET /trips/{tripId}/candidates
//
// A candidate is a schedule row with dayPatternId = NULL (an unassigned spot in
// the trip's planning pool). The shape mirrors serializeScheduleDto.
// ---------------------------------------------------------------------------

const candidateItemSchema = z.object({
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

export const candidateListResponseSchema = z.object({
  data: z.array(candidateItemSchema),
  pagination: paginationSchema,
});

// ---------------------------------------------------------------------------
// Souvenirs — GET /trips/{tripId}/souvenirs
//
// Returns the caller's own items plus other members' shared items. The owner is
// expressed as a memberNo-based ref (no internal userId). memberNo is absent when
// the owner is no longer a trip member; displayName is always present.
// ---------------------------------------------------------------------------

const souvenirOwnerSchema = z.object({
  memberNo: z.number().int().optional(),
  displayName: z.string(),
});

const souvenirItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  recipient: z.string().nullable(),
  urls: z.array(z.string()),
  addresses: z.array(z.string()),
  memo: z.string().nullable(),
  // DB: souvenirPriorityEnum — "high" | "medium" | null
  priority: z.enum(["high", "medium"]).nullable(),
  isPurchased: z.boolean(),
  isShared: z.boolean(),
  // DB: souvenirShareStyleEnum — "recommend" | "errand" | null
  shareStyle: z.enum(["recommend", "errand"]).nullable(),
  owner: souvenirOwnerSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const souvenirListResponseSchema = z.object({
  data: z.array(souvenirItemSchema),
  pagination: paginationSchema,
});

// ---------------------------------------------------------------------------
// Article detail — GET /articles/{id}
// ---------------------------------------------------------------------------

export const articleDetailResponseSchema = z.object({
  id: z.string(),
  title: z.string(),
  content: z.string(),
  tags: z.array(z.string()),
  // DB: articleVisibilityEnum — "private" | "friends_only" | "public"
  visibility: z.enum(["private", "friends_only", "public"]),
  tripIds: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
});
