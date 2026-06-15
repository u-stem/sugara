// v1 write routes for trip souvenirs.
//
// File layout:
//   POST   /trips/:tripId/souvenirs
//   PATCH  /trips/:tripId/souvenirs/:itemId
//
// Souvenirs are per-member items within a trip: any trip member (including
// viewers) can create their own, and only the owner can update theirs. Unlike
// other v1 write routes, no editor role is required — this mirrors the internal
// souvenir routes, where each member manages their own list. The owner is
// serialized as a memberNo-based ref so no internal userId leaks.

import { MAX_SOUVENIRS_PER_USER_PER_TRIP } from "@sugara/shared";
import { and, count, eq } from "drizzle-orm";
import { Hono } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import { db } from "../../db";
import { souvenirItems, tripMembers } from "../../db/schema";
import { ApiV1Error, getApiKey, type V1Env } from "../../lib/external-api/errors";
import { buildMemberNoMap } from "../../lib/external-api/member-no";
import { requireApiKey } from "../../middleware/require-api-key";
import { errorResponseSchema } from "./openapi-schemas";
import { serializeSouvenirDto } from "./serializers";
import { getActorName, uuidSchema, withTripAccess } from "./shared";
import {
  v1CreateSouvenirSchema,
  v1SouvenirWriteResponseSchema,
  v1UpdateSouvenirSchema,
} from "./write-schemas";

export const souvenirsWriteApp = new Hono<V1Env>();

// Builds the trip's memberNo map. The caller is always a current member here, so
// its memberNo resolves; the map is the single source of truth for owner refs.
async function buildTripMemberNoMap(tripId: string): Promise<Map<string, number>> {
  const members = await db.query.tripMembers.findMany({
    where: eq(tripMembers.tripId, tripId),
    columns: { userId: true },
  });
  return buildMemberNoMap(members);
}

// ---------------------------------------------------------------------------
// POST /trips/:tripId/souvenirs
// ---------------------------------------------------------------------------

souvenirsWriteApp.post(
  "/trips/:tripId/souvenirs",
  describeRoute({
    tags: ["Souvenirs"],
    summary: "Create a souvenir",
    description:
      "Adds a souvenir item owned by the API key user to a trip. Any trip member (including viewers) may create their own items. shareStyle is cleared unless isShared is true. Returns 409 when the per-user per-trip souvenir limit is reached. Requires `souvenirs:write` scope.",
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
      content: { "application/json": { schema: { type: "object" } } },
    },
    responses: {
      201: {
        description: "Souvenir created",
        content: { "application/json": { schema: resolver(v1SouvenirWriteResponseSchema) } },
      },
      400: {
        description: "Invalid request body",
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
        description:
          'Per-user per-trip souvenir limit reached (error.reason: "souvenir_limit_reached", error.details.max)',
        content: { "application/json": { schema: resolver(errorResponseSchema) } },
      },
    },
  }),
  requireApiKey("souvenirs:write"),
  withTripAccess("tripId", async (c, tripId) => {
    const key = getApiKey(c);

    const body = await c.req.json();
    const parsed = v1CreateSouvenirSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiV1Error(400, "invalid_request", "Invalid request body");
    }

    // Per-user per-trip cap. Inherits the internal route's non-transactional
    // check: a benign race could let a concurrent pair exceed the cap by one.
    const [{ itemCount }] = await db
      .select({ itemCount: count() })
      .from(souvenirItems)
      .where(and(eq(souvenirItems.tripId, tripId), eq(souvenirItems.userId, key.userId)));
    if (itemCount >= MAX_SOUVENIRS_PER_USER_PER_TRIP) {
      throw new ApiV1Error(409, "conflict", "Per-user per-trip souvenir limit reached", {
        reason: "souvenir_limit_reached",
        details: { max: MAX_SOUVENIRS_PER_USER_PER_TRIP },
      });
    }

    const { name, recipient, urls, addresses, memo, priority, isShared, shareStyle } = parsed.data;
    const resolvedIsShared = isShared ?? false;
    const [inserted] = await db
      .insert(souvenirItems)
      .values({
        tripId,
        userId: key.userId,
        name,
        recipient,
        urls,
        addresses,
        memo,
        priority,
        isShared: resolvedIsShared,
        shareStyle: resolvedIsShared ? (shareStyle ?? null) : null,
      })
      .returning();

    const [memberNoMap, userName] = await Promise.all([
      buildTripMemberNoMap(tripId),
      getActorName(key.userId),
    ]);

    return c.json(
      {
        ...serializeSouvenirDto({ ...inserted, userName }, memberNoMap),
        _meta: { count: itemCount + 1, max: MAX_SOUVENIRS_PER_USER_PER_TRIP },
      },
      201,
    );
  }),
);

// ---------------------------------------------------------------------------
// PATCH /trips/:tripId/souvenirs/:itemId
// ---------------------------------------------------------------------------

souvenirsWriteApp.patch(
  "/trips/:tripId/souvenirs/:itemId",
  describeRoute({
    tags: ["Souvenirs"],
    summary: "Update a souvenir",
    description:
      "Partially updates a souvenir owned by the API key user. shareStyle is cleared when the item is not shared. Returns 404 when the item does not belong to the trip or is owned by another member. Requires `souvenirs:write` scope.",
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
        name: "itemId",
        in: "path",
        required: true,
        description: "Souvenir item UUID.",
        schema: { type: "string", format: "uuid" },
      },
    ],
    requestBody: {
      required: true,
      content: { "application/json": { schema: { type: "object" } } },
    },
    responses: {
      200: {
        description: "Souvenir updated",
        content: { "application/json": { schema: resolver(v1SouvenirWriteResponseSchema) } },
      },
      400: {
        description: "Invalid request body",
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
        description: "Trip not found, access denied, or souvenir not owned by the caller",
        content: { "application/json": { schema: resolver(errorResponseSchema) } },
      },
    },
  }),
  requireApiKey("souvenirs:write"),
  withTripAccess("tripId", async (c, tripId) => {
    const key = getApiKey(c);

    const rawItemId = c.req.param("itemId");
    const parsedItemId = uuidSchema.safeParse(rawItemId);
    if (!parsedItemId.success) {
      throw new ApiV1Error(400, "invalid_request", "Invalid souvenir id");
    }
    const itemId = parsedItemId.data;

    // Ownership scope: only the caller's own items in this trip.
    const existing = await db.query.souvenirItems.findFirst({
      where: and(
        eq(souvenirItems.id, itemId),
        eq(souvenirItems.tripId, tripId),
        eq(souvenirItems.userId, key.userId),
      ),
    });
    if (!existing) {
      throw new ApiV1Error(404, "not_found", "Souvenir not found in this trip");
    }

    const body = await c.req.json();
    const parsed = v1UpdateSouvenirSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiV1Error(400, "invalid_request", "Invalid request body");
    }

    const updateData = { ...parsed.data };
    const resolvedIsShared = updateData.isShared ?? existing.isShared;
    if (!resolvedIsShared) {
      updateData.shareStyle = null;
    }

    const [updated] = await db
      .update(souvenirItems)
      // souvenir_items has no $onUpdate; set updatedAt explicitly so the external
      // API never returns a stale timestamp after a successful update.
      .set({ ...updateData, updatedAt: new Date() })
      .where(eq(souvenirItems.id, itemId))
      .returning();

    const [memberNoMap, userName, [{ itemCount }]] = await Promise.all([
      buildTripMemberNoMap(tripId),
      getActorName(key.userId),
      db
        .select({ itemCount: count() })
        .from(souvenirItems)
        .where(and(eq(souvenirItems.tripId, tripId), eq(souvenirItems.userId, key.userId))),
    ]);

    return c.json({
      ...serializeSouvenirDto({ ...updated, userName }, memberNoMap),
      _meta: { count: itemCount, max: MAX_SOUVENIRS_PER_USER_PER_TRIP },
    });
  }),
);
