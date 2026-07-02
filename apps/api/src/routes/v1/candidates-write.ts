// v1 write routes for trip candidates.
//
// File layout:
//   POST   /trips/:tripId/candidates
//   POST   /trips/:tripId/candidates/batch
//   PATCH  /trips/:tripId/candidates/:scheduleId
//   DELETE /trips/:tripId/candidates/:scheduleId
//
// A candidate is a schedule row with dayPatternId = NULL — an unassigned spot in
// the trip's planning pool. The create/update payloads reuse the v1 schedule
// schemas (createScheduleSchema with anchor/geo fields omitted) and serialize via
// serializeScheduleDto, since a candidate IS a schedule.
//
// Note: the existing PATCH /trips/:tripId/schedules/:scheduleId can also update a
// candidate row (it does not filter on dayPatternId). This route is the
// candidate-scoped path: it 404s for already-assigned schedules so callers get
// candidate-specific semantics. Both require trips:write (no privilege gap).

import { MAX_SCHEDULES_PER_TRIP } from "@sugara/shared";
import { and, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import { db } from "../../db";
import { schedules } from "../../db/schema";
import { logActivity } from "../../lib/activity-logger";
import { batchCreateCandidatesCore, createCandidateCore } from "../../lib/candidate-service";
import { ApiV1Error, getApiKey, type V1Env } from "../../lib/external-api/errors";
import { hasChanges } from "../../lib/has-changes";
import { notifyTripMembersExcluding } from "../../lib/notifications";
import { assignScheduleToPattern } from "../../lib/schedule-assignment";
import { getScheduleCount } from "../../lib/schedule-count";
import { requireApiKey } from "../../middleware/require-api-key";
import { errorResponseSchema } from "./openapi-schemas";
import { serializeScheduleDto } from "./serializers";
import { getActorName, getPatternInTrip, uuidSchema, withTripAccess } from "./shared";
import {
  v1AssignCandidateSchema,
  v1BatchCreateCandidateSchema,
  v1CandidateBatchWriteResponseSchema,
  v1CandidateWriteResponseSchema,
  v1CreateScheduleSchema,
  v1DeleteResponseSchema,
  v1ScheduleWriteResponseSchema,
  v1UpdateScheduleSchema,
} from "./write-schemas";

export const candidatesWriteApp = new Hono<V1Env>();

// ---------------------------------------------------------------------------
// POST /trips/:tripId/candidates
// ---------------------------------------------------------------------------

candidatesWriteApp.post(
  "/trips/:tripId/candidates",
  describeRoute({
    tags: ["Candidates"],
    summary: "Create a candidate",
    description:
      "Adds a candidate (an unassigned spot) to a trip's planning pool. Anchor and geolocation fields are not accepted. Returns 409 when the per-trip schedule limit is reached. Requires `trips:write` scope and editor/owner role on the trip.",
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
        description: "Candidate created",
        content: { "application/json": { schema: resolver(v1CandidateWriteResponseSchema) } },
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
          'Per-trip schedule limit reached (error.reason: "schedule_limit_reached", error.details.max)',
        content: { "application/json": { schema: resolver(errorResponseSchema) } },
      },
    },
  }),
  requireApiKey("trips:write"),
  withTripAccess(
    "tripId",
    async (c, tripId) => {
      const key = getApiKey(c);

      const body = await c.req.json();
      const parsed = v1CreateScheduleSchema.safeParse(body);
      if (!parsed.success) {
        throw new ApiV1Error(400, "invalid_request", "Invalid request body");
      }

      const result = await createCandidateCore(tripId, parsed.data);
      if (!result.ok) {
        throw new ApiV1Error(409, "conflict", "Per-trip schedule limit reached", {
          reason: "schedule_limit_reached",
          details: { max: MAX_SCHEDULES_PER_TRIP },
        });
      }
      const schedule = result.schedule;

      // Run in parallel: count is needed for _meta and must reflect the
      // post-insert state; actorName is needed for the notification payload.
      const [scheduleCount, actorName] = await Promise.all([
        getScheduleCount(db, tripId),
        getActorName(key.userId),
      ]);
      logActivity({
        tripId,
        userId: key.userId,
        action: "created",
        entityType: "candidate",
        entityName: schedule.name,
      });
      notifyTripMembersExcluding({
        type: "candidate_created",
        tripId,
        actorId: key.userId,
        makePayload: (tripName) => ({ actorName, tripName, entityName: schedule.name }),
      });

      return c.json(
        {
          ...serializeScheduleDto(schedule),
          _meta: { count: scheduleCount, max: MAX_SCHEDULES_PER_TRIP },
        },
        201,
      );
    },
    { minRole: "editor" },
  ),
);

// ---------------------------------------------------------------------------
// POST /trips/:tripId/candidates/batch
// ---------------------------------------------------------------------------

candidatesWriteApp.post(
  "/trips/:tripId/candidates/batch",
  describeRoute({
    tags: ["Candidates"],
    summary: "Batch create candidates",
    description:
      'Creates up to 50 candidates in a single transaction. Items that exceed the per-trip schedule limit are returned in `skipped` with `reason: "limit_reached"`. When `onConflict` is `"skip"`, items whose name (trimmed, case-insensitive) matches an existing schedule in the trip or an earlier item in the same batch are returned in `skipped` with `reason: "duplicate"`. Requires `trips:write` scope and editor/owner role on the trip.',
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
        description: "Batch processed (partial success is normal — check `skipped`)",
        content: {
          "application/json": { schema: resolver(v1CandidateBatchWriteResponseSchema) },
        },
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
    },
  }),
  requireApiKey("trips:write"),
  withTripAccess(
    "tripId",
    async (c, tripId) => {
      const body = await c.req.json();
      const parsed = v1BatchCreateCandidateSchema.safeParse(body);
      if (!parsed.success) {
        throw new ApiV1Error(400, "invalid_request", "Invalid request body");
      }

      const { items, onConflict } = parsed.data;
      const { created, skipped } = await batchCreateCandidatesCore(tripId, items, onConflict);

      // Intentionally no logActivity/notifyTripMembersExcluding here: a batch can
      // create up to 50 items, and per-item logs/notifications would spam members.
      // Post-batch trip-wide schedule count for _meta.
      const scheduleCount = await getScheduleCount(db, tripId);

      return c.json(
        {
          created: created.map((s) => serializeScheduleDto(s)),
          skipped,
          _meta: { count: scheduleCount, max: MAX_SCHEDULES_PER_TRIP },
        },
        201,
      );
    },
    { minRole: "editor" },
  ),
);

// ---------------------------------------------------------------------------
// PATCH /trips/:tripId/candidates/:scheduleId
// ---------------------------------------------------------------------------

candidatesWriteApp.patch(
  "/trips/:tripId/candidates/:scheduleId",
  describeRoute({
    tags: ["Candidates"],
    summary: "Update a candidate",
    description:
      "Partially updates a candidate. Returns 404 when the schedule does not belong to the trip or has already been assigned to a day (dayPatternId is not null). Requires `trips:write` scope and editor/owner role on the trip.",
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
        description: "Candidate (schedule) UUID.",
        schema: { type: "string", format: "uuid" },
      },
    ],
    requestBody: {
      required: true,
      content: { "application/json": { schema: { type: "object" } } },
    },
    responses: {
      200: {
        description: "Candidate updated",
        content: { "application/json": { schema: resolver(v1CandidateWriteResponseSchema) } },
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
        description: "Trip not found, access denied, or candidate not in this trip",
        content: { "application/json": { schema: resolver(errorResponseSchema) } },
      },
    },
  }),
  requireApiKey("trips:write"),
  withTripAccess(
    "tripId",
    async (c, tripId) => {
      const rawScheduleId = c.req.param("scheduleId");
      const parsedId = uuidSchema.safeParse(rawScheduleId);
      if (!parsedId.success) {
        throw new ApiV1Error(400, "invalid_request", "Invalid candidate id");
      }
      const scheduleId = parsedId.data;

      const body = await c.req.json();
      const parsed = v1UpdateScheduleSchema.safeParse(body);
      if (!parsed.success) {
        throw new ApiV1Error(400, "invalid_request", "Invalid request body");
      }

      // Candidate scope: only unassigned (dayPatternId IS NULL) schedules. An
      // assigned schedule 404s here so the candidate path stays distinct.
      const existing = await db.query.schedules.findFirst({
        where: and(
          eq(schedules.id, scheduleId),
          eq(schedules.tripId, tripId),
          isNull(schedules.dayPatternId),
        ),
      });
      if (!existing) {
        throw new ApiV1Error(404, "not_found", "Candidate not found in this trip");
      }

      // Fetch the current schedule count for _meta before branching on no-op /
      // update: the count is included in both paths and does not change on PATCH.
      const scheduleCount = await getScheduleCount(db, tripId);
      const meta = { count: scheduleCount, max: MAX_SCHEDULES_PER_TRIP };

      // No-op update: skip the write and the activity log entirely (mirrors the
      // internal candidate route, which guards with hasChanges).
      if (!hasChanges(existing, parsed.data)) {
        return c.json({ ...serializeScheduleDto(existing), _meta: meta });
      }

      const [updated] = await db
        .update(schedules)
        .set({ ...parsed.data, updatedAt: new Date() })
        .where(eq(schedules.id, scheduleId))
        .returning();

      const key = getApiKey(c);
      logActivity({
        tripId,
        userId: key.userId,
        action: "updated",
        entityType: "candidate",
        entityName: updated.name,
      });

      return c.json({ ...serializeScheduleDto(updated), _meta: meta });
    },
    { minRole: "editor" },
  ),
);

// ---------------------------------------------------------------------------
// DELETE /trips/:tripId/candidates/:scheduleId
// ---------------------------------------------------------------------------

candidatesWriteApp.delete(
  "/trips/:tripId/candidates/:scheduleId",
  describeRoute({
    tags: ["Candidates"],
    summary: "Delete a candidate",
    description:
      "Physically deletes an unassigned candidate from the trip's planning pool. " +
      "Idempotent: returns 200 in all cases. " +
      "deleted:true when the item was found and removed; deleted:false when the id is unknown, " +
      "belongs to another trip, or the schedule has already been assigned to a day (not a candidate). " +
      "remaining reflects the post-operation trip-wide schedule count. " +
      "Requires `trips:write` scope and editor/owner role on the trip.",
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
        description: "Candidate (schedule) UUID.",
        schema: { type: "string", format: "uuid" },
      },
    ],
    responses: {
      200: {
        description:
          "Deletion result (deleted:true when removed, deleted:false when already gone or assigned)",
        content: { "application/json": { schema: resolver(v1DeleteResponseSchema) } },
      },
      400: {
        description: "Invalid candidate id",
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
    },
  }),
  requireApiKey("trips:write"),
  withTripAccess(
    "tripId",
    async (c, tripId) => {
      const key = getApiKey(c);

      const rawScheduleId = c.req.param("scheduleId");
      const parsedId = uuidSchema.safeParse(rawScheduleId);
      if (!parsedId.success) {
        throw new ApiV1Error(400, "invalid_request", "Invalid candidate id");
      }
      const scheduleId = parsedId.data;

      // Atomic delete: guard conditions (tripId + unassigned) are folded into
      // the WHERE clause so there is no TOCTOU window between an existence
      // check and the delete. Without this, a concurrent assign between a
      // prior findFirst and the delete would physically remove an assigned
      // schedule from the day — the atomic approach eliminates that window.
      const deletedRows = await db
        .delete(schedules)
        .where(
          and(
            eq(schedules.id, scheduleId),
            eq(schedules.tripId, tripId),
            isNull(schedules.dayPatternId),
          ),
        )
        .returning({ id: schedules.id, name: schedules.name });
      const didDelete = deletedRows.length > 0;

      if (didDelete) {
        // Run in parallel: count needs the post-delete state, actorName is
        // needed for the candidate_deleted notification payload.
        const [scheduleCount, actorName] = await Promise.all([
          getScheduleCount(db, tripId),
          getActorName(key.userId),
        ]);
        logActivity({
          tripId,
          userId: key.userId,
          action: "deleted",
          entityType: "candidate",
          entityName: deletedRows[0].name,
        });
        notifyTripMembersExcluding({
          type: "candidate_deleted",
          tripId,
          actorId: key.userId,
          makePayload: (tripName) => ({ actorName, tripName }),
        });
        return c.json({
          id: scheduleId,
          deleted: true,
          remaining: { count: scheduleCount, max: MAX_SCHEDULES_PER_TRIP },
        });
      }

      // Idempotent: id unknown, belongs to another trip, already deleted,
      // or is an assigned schedule (no longer a candidate).
      const scheduleCount = await getScheduleCount(db, tripId);
      return c.json({
        id: scheduleId,
        deleted: false,
        remaining: { count: scheduleCount, max: MAX_SCHEDULES_PER_TRIP },
      });
    },
    { minRole: "editor" },
  ),
);

// ---------------------------------------------------------------------------
// POST /trips/:tripId/candidates/:scheduleId/assign
// ---------------------------------------------------------------------------

candidatesWriteApp.post(
  "/trips/:tripId/candidates/:scheduleId/assign",
  describeRoute({
    tags: ["Candidates"],
    summary: "Assign a candidate to a pattern",
    description:
      "Moves a candidate (unassigned spot) into the given pattern, appending it to the end of that " +
      "pattern's schedule order. Returns 404 when the schedule is not an unassigned candidate in this " +
      "trip, or when the pattern does not belong to this trip. Requires `trips:write` scope.",
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
        description: "Candidate (schedule) UUID.",
        schema: { type: "string", format: "uuid" },
      },
    ],
    requestBody: {
      required: true,
      content: { "application/json": { schema: { type: "object" } } },
    },
    responses: {
      200: {
        description: "Candidate assigned to the pattern",
        content: { "application/json": { schema: resolver(v1ScheduleWriteResponseSchema) } },
      },
      400: {
        description: "Invalid request body or candidate id",
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
        description: "Candidate not found in this trip, or pattern not in this trip",
        content: { "application/json": { schema: resolver(errorResponseSchema) } },
      },
    },
  }),
  requireApiKey("trips:write"),
  withTripAccess(
    "tripId",
    async (c, tripId) => {
      const key = getApiKey(c);

      const parsedId = uuidSchema.safeParse(c.req.param("scheduleId"));
      if (!parsedId.success) {
        throw new ApiV1Error(400, "invalid_request", "Invalid candidate id");
      }
      const scheduleId = parsedId.data;

      const body = await c.req.json();
      const parsed = v1AssignCandidateSchema.safeParse(body);
      if (!parsed.success) {
        throw new ApiV1Error(400, "invalid_request", "Invalid request body");
      }

      const existing = await db.query.schedules.findFirst({
        where: and(
          eq(schedules.id, scheduleId),
          eq(schedules.tripId, tripId),
          isNull(schedules.dayPatternId),
        ),
      });
      if (!existing) {
        throw new ApiV1Error(404, "not_found", "Candidate not found in this trip");
      }

      const pattern = await getPatternInTrip(tripId, parsed.data.patternId);
      if (!pattern) {
        throw new ApiV1Error(404, "not_found", "Pattern not found in this trip");
      }

      const updated = await assignScheduleToPattern(scheduleId, pattern.id);

      logActivity({
        tripId,
        userId: key.userId,
        action: "assigned",
        entityType: "candidate",
        entityName: updated.name,
      });

      return c.json(serializeScheduleDto(updated));
    },
    { minRole: "editor" },
  ),
);
