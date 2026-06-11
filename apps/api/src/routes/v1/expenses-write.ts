// v1 write routes for expenses.
//
// File layout:
//   POST   /trips/:tripId/expenses
//   PATCH  /trips/:tripId/expenses/:expenseId
//
// Expense member references use memberNo (stable 1-indexed identifiers) rather
// than internal userId UUIDs. The conversion runs in both directions:
//   request body  memberNo → userId  (before calling the service)
//   response body userId  → memberNo (when serializing the result)

import { count, eq } from "drizzle-orm";
import { Hono } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import { db } from "../../db";
import { expenses, tripDays, tripMembers, users } from "../../db/schema";
import { createExpenseCore, updateExpenseCore } from "../../lib/expense-service";
import { ApiV1Error, getApiKey, type V1Env } from "../../lib/external-api/errors";
import { buildMemberNoMap, resolveMemberNoToUserId } from "../../lib/external-api/member-no";
import { requireApiKey } from "../../middleware/require-api-key";
import { errorResponseSchema } from "./openapi-schemas";
import { uuidSchema, withTripAccess } from "./shared";
import {
  v1CreateExpenseSchema,
  v1ExpenseWriteResponseSchema,
  v1UpdateExpenseSchema,
} from "./write-schemas";

export const expensesWriteApp = new Hono<V1Env>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Mirror of the local resolveMemberRef in index.ts — kept private to this file.
type MemberRef = { memberNo: number; displayName: string } | { displayName: string };

function resolveMemberRef(
  memberNoMap: Map<string, number>,
  nameMap: Map<string, string>,
  userId: string,
): MemberRef {
  const memberNo = memberNoMap.get(userId);
  const displayName = nameMap.get(userId) ?? "Unknown";
  if (memberNo !== undefined) {
    return { memberNo, displayName };
  }
  // Defensive fallback: member was removed outside the normal flow
  return { displayName };
}

// Fetch the expense with paidByUser name and splits for response serialization.
async function fetchExpenseForResponse(expenseId: string) {
  return db.query.expenses.findFirst({
    where: eq(expenses.id, expenseId),
    with: {
      paidByUser: { columns: { name: true } },
      splits: { columns: { userId: true, amount: true } },
    },
  });
}

// ---------------------------------------------------------------------------
// POST /trips/:tripId/expenses
// ---------------------------------------------------------------------------

expensesWriteApp.post(
  "/trips/:tripId/expenses",
  describeRoute({
    tags: ["Expenses"],
    summary: "Create an expense",
    description:
      "Creates an expense for a trip. Splits and paidBy use memberNo for member identity. Returns 409 when the trip has no days yet (scheduling mode) or when the per-trip expense limit is reached. Requires `expenses:write` scope.",
    security: [{ bearerAuth: [] }],
    parameters: [
      {
        name: "tripId",
        in: "path",
        required: true,
        description: "Trip UUID.",
        schema: { type: "string", format: "uuid" },
      },
    ],
    requestBody: {
      required: true,
      content: {
        "application/json": {
          schema: { type: "object" },
        },
      },
    },
    responses: {
      201: {
        description: "Expense created",
        content: { "application/json": { schema: resolver(v1ExpenseWriteResponseSchema) } },
      },
      400: {
        description: "Invalid request body or unknown memberNo",
        content: { "application/json": { schema: resolver(errorResponseSchema) } },
      },
      401: {
        description: "Missing or invalid API key",
        content: { "application/json": { schema: resolver(errorResponseSchema) } },
      },
      403: {
        description: "Insufficient scope",
        content: { "application/json": { schema: resolver(errorResponseSchema) } },
      },
      404: {
        description: "Trip not found or access denied",
        content: { "application/json": { schema: resolver(errorResponseSchema) } },
      },
      409: {
        description: "Trip in scheduling mode or expense limit reached",
        content: { "application/json": { schema: resolver(errorResponseSchema) } },
      },
    },
  }),
  requireApiKey("expenses:write"),
  withTripAccess(
    "tripId",
    async (c, tripId) => {
      const key = getApiKey(c);

      // Check that the trip has days (not in scheduling/poll mode).
      const [{ dayCount }] = await db
        .select({ dayCount: count() })
        .from(tripDays)
        .where(eq(tripDays.tripId, tripId));
      if (dayCount === 0) {
        throw new ApiV1Error(
          409,
          "conflict",
          "Trip has no days; finalize the trip dates before adding expenses",
        );
      }

      const body = await c.req.json();
      const parsed = v1CreateExpenseSchema.safeParse(body);
      if (!parsed.success) {
        throw new ApiV1Error(400, "invalid_request", "Invalid request body");
      }

      // Build the memberNo map from current trip members.
      const memberRows = await db.query.tripMembers.findMany({
        where: eq(tripMembers.tripId, tripId),
        columns: { userId: true },
        with: { user: { columns: { name: true } } },
      });
      const memberNoMap = buildMemberNoMap(memberRows);

      // Resolve paidByMemberNo → paidByUserId.
      const paidByUserId = resolveMemberNoToUserId(memberNoMap, parsed.data.paidByMemberNo);
      if (!paidByUserId) {
        throw new ApiV1Error(400, "invalid_request", "Unknown paidByMemberNo");
      }

      // Resolve splits[].memberNo → splits[].userId.
      const resolvedSplits: { userId: string; amount?: number }[] = [];
      for (const s of parsed.data.splits) {
        const uid = resolveMemberNoToUserId(memberNoMap, s.memberNo);
        if (!uid) {
          throw new ApiV1Error(400, "invalid_request", `Unknown memberNo ${s.memberNo} in splits`);
        }
        resolvedSplits.push({ userId: uid, amount: s.amount });
      }

      // Resolve lineItems[].memberNos → lineItems[].memberIds.
      type LineItemInput = { name: string; amount: number; memberIds: string[] };
      const resolvedLineItems: LineItemInput[] | undefined = parsed.data.lineItems ? [] : undefined;
      if (resolvedLineItems !== undefined && parsed.data.lineItems) {
        for (const item of parsed.data.lineItems) {
          const memberIds: string[] = [];
          for (const mno of item.memberNos) {
            const uid = resolveMemberNoToUserId(memberNoMap, mno);
            if (!uid) {
              throw new ApiV1Error(400, "invalid_request", `Unknown memberNo ${mno} in lineItems`);
            }
            memberIds.push(uid);
          }
          resolvedLineItems.push({ name: item.name, amount: item.amount, memberIds });
        }
      }

      // Fetch actor name for createExpenseCore notifications.
      const actorRow = await db.query.users.findFirst({
        where: eq(users.id, key.userId),
        columns: { name: true },
      });
      const actorName = actorRow?.name ?? "Unknown";

      const result = await createExpenseCore(tripId, key.userId, actorName, {
        title: parsed.data.title,
        amount: parsed.data.amount,
        paidByUserId,
        splitType: parsed.data.splitType,
        category: parsed.data.category,
        currency: parsed.data.currency,
        exchangeRate: parsed.data.exchangeRate,
        splits: resolvedSplits,
        lineItems: resolvedLineItems,
      });

      if (!result.ok) {
        switch (result.error) {
          case "exchange_rate_required":
            throw new ApiV1Error(
              400,
              "invalid_request",
              "exchangeRate is required when expense currency differs from trip currency",
            );
          case "limit_reached":
            throw new ApiV1Error(409, "conflict", "Per-trip expense limit reached");
          case "payer_not_member":
            throw new ApiV1Error(400, "invalid_request", "paidByMemberNo is not a trip member");
          case "split_user_not_member":
            throw new ApiV1Error(400, "invalid_request", "A splits memberNo is not a trip member");
        }
      }

      // Re-fetch with relations for the response DTO.
      const expenseWithRelations = await fetchExpenseForResponse(result.expense.id);
      if (!expenseWithRelations) {
        throw new ApiV1Error(500, "internal_error", "Expense not found after creation");
      }

      const nameMap = new Map(memberRows.map((m) => [m.userId, m.user?.name ?? "Unknown"]));

      return c.json(
        {
          id: expenseWithRelations.id,
          title: expenseWithRelations.title,
          amount: expenseWithRelations.amount,
          currency: expenseWithRelations.currency,
          category: expenseWithRelations.category ?? null,
          date: expenseWithRelations.createdAt.toISOString(),
          paidBy: resolveMemberRef(memberNoMap, nameMap, expenseWithRelations.paidByUserId),
          splits: expenseWithRelations.splits.map((s) => ({
            ...resolveMemberRef(memberNoMap, nameMap, s.userId),
            amount: s.amount,
          })),
        },
        201,
      );
    },
    { minRole: "editor" },
  ),
);

// ---------------------------------------------------------------------------
// PATCH /trips/:tripId/expenses/:expenseId
// ---------------------------------------------------------------------------

expensesWriteApp.patch(
  "/trips/:tripId/expenses/:expenseId",
  describeRoute({
    tags: ["Expenses"],
    summary: "Update an expense",
    description:
      "Partially updates an expense. splitType and splits must be provided together. Returns 404 when the expense does not belong to the trip. Requires `expenses:write` scope.",
    security: [{ bearerAuth: [] }],
    parameters: [
      {
        name: "tripId",
        in: "path",
        required: true,
        description: "Trip UUID.",
        schema: { type: "string", format: "uuid" },
      },
      {
        name: "expenseId",
        in: "path",
        required: true,
        description: "Expense UUID.",
        schema: { type: "string", format: "uuid" },
      },
    ],
    requestBody: {
      required: true,
      content: {
        "application/json": {
          schema: { type: "object" },
        },
      },
    },
    responses: {
      200: {
        description: "Expense updated",
        content: { "application/json": { schema: resolver(v1ExpenseWriteResponseSchema) } },
      },
      400: {
        description: "Invalid request body or unknown memberNo",
        content: { "application/json": { schema: resolver(errorResponseSchema) } },
      },
      401: {
        description: "Missing or invalid API key",
        content: { "application/json": { schema: resolver(errorResponseSchema) } },
      },
      403: {
        description: "Insufficient scope",
        content: { "application/json": { schema: resolver(errorResponseSchema) } },
      },
      404: {
        description: "Trip not found, access denied, or expense not in this trip",
        content: { "application/json": { schema: resolver(errorResponseSchema) } },
      },
    },
  }),
  requireApiKey("expenses:write"),
  withTripAccess(
    "tripId",
    async (c, tripId) => {
      const key = getApiKey(c);

      const rawExpenseId = c.req.param("expenseId");
      if (rawExpenseId === undefined) {
        throw new ApiV1Error(400, "invalid_request", "Missing expenseId");
      }
      const parsedExpId = uuidSchema.safeParse(rawExpenseId);
      if (!parsedExpId.success) {
        throw new ApiV1Error(400, "invalid_request", "Invalid expense id");
      }
      const expenseId = parsedExpId.data;

      const body = await c.req.json();
      const parsed = v1UpdateExpenseSchema.safeParse(body);
      if (!parsed.success) {
        throw new ApiV1Error(400, "invalid_request", "Invalid request body");
      }

      // Build memberNoMap — needed only when memberNo fields are present, but building
      // it unconditionally avoids a conditional fetch that complicates the type flow.
      const memberRows = await db.query.tripMembers.findMany({
        where: eq(tripMembers.tripId, tripId),
        columns: { userId: true },
        with: { user: { columns: { name: true } } },
      });
      const memberNoMap = buildMemberNoMap(memberRows);

      // Resolve paidByMemberNo → paidByUserId when present.
      let paidByUserId: string | undefined;
      if (parsed.data.paidByMemberNo !== undefined) {
        const uid = resolveMemberNoToUserId(memberNoMap, parsed.data.paidByMemberNo);
        if (!uid) {
          throw new ApiV1Error(400, "invalid_request", "Unknown paidByMemberNo");
        }
        paidByUserId = uid;
      }

      // Resolve splits[].memberNo → userId when present.
      let resolvedSplits: { userId: string; amount?: number }[] | undefined;
      if (parsed.data.splits) {
        resolvedSplits = [];
        for (const s of parsed.data.splits) {
          const uid = resolveMemberNoToUserId(memberNoMap, s.memberNo);
          if (!uid) {
            throw new ApiV1Error(
              400,
              "invalid_request",
              `Unknown memberNo ${s.memberNo} in splits`,
            );
          }
          resolvedSplits.push({ userId: uid, amount: s.amount });
        }
      }

      // Resolve lineItems[].memberNos → memberIds when present.
      type LineItemInput = { name: string; amount: number; memberIds: string[] };
      let resolvedLineItems: LineItemInput[] | undefined;
      if (parsed.data.lineItems) {
        resolvedLineItems = [];
        for (const item of parsed.data.lineItems) {
          const memberIds: string[] = [];
          for (const mno of item.memberNos) {
            const uid = resolveMemberNoToUserId(memberNoMap, mno);
            if (!uid) {
              throw new ApiV1Error(400, "invalid_request", `Unknown memberNo ${mno} in lineItems`);
            }
            memberIds.push(uid);
          }
          resolvedLineItems.push({ name: item.name, amount: item.amount, memberIds });
        }
      }

      const result = await updateExpenseCore(tripId, expenseId, key.userId, {
        title: parsed.data.title,
        amount: parsed.data.amount,
        paidByUserId,
        splitType: parsed.data.splitType,
        category: parsed.data.category,
        currency: parsed.data.currency,
        exchangeRate: parsed.data.exchangeRate,
        splits: resolvedSplits,
        lineItems: resolvedLineItems,
      });

      if (!result.ok) {
        switch (result.error) {
          case "not_found":
            throw new ApiV1Error(404, "not_found", "Expense not found in this trip");
          case "exchange_rate_required":
            throw new ApiV1Error(
              400,
              "invalid_request",
              "exchangeRate is required when expense currency differs from trip currency",
            );
          case "payer_not_member":
            throw new ApiV1Error(400, "invalid_request", "paidByMemberNo is not a trip member");
          case "split_user_not_member":
            throw new ApiV1Error(400, "invalid_request", "A splits memberNo is not a trip member");
          case "split_amount_mismatch":
            throw new ApiV1Error(
              400,
              "invalid_request",
              "Split amounts do not sum to the expense total",
            );
          case "itemized_no_line_items":
            throw new ApiV1Error(
              400,
              "invalid_request",
              "Itemized split requires at least one line item",
            );
        }
      }

      // Re-fetch with relations for the response DTO.
      const expenseWithRelations = await fetchExpenseForResponse(result.expense.id);
      if (!expenseWithRelations) {
        throw new ApiV1Error(500, "internal_error", "Expense not found after update");
      }

      const nameMap = new Map(memberRows.map((m) => [m.userId, m.user?.name ?? "Unknown"]));

      return c.json({
        id: expenseWithRelations.id,
        title: expenseWithRelations.title,
        amount: expenseWithRelations.amount,
        currency: expenseWithRelations.currency,
        category: expenseWithRelations.category ?? null,
        date: expenseWithRelations.createdAt.toISOString(),
        paidBy: resolveMemberRef(memberNoMap, nameMap, expenseWithRelations.paidByUserId),
        splits: expenseWithRelations.splits.map((s) => ({
          ...resolveMemberRef(memberNoMap, nameMap, s.userId),
          amount: s.amount,
        })),
      });
    },
    { minRole: "editor" },
  ),
);
