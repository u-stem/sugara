import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ApiClient } from "./client.js";

// Exported raw shapes for testing (input schema validation can be checked against these)
// Note: z.string().uuid() validates strict UUID v4 format, which is stricter than the
// v1 API's guid() validator (which also accepts v1-v5). All IDs are v4-generated in
// practice, so this extra strictness causes no real-world rejections.

// Currency codes supported by the v1 API (mirrored from @sugara/shared currency.ts).
const currencyEnum = z.enum([
  "JPY",
  "USD",
  "EUR",
  "GBP",
  "AUD",
  "CAD",
  "CHF",
  "CNY",
  "KRW",
  "THB",
  "SGD",
  "HKD",
]);

// Shared sub-schemas for expense splits/line-items (memberNo-based, not userId-based).
const splitItemShape = z.object({
  memberNo: z.number().int().positive(),
  // amount is required for custom/itemized splitType; optional for equal
  amount: z.number().int().min(0).optional(),
});

const lineItemShape = z.object({
  name: z.string().min(1).max(200),
  amount: z.number().int().min(1),
  // which members share this line item — at least one
  memberNos: z.array(z.number().int().positive()).min(1),
});

export const INPUT_SHAPES = {
  // --- Read tools (7) ---
  list_trips: {
    scope: z.enum(["owned", "shared"]).optional(),
    limit: z.number().int().min(1).max(100).optional(),
    offset: z.number().int().min(0).optional(),
  },
  get_trip: {
    id: z.string().uuid(),
  },
  list_trip_expenses: {
    tripId: z.string().uuid(),
    limit: z.number().int().min(1).max(100).optional(),
    offset: z.number().int().min(0).optional(),
  },
  list_bookmark_lists: {
    limit: z.number().int().min(1).max(100).optional(),
    offset: z.number().int().min(0).optional(),
  },
  list_bookmarks: {
    listId: z.string().uuid(),
    limit: z.number().int().min(1).max(100).optional(),
    offset: z.number().int().min(0).optional(),
  },
  list_articles: {
    limit: z.number().int().min(1).max(100).optional(),
    offset: z.number().int().min(0).optional(),
  },
  get_article: {
    id: z.string().uuid(),
  },

  // --- Write tools (12) ---

  // POST /trips — caller becomes the owner member.
  create_trip: {
    title: z.string().min(1).max(100),
    destination: z.string().max(100).optional(),
    // YYYY-MM-DD; endDate must be >= startDate (validated by API)
    startDate: z.string().date(),
    endDate: z.string().date(),
    currency: currencyEnum.optional(),
  },

  // PATCH /trips/:id — requires editor or owner role on the trip.
  update_trip: {
    id: z.string().uuid(),
    title: z.string().min(1).max(100).optional(),
    destination: z.string().max(100).nullable().optional(),
    status: z.enum(["scheduling", "draft", "planned", "active", "completed"]).optional(),
    startDate: z.string().date().optional(),
    endDate: z.string().date().optional(),
    currency: currencyEnum.optional(),
  },

  // POST /trips/:tripId/days/:dayNumber/schedules — appends to the default day pattern.
  create_schedule: {
    tripId: z.string().uuid(),
    // 1-indexed day number within the trip; check get_trip for the total day count
    dayNumber: z.number().int().min(1),
    name: z.string().min(1).max(200),
    category: z.enum(["sightseeing", "restaurant", "hotel", "transport", "activity", "other"]),
    address: z.string().max(500).optional(),
    // HH:MM or HH:MM:SS format
    startTime: z.string().optional(),
    endTime: z.string().optional(),
    memo: z.string().max(2000).optional(),
    // http/https URLs only; max 5 entries
    urls: z.array(z.string()).max(5).optional(),
    departurePlace: z.string().max(200).optional(),
    arrivalPlace: z.string().max(200).optional(),
    transportMethod: z
      .enum([
        "train",
        "shinkansen",
        "bus",
        "taxi",
        "walk",
        "car",
        "airplane",
        "bicycle",
        "ropeway",
        "cable_car",
        "ferry",
      ])
      .optional(),
    cost: z.number().int().nonnegative().max(99999999).optional(),
    color: z
      .enum(["blue", "red", "green", "yellow", "purple", "pink", "orange", "gray"])
      .optional(),
    // how many extra days the schedule spans (1 = next day)
    endDayOffset: z.number().int().min(1).max(30).optional(),
  },

  // PATCH /trips/:tripId/schedules/:scheduleId — partial update.
  update_schedule: {
    tripId: z.string().uuid(),
    scheduleId: z.string().uuid(),
    name: z.string().min(1).max(200).optional(),
    category: z
      .enum(["sightseeing", "restaurant", "hotel", "transport", "activity", "other"])
      .optional(),
    address: z.string().max(500).optional(),
    startTime: z.string().optional(),
    endTime: z.string().optional(),
    memo: z.string().max(2000).optional(),
    urls: z.array(z.string()).max(5).optional(),
    departurePlace: z.string().max(200).optional(),
    arrivalPlace: z.string().max(200).optional(),
    transportMethod: z
      .enum([
        "train",
        "shinkansen",
        "bus",
        "taxi",
        "walk",
        "car",
        "airplane",
        "bicycle",
        "ropeway",
        "cable_car",
        "ferry",
      ])
      .optional(),
    cost: z.number().int().nonnegative().max(99999999).optional(),
    color: z
      .enum(["blue", "red", "green", "yellow", "purple", "pink", "orange", "gray"])
      .optional(),
    endDayOffset: z.number().int().min(1).max(30).optional(),
  },

  // POST /trips/:tripId/expenses — paidBy and splits use memberNo (not userId).
  create_expense: {
    tripId: z.string().uuid(),
    title: z.string().min(1).max(200),
    // positive number; minor-unit for non-JPY currencies (e.g. 100 = $1.00)
    amount: z.number().positive(),
    // obtain memberNo from get_trip members list before calling this tool
    paidByMemberNo: z.number().int().positive(),
    splitType: z.enum(["equal", "custom", "itemized"]),
    category: z
      .enum([
        "transportation",
        "accommodation",
        "meals",
        "communication",
        "supplies",
        "entertainment",
        "conference",
        "other",
      ])
      .optional(),
    currency: currencyEnum.optional(),
    // required when currency differs from the trip currency
    exchangeRate: z.number().positive().max(999999).optional(),
    // at least one split entry is required; amount required for custom/itemized
    splits: z.array(splitItemShape).min(1),
    // required when splitType is "itemized"; max 50 entries
    lineItems: z.array(lineItemShape).max(50).optional(),
  },

  // PATCH /trips/:tripId/expenses/:expenseId — partial update; splitType and splits must travel together.
  update_expense: {
    tripId: z.string().uuid(),
    expenseId: z.string().uuid(),
    title: z.string().min(1).max(200).optional(),
    amount: z.number().positive().optional(),
    paidByMemberNo: z.number().int().positive().optional(),
    splitType: z.enum(["equal", "custom", "itemized"]).optional(),
    category: z
      .enum([
        "transportation",
        "accommodation",
        "meals",
        "communication",
        "supplies",
        "entertainment",
        "conference",
        "other",
      ])
      .nullable()
      .optional(),
    currency: currencyEnum.optional(),
    exchangeRate: z.number().positive().max(999999).optional(),
    // if provided, splitType must also be provided (API enforces both-or-neither)
    splits: z.array(splitItemShape).min(1).optional(),
    lineItems: z.array(lineItemShape).max(50).optional(),
  },

  // POST /bookmark-lists
  create_bookmark_list: {
    name: z.string().min(1).max(50),
    visibility: z.enum(["private", "friends_only", "public"]).optional(),
  },

  // PATCH /bookmark-lists/:listId — caller must own the list.
  update_bookmark_list: {
    listId: z.string().uuid(),
    name: z.string().min(1).max(50).optional(),
    visibility: z.enum(["private", "friends_only", "public"]).optional(),
  },

  // POST /bookmark-lists/:listId/bookmarks
  create_bookmark: {
    listId: z.string().uuid(),
    name: z.string().min(1).max(200),
    memo: z.string().max(2000).optional(),
    // http/https URLs; max 5 entries; no duplicate URLs allowed (API enforces)
    urls: z.array(z.string()).max(5).optional(),
  },

  // PATCH /bookmark-lists/:listId/bookmarks/:bookmarkId
  update_bookmark: {
    listId: z.string().uuid(),
    bookmarkId: z.string().uuid(),
    name: z.string().min(1).max(200).optional(),
    memo: z.string().max(2000).optional(),
    urls: z.array(z.string()).max(5).optional(),
  },

  // POST /articles
  create_article: {
    title: z.string().min(1).max(100),
    content: z.string().max(20000).optional(),
    // each tag: min 1, max 20 chars; max 5 unique tags
    tags: z.array(z.string().min(1).max(20)).max(5).optional(),
    visibility: z.enum(["private", "friends_only", "public"]).optional(),
  },

  // PATCH /articles/:id — caller must own the article.
  update_article: {
    id: z.string().uuid(),
    title: z.string().min(1).max(100).optional(),
    content: z.string().max(20000).optional(),
    tags: z.array(z.string().min(1).max(20)).max(5).optional(),
    visibility: z.enum(["private", "friends_only", "public"]).optional(),
  },
} as const;

function toolError(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true as const,
  };
}

function toolResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

// Annotation sets reused across multiple registrations.
const READ_ANNOTATIONS = { readOnlyHint: true } as const;
// create: not idempotent (each call creates a new resource), not destructive
const CREATE_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const;
// update: idempotent (same patch applied twice yields the same state), potentially destructive
const UPDATE_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false,
} as const;

/**
 * Registers all 19 sugara v1 tools with the MCP server.
 * Each tool maps 1:1 to a v1 endpoint and returns the raw JSON response.
 * On client errors, returns an isError result with a human-readable message.
 *
 * Write tools require the API key to carry the corresponding write scope
 * (trips:write, expenses:write, bookmarks:write, articles:write).
 * Writing to a shared trip additionally requires the caller to hold the
 * editor or owner role on that trip — verify with get_trip beforehand.
 * Delete operations are not exposed; there are no delete tools.
 */
export function registerTools(server: McpServer, client: ApiClient): void {
  // ---------------------------------------------------------------------------
  // Read tools (7)
  // ---------------------------------------------------------------------------

  server.registerTool(
    "list_trips",
    {
      description:
        "List trips the API key owner is a member of. " +
        "Scope 'owned' returns trips where the owner role is held; " +
        "'shared' returns trips shared by others. " +
        "Supports limit/offset pagination.",
      inputSchema: INPUT_SHAPES.list_trips,
      annotations: READ_ANNOTATIONS,
    },
    async (args) => {
      try {
        const result = await client.listTrips(args);
        return toolResult(result);
      } catch (err) {
        return toolError(err instanceof Error ? err.message : "Unexpected error");
      }
    },
  );

  server.registerTool(
    "get_trip",
    {
      description:
        "Get full details of a trip by its UUID. " +
        "Returns members with memberNo (a sequential number within the trip, not a database ID) " +
        "and days with scheduled spots. " +
        "Call this first to obtain memberNo values before creating expenses.",
      inputSchema: INPUT_SHAPES.get_trip,
      annotations: READ_ANNOTATIONS,
    },
    async (args) => {
      try {
        const result = await client.getTrip(args.id);
        return toolResult(result);
      } catch (err) {
        return toolError(err instanceof Error ? err.message : "Unexpected error");
      }
    },
  );

  server.registerTool(
    "list_trip_expenses",
    {
      description:
        "List expenses for a trip. " +
        "paidBy and splits reference members by memberNo " +
        "(a sequential number within the trip, consistent with get_trip member list). " +
        "Supports limit/offset pagination.",
      inputSchema: INPUT_SHAPES.list_trip_expenses,
      annotations: READ_ANNOTATIONS,
    },
    async (args) => {
      try {
        const result = await client.listTripExpenses(args.tripId, {
          limit: args.limit,
          offset: args.offset,
        });
        return toolResult(result);
      } catch (err) {
        return toolError(err instanceof Error ? err.message : "Unexpected error");
      }
    },
  );

  server.registerTool(
    "list_bookmark_lists",
    {
      description:
        "List the bookmark lists owned by the API key holder. " +
        "Each list includes a bookmarkCount. " +
        "Supports limit/offset pagination.",
      inputSchema: INPUT_SHAPES.list_bookmark_lists,
      annotations: READ_ANNOTATIONS,
    },
    async (args) => {
      try {
        const result = await client.listBookmarkLists(args);
        return toolResult(result);
      } catch (err) {
        return toolError(err instanceof Error ? err.message : "Unexpected error");
      }
    },
  );

  server.registerTool(
    "list_bookmarks",
    {
      description:
        "List bookmarks inside a specific bookmark list. " +
        "Only lists owned by the API key holder are accessible. " +
        "Supports limit/offset pagination.",
      inputSchema: INPUT_SHAPES.list_bookmarks,
      annotations: READ_ANNOTATIONS,
    },
    async (args) => {
      try {
        const result = await client.listBookmarks(args.listId, {
          limit: args.limit,
          offset: args.offset,
        });
        return toolResult(result);
      } catch (err) {
        return toolError(err instanceof Error ? err.message : "Unexpected error");
      }
    },
  );

  server.registerTool(
    "list_articles",
    {
      description:
        "List articles owned by the API key holder (without content body). " +
        "Use get_article to fetch the full content of a specific article. " +
        "Supports limit/offset pagination.",
      inputSchema: INPUT_SHAPES.list_articles,
      annotations: READ_ANNOTATIONS,
    },
    async (args) => {
      try {
        const result = await client.listArticles(args);
        return toolResult(result);
      } catch (err) {
        return toolError(err instanceof Error ? err.message : "Unexpected error");
      }
    },
  );

  server.registerTool(
    "get_article",
    {
      description:
        "Get the full content of an article by its UUID. " +
        "Only articles owned by the API key holder are accessible.",
      inputSchema: INPUT_SHAPES.get_article,
      annotations: READ_ANNOTATIONS,
    },
    async (args) => {
      try {
        const result = await client.getArticle(args.id);
        return toolResult(result);
      } catch (err) {
        return toolError(err instanceof Error ? err.message : "Unexpected error");
      }
    },
  );

  // ---------------------------------------------------------------------------
  // Write tools (12)
  // ---------------------------------------------------------------------------

  server.registerTool(
    "create_trip",
    {
      description:
        "Create a new trip. The caller becomes the owner member. " +
        "Returns 409 when the account has reached its trip limit. " +
        "Requires trips:write scope.",
      inputSchema: INPUT_SHAPES.create_trip,
      annotations: CREATE_ANNOTATIONS,
    },
    async (args) => {
      try {
        const result = await client.createTrip(args);
        return toolResult(result);
      } catch (err) {
        return toolError(err instanceof Error ? err.message : "Unexpected error");
      }
    },
  );

  server.registerTool(
    "update_trip",
    {
      description:
        "Partially update a trip by its UUID. " +
        "Writing to a shared trip requires editor or owner role — verify with get_trip first. " +
        "Returns 409 when a currency change is blocked by existing expenses, " +
        "or when reducing days would delete schedules. " +
        "Requires trips:write scope.",
      inputSchema: INPUT_SHAPES.update_trip,
      annotations: UPDATE_ANNOTATIONS,
    },
    async (args) => {
      const { id, ...body } = args;
      try {
        const result = await client.updateTrip(id, body);
        return toolResult(result);
      } catch (err) {
        return toolError(err instanceof Error ? err.message : "Unexpected error");
      }
    },
  );

  server.registerTool(
    "create_schedule",
    {
      description:
        "Add a schedule to a specific day of a trip. " +
        "dayNumber is 1-indexed (day 1 = first day of the trip). " +
        "Use get_trip to find the total number of days before calling this tool. " +
        "Writing to a shared trip requires editor or owner role. " +
        "Returns 409 when the trip is in scheduling/poll mode (no days) " +
        "or when the per-trip schedule limit is reached. " +
        "Delete tools do not exist; schedules cannot be removed via MCP. " +
        "Requires trips:write scope.",
      inputSchema: INPUT_SHAPES.create_schedule,
      annotations: CREATE_ANNOTATIONS,
    },
    async (args) => {
      const { tripId, dayNumber, ...body } = args;
      try {
        const result = await client.createSchedule(tripId, dayNumber, body);
        return toolResult(result);
      } catch (err) {
        return toolError(err instanceof Error ? err.message : "Unexpected error");
      }
    },
  );

  server.registerTool(
    "update_schedule",
    {
      description:
        "Partially update a schedule within a trip. " +
        "Writing to a shared trip requires editor or owner role. " +
        "Anchor fields (crossDayAnchor, expectedUpdatedAt) are not accepted in v1. " +
        "Requires trips:write scope.",
      inputSchema: INPUT_SHAPES.update_schedule,
      annotations: UPDATE_ANNOTATIONS,
    },
    async (args) => {
      const { tripId, scheduleId, ...body } = args;
      try {
        const result = await client.updateSchedule(tripId, scheduleId, body);
        return toolResult(result);
      } catch (err) {
        return toolError(err instanceof Error ? err.message : "Unexpected error");
      }
    },
  );

  server.registerTool(
    "create_expense",
    {
      description:
        "Create an expense for a trip. " +
        "paidByMemberNo and splits[].memberNo reference members by memberNo — " +
        "call get_trip first to obtain the correct memberNo for each participant. " +
        "For custom/itemized splitType, splits[].amount must be provided and must sum to amount. " +
        "For itemized splitType, lineItems must also be provided. " +
        "Writing to a shared trip requires editor or owner role. " +
        "Returns 409 when the trip has no days yet or the expense limit is reached. " +
        "Requires expenses:write scope.",
      inputSchema: INPUT_SHAPES.create_expense,
      annotations: CREATE_ANNOTATIONS,
    },
    async (args) => {
      const { tripId, ...body } = args;
      try {
        const result = await client.createExpense(tripId, body);
        return toolResult(result);
      } catch (err) {
        return toolError(err instanceof Error ? err.message : "Unexpected error");
      }
    },
  );

  server.registerTool(
    "update_expense",
    {
      description:
        "Partially update an expense within a trip. " +
        "splitType and splits must always be provided together (neither can be omitted without the other). " +
        "memberNo values must be verified with get_trip before calling. " +
        "Writing to a shared trip requires editor or owner role. " +
        "Requires expenses:write scope.",
      inputSchema: INPUT_SHAPES.update_expense,
      annotations: UPDATE_ANNOTATIONS,
    },
    async (args) => {
      const { tripId, expenseId, ...body } = args;
      try {
        const result = await client.updateExpense(tripId, expenseId, body);
        return toolResult(result);
      } catch (err) {
        return toolError(err instanceof Error ? err.message : "Unexpected error");
      }
    },
  );

  server.registerTool(
    "create_bookmark_list",
    {
      description:
        "Create a new bookmark list owned by the API key holder. " +
        "Returns 409 when the per-user bookmark list limit is reached. " +
        "Requires bookmarks:write scope.",
      inputSchema: INPUT_SHAPES.create_bookmark_list,
      annotations: CREATE_ANNOTATIONS,
    },
    async (args) => {
      try {
        const result = await client.createBookmarkList(args);
        return toolResult(result);
      } catch (err) {
        return toolError(err instanceof Error ? err.message : "Unexpected error");
      }
    },
  );

  server.registerTool(
    "update_bookmark_list",
    {
      description:
        "Partially update a bookmark list owned by the API key holder. " +
        "Returns 404 for lists owned by other users (existence concealment). " +
        "Requires bookmarks:write scope.",
      inputSchema: INPUT_SHAPES.update_bookmark_list,
      annotations: UPDATE_ANNOTATIONS,
    },
    async (args) => {
      const { listId, ...body } = args;
      try {
        const result = await client.updateBookmarkList(listId, body);
        return toolResult(result);
      } catch (err) {
        return toolError(err instanceof Error ? err.message : "Unexpected error");
      }
    },
  );

  server.registerTool(
    "create_bookmark",
    {
      description:
        "Add a bookmark to a list owned by the API key holder. " +
        "Returns 409 when the per-list bookmark limit is reached. " +
        "URLs must be http/https; duplicates within the same bookmark are rejected by the API. " +
        "Requires bookmarks:write scope.",
      inputSchema: INPUT_SHAPES.create_bookmark,
      annotations: CREATE_ANNOTATIONS,
    },
    async (args) => {
      const { listId, ...body } = args;
      try {
        const result = await client.createBookmark(listId, body);
        return toolResult(result);
      } catch (err) {
        return toolError(err instanceof Error ? err.message : "Unexpected error");
      }
    },
  );

  server.registerTool(
    "update_bookmark",
    {
      description:
        "Partially update a bookmark within a list owned by the API key holder. " +
        "Returns 404 when the bookmark does not belong to the list. " +
        "Requires bookmarks:write scope.",
      inputSchema: INPUT_SHAPES.update_bookmark,
      annotations: UPDATE_ANNOTATIONS,
    },
    async (args) => {
      const { listId, bookmarkId, ...body } = args;
      try {
        const result = await client.updateBookmark(listId, bookmarkId, body);
        return toolResult(result);
      } catch (err) {
        return toolError(err instanceof Error ? err.message : "Unexpected error");
      }
    },
  );

  server.registerTool(
    "create_article",
    {
      description:
        "Create an article owned by the API key holder. " +
        "Returns 409 when the per-user article limit is reached. " +
        "Tags must be unique within the article; duplicates are rejected by the API. " +
        "Requires articles:write scope.",
      inputSchema: INPUT_SHAPES.create_article,
      annotations: CREATE_ANNOTATIONS,
    },
    async (args) => {
      try {
        const result = await client.createArticle(args);
        return toolResult(result);
      } catch (err) {
        return toolError(err instanceof Error ? err.message : "Unexpected error");
      }
    },
  );

  server.registerTool(
    "update_article",
    {
      description:
        "Partially update an article owned by the API key holder. " +
        "Returns 404 for articles owned by other users (existence concealment). " +
        "Requires articles:write scope.",
      inputSchema: INPUT_SHAPES.update_article,
      annotations: UPDATE_ANNOTATIONS,
    },
    async (args) => {
      const { id, ...body } = args;
      try {
        const result = await client.updateArticle(id, body);
        return toolResult(result);
      } catch (err) {
        return toolError(err instanceof Error ? err.message : "Unexpected error");
      }
    },
  );
}
