// v1 write routes for trips and schedules.
//
// File layout:
//   POST   /trips
//   PATCH  /trips/:id
//   POST   /trips/:tripId/days/:dayNumber/schedules
//   PATCH  /trips/:tripId/schedules/:scheduleId

import { MAX_SCHEDULES_PER_TRIP } from "@sugara/shared";
import { count, eq } from "drizzle-orm";
import { Hono } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import { db } from "../../db";
import { dayPatterns, schedules, tripDays, tripMembers, trips } from "../../db/schema";
import { logActivity } from "../../lib/activity-logger";
import { ApiV1Error, getApiKey, type V1Env } from "../../lib/external-api/errors";
import { notifyTripMembersExcluding } from "../../lib/notifications";
import { getScheduleCount } from "../../lib/schedule-count";
import { getNextSortOrder } from "../../lib/sort-order";
import { createInitialTripDays } from "../../lib/trip-days";
import { resolveTripLimit } from "../../lib/trip-limit";
import { updateTripCore } from "../../lib/trip-service";
import { requireApiKey } from "../../middleware/require-api-key";
import { errorResponseSchema } from "./openapi-schemas";
import { serializeScheduleDto, serializeTripDto } from "./serializers";
import { getActorName, uuidSchema, withTripAccess } from "./shared";
import {
  v1CreateScheduleSchema,
  v1CreateTripSchema,
  v1ScheduleWriteResponseSchema,
  v1TripWriteResponseSchema,
  v1UpdateScheduleSchema,
  v1UpdateTripSchema,
} from "./write-schemas";

export const tripsWriteApp = new Hono<V1Env>();

// ---------------------------------------------------------------------------
// POST /trips
// ---------------------------------------------------------------------------

tripsWriteApp.post(
  "/trips",
  describeRoute({
    tags: ["Trips"],
    summary: "Create a trip",
    description:
      'Creates a trip with the API key owner as the owner member. Returns 409 with `error.reason: "trip_limit_reached"` and `error.details.max` (the effective per-user limit) when the user has reached their trip limit. Supply startDate and endDate as YYYY-MM-DD strings. Requires `trips:write` scope.',
    security: [{ bearerAuth: [] }],
    requestBody: {
      required: true,
      content: {
        "application/json": {
          // resolver() is not accepted in requestBody by hono-openapi's DescribeRouteOptions;
          // the schema is described as a plain object here while actual validation runs
          // through v1CreateTripSchema.safeParse() below.
          schema: { type: "object" },
        },
      },
    },
    responses: {
      201: {
        description: "Trip created",
        content: { "application/json": { schema: resolver(v1TripWriteResponseSchema) } },
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
      409: {
        description:
          "Trip limit reached (error.reason: trip_limit_reached, error.details.max: effective per-user limit)",
        content: { "application/json": { schema: resolver(errorResponseSchema) } },
      },
    },
  }),
  requireApiKey("trips:write"),
  async (c) => {
    const key = getApiKey(c);
    const userId = key.userId;

    const body = await c.req.json();
    const parsed = v1CreateTripSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiV1Error(400, "invalid_request", "Invalid request body");
    }

    const { title, destination, startDate, endDate, currency } = parsed.data;

    const trip = await db.transaction(async (tx) => {
      const [tripCountRow] = await tx
        .select({ count: count() })
        .from(trips)
        .where(eq(trips.ownerId, userId));

      const limit = await resolveTripLimit(tx, userId);
      if (tripCountRow.count >= limit) {
        // Thrown inside the transaction (nothing written yet) so the per-user
        // limit resolved here can travel to the response as details.max.
        throw new ApiV1Error(409, "conflict", "Trip limit reached for this account", {
          reason: "trip_limit_reached",
          details: { max: limit },
        });
      }

      const [created] = await tx
        .insert(trips)
        .values({
          ownerId: userId,
          title,
          destination: destination ?? null,
          startDate,
          endDate,
          currency: currency ?? "JPY",
        })
        .returning();

      await createInitialTripDays(tx, created.id, startDate, endDate);

      // API key owner becomes the owner member, mirroring the internal POST /trips flow.
      await tx.insert(tripMembers).values({
        tripId: created.id,
        userId,
        role: "owner" as const,
      });

      return created;
    });

    logActivity({
      tripId: trip.id,
      userId,
      action: "created",
      entityType: "trip",
      entityName: trip.title,
    });

    return c.json(serializeTripDto(trip), 201);
  },
);

// ---------------------------------------------------------------------------
// PATCH /trips/:id
// ---------------------------------------------------------------------------

tripsWriteApp.patch(
  "/trips/:id",
  describeRoute({
    tags: ["Trips"],
    summary: "Update a trip",
    description:
      "Partially updates a trip. Requires editor or owner role. coverImageUrl and coverImagePosition are not exposed in v1. Returns 409 when a currency change is rejected (expenses exist) or when a concurrent modification is detected. Requires `trips:write` scope.",
    security: [{ bearerAuth: [] }],
    parameters: [
      {
        name: "id",
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
      200: {
        description: "Trip updated",
        content: { "application/json": { schema: resolver(v1TripWriteResponseSchema) } },
      },
      400: {
        description: "Invalid request body or date order",
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
        description: "Currency change rejected or concurrent modification conflict",
        content: { "application/json": { schema: resolver(errorResponseSchema) } },
      },
    },
  }),
  requireApiKey("trips:write"),
  withTripAccess(
    "id",
    async (c, tripId) => {
      const key = getApiKey(c);

      const body = await c.req.json();
      const parsed = v1UpdateTripSchema.safeParse(body);
      if (!parsed.success) {
        throw new ApiV1Error(400, "invalid_request", "Invalid request body");
      }

      // updateTripCore accepts the full UpdateTripInput shape; coverImage fields are
      // optional and omitted from the v1 input, so they default to undefined here
      // and the service skips them (it only writes fields that differ from current values).
      const result = await updateTripCore(tripId, key.userId, {
        ...parsed.data,
        coverImageUrl: undefined,
        coverImagePosition: undefined,
      });

      if (!result.ok) {
        switch (result.error) {
          case "not_found":
            throw new ApiV1Error(404, "not_found", "Trip not found");
          case "date_order":
            throw new ApiV1Error(400, "invalid_request", "End date must be on or after start date");
          // days_reduced is a permanent validation rule (the guard never allows
          // shrinking the date range), so it maps to 400 like the internal route —
          // not 409, which would invite retry-after-resolving-conflict semantics.
          case "days_reduced":
            throw new ApiV1Error(400, "invalid_request", "Cannot reduce the number of trip days");
          case "has_expenses":
            throw new ApiV1Error(
              409,
              "conflict",
              "Cannot change currency when the trip already has expenses",
            );
          case "conflict":
            throw new ApiV1Error(409, "conflict", "Concurrent modification detected; retry");
        }
      }

      return c.json(serializeTripDto(result.trip));
    },
    { minRole: "editor" },
  ),
);

// ---------------------------------------------------------------------------
// POST /trips/:tripId/days/:dayNumber/schedules
// ---------------------------------------------------------------------------

tripsWriteApp.post(
  "/trips/:tripId/days/:dayNumber/schedules",
  describeRoute({
    tags: ["Trips"],
    summary: "Add a schedule to a trip day",
    description:
      "Appends a schedule to the default pattern of the specified day (1-indexed). Returns 409 when the trip has no days (scheduling/poll mode) or when the per-trip schedule limit is reached. Returns 404 when dayNumber is out of range. Requires `trips:write` scope.",
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
        name: "dayNumber",
        in: "path",
        required: true,
        description: "1-indexed day number within the trip.",
        schema: { type: "integer", minimum: 1 },
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
        description: "Schedule created",
        content: { "application/json": { schema: resolver(v1ScheduleWriteResponseSchema) } },
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
        description: "Trip not found, access denied, or dayNumber out of range",
        content: { "application/json": { schema: resolver(errorResponseSchema) } },
      },
      409: {
        description: "Trip has no days (scheduling mode) or schedule limit reached",
        content: { "application/json": { schema: resolver(errorResponseSchema) } },
      },
    },
  }),
  requireApiKey("trips:write"),
  withTripAccess(
    "tripId",
    async (c, tripId) => {
      const key = getApiKey(c);

      // Parse the dayNumber path param as a positive integer.
      const rawDay = c.req.param("dayNumber");
      if (rawDay === undefined) {
        throw new ApiV1Error(400, "invalid_request", "Missing dayNumber");
      }
      const dayNumberInt = Number.parseInt(rawDay, 10);
      if (!Number.isInteger(dayNumberInt) || dayNumberInt < 1 || String(dayNumberInt) !== rawDay) {
        throw new ApiV1Error(400, "invalid_request", "dayNumber must be a positive integer");
      }

      // Fetch all days to detect scheduling mode and validate dayNumber range.
      const allDays = await db.query.tripDays.findMany({
        where: eq(tripDays.tripId, tripId),
        columns: { id: true, dayNumber: true },
        with: {
          patterns: {
            where: eq(dayPatterns.isDefault, true),
            columns: { id: true },
          },
        },
        orderBy: (d, { asc }) => [asc(d.dayNumber)],
      });

      if (allDays.length === 0) {
        // Trip is in scheduling/poll mode — no days have been created yet.
        throw new ApiV1Error(
          409,
          "conflict",
          "Trip has no days; create days before adding schedules",
        );
      }

      const targetDay = allDays.find((d) => d.dayNumber === dayNumberInt);
      if (!targetDay) {
        throw new ApiV1Error(404, "not_found", `Day ${dayNumberInt} not found in this trip`);
      }

      // Every day always has exactly one isDefault pattern (created in createInitialTripDays).
      const defaultPattern = targetDay.patterns[0];
      if (!defaultPattern) {
        throw new ApiV1Error(500, "internal_error", "Default pattern not found for this day");
      }
      const patternId = defaultPattern.id;

      const body = await c.req.json();
      const parsed = v1CreateScheduleSchema.safeParse(body);
      if (!parsed.success) {
        throw new ApiV1Error(400, "invalid_request", "Invalid request body");
      }

      // Anchors are never set on create (same rule as the internal route).
      const schedule = await db.transaction(async (tx) => {
        const scheduleCount = await getScheduleCount(tx, tripId);
        if (scheduleCount >= MAX_SCHEDULES_PER_TRIP) {
          return null;
        }

        const nextOrder = await getNextSortOrder(
          tx,
          schedules.sortOrder,
          schedules,
          eq(schedules.dayPatternId, patternId),
        );

        const [result] = await tx
          .insert(schedules)
          .values({
            tripId,
            dayPatternId: patternId,
            ...parsed.data,
            sortOrder: nextOrder,
          })
          .returning();

        return result;
      });

      if (!schedule) {
        throw new ApiV1Error(409, "conflict", "Per-trip schedule limit reached");
      }

      logActivity({
        tripId,
        userId: key.userId,
        action: "created",
        entityType: "schedule",
        entityName: schedule.name,
      });

      const actorName = await getActorName(key.userId);
      notifyTripMembersExcluding({
        type: "schedule_created",
        tripId,
        actorId: key.userId,
        makePayload: (tripName) => ({ actorName, tripName, entityName: schedule.name }),
      });

      return c.json(serializeScheduleDto(schedule), 201);
    },
    { minRole: "editor" },
  ),
);

// ---------------------------------------------------------------------------
// PATCH /trips/:tripId/schedules/:scheduleId
// ---------------------------------------------------------------------------

tripsWriteApp.patch(
  "/trips/:tripId/schedules/:scheduleId",
  describeRoute({
    tags: ["Trips"],
    summary: "Update a schedule",
    description:
      "Partially updates a schedule that belongs to the specified trip. Returns 404 when the schedule does not belong to the trip. Anchor fields and expectedUpdatedAt are not accepted in v1. Requires `trips:write` scope.",
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
        name: "scheduleId",
        in: "path",
        required: true,
        description: "Schedule UUID.",
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
        description: "Schedule updated",
        content: { "application/json": { schema: resolver(v1ScheduleWriteResponseSchema) } },
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
        description: "Trip not found, access denied, or schedule not in this trip",
        content: { "application/json": { schema: resolver(errorResponseSchema) } },
      },
    },
  }),
  requireApiKey("trips:write"),
  withTripAccess(
    "tripId",
    async (c, tripId) => {
      const key = getApiKey(c);

      const rawScheduleId = c.req.param("scheduleId");
      if (rawScheduleId === undefined) {
        throw new ApiV1Error(400, "invalid_request", "Missing scheduleId");
      }
      const parsedId = uuidSchema.safeParse(rawScheduleId);
      if (!parsedId.success) {
        throw new ApiV1Error(400, "invalid_request", "Invalid schedule id");
      }
      const scheduleId = parsedId.data;

      const existing = await db.query.schedules.findFirst({
        where: eq(schedules.id, scheduleId),
      });

      // Existence concealment: 404 whether the schedule doesn't exist or belongs
      // to a different trip (prevents id enumeration across trips).
      if (!existing || existing.tripId !== tripId) {
        throw new ApiV1Error(404, "not_found", "Schedule not found in this trip");
      }

      const body = await c.req.json();
      const parsed = v1UpdateScheduleSchema.safeParse(body);
      if (!parsed.success) {
        throw new ApiV1Error(400, "invalid_request", "Invalid request body");
      }

      // Preserve anchor fields from the existing row — v1 never writes them.
      const [updated] = await db
        .update(schedules)
        .set({ ...parsed.data, updatedAt: new Date() })
        .where(eq(schedules.id, scheduleId))
        .returning();

      logActivity({
        tripId,
        userId: key.userId,
        action: "updated",
        entityType: "schedule",
        entityName: updated.name,
      });

      const actorName = await getActorName(key.userId);
      notifyTripMembersExcluding({
        type: "schedule_updated",
        tripId,
        actorId: key.userId,
        makePayload: (tripName) => ({ actorName, tripName, entityName: updated.name }),
      });

      return c.json(serializeScheduleDto(updated));
    },
    { minRole: "editor" },
  ),
);
