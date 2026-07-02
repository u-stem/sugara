// v1 write routes for day patterns (alternative schedule plans within a day,
// e.g. "sunny" vs "rainy").
//
// File layout:
//   POST   /trips/:tripId/days/:dayNumber/patterns
//   PATCH  /trips/:tripId/patterns/:patternId
//   DELETE /trips/:tripId/patterns/:patternId
//   POST   /trips/:tripId/patterns/:patternId/duplicate
//   POST   /trips/:tripId/patterns/:patternId/overwrite
//
// Pattern identity is exposed as tripId + patternId (UUID) — tripDayId is an
// internal detail v1 callers never see. Day scoping for create uses the same
// 1-indexed dayNumber convention as POST .../days/:dayNumber/schedules.

import { MAX_PATTERNS_PER_DAY, MAX_SCHEDULES_PER_TRIP } from "@sugara/shared";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import { db } from "../../db";
import { dayPatterns, tripDays } from "../../db/schema";
import { logActivity } from "../../lib/activity-logger";
import { ApiV1Error, getApiKey, type V1Env } from "../../lib/external-api/errors";
import { hasChanges } from "../../lib/has-changes";
import {
  createDayPatternCore,
  duplicateDayPatternCore,
  overwriteDayPatternCore,
} from "../../lib/pattern-service";
import { requireApiKey } from "../../middleware/require-api-key";
import { errorResponseSchema } from "./openapi-schemas";
import { getPatternInTrip, uuidSchema, withTripAccess } from "./shared";
import {
  v1CreatePatternSchema,
  v1OverwritePatternSchema,
  v1PatternDeleteResponseSchema,
  v1PatternWriteResponseSchema,
  v1UpdatePatternSchema,
} from "./write-schemas";

export const patternsWriteApp = new Hono<V1Env>();

type PatternDto = {
  id: string;
  label: string;
  isDefault: boolean;
  sortOrder: number;
  createdAt: Date;
};

function serializePatternDto(pattern: PatternDto) {
  return {
    id: pattern.id,
    label: pattern.label,
    isDefault: pattern.isDefault,
    sortOrder: pattern.sortOrder,
    createdAt: pattern.createdAt.toISOString(),
  };
}

// Parses the dayNumber path param as a positive integer — same convention as
// POST /trips/:tripId/days/:dayNumber/schedules.
function parseDayNumber(raw: string | undefined): number {
  if (raw === undefined) {
    throw new ApiV1Error(400, "invalid_request", "Missing dayNumber");
  }
  const dayNumberInt = Number.parseInt(raw, 10);
  if (!Number.isInteger(dayNumberInt) || dayNumberInt < 1 || String(dayNumberInt) !== raw) {
    throw new ApiV1Error(400, "invalid_request", "dayNumber must be a positive integer");
  }
  return dayNumberInt;
}

// ---------------------------------------------------------------------------
// POST /trips/:tripId/days/:dayNumber/patterns
// ---------------------------------------------------------------------------

patternsWriteApp.post(
  "/trips/:tripId/days/:dayNumber/patterns",
  describeRoute({
    tags: ["Patterns"],
    summary: "Create a day pattern",
    description:
      'Creates an alternative schedule plan for the given day (1-indexed). Returns 409 with `error.reason: "pattern_limit_reached"` when the day already has MAX_PATTERNS_PER_DAY (3) patterns. Requires `trips:write` scope.',
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
      content: { "application/json": { schema: { type: "object" } } },
    },
    responses: {
      201: {
        description: "Pattern created",
        content: { "application/json": { schema: resolver(v1PatternWriteResponseSchema) } },
      },
      400: {
        description: "Invalid request body or dayNumber",
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
        description:
          'Per-day pattern limit reached (error.reason: "pattern_limit_reached", error.details.max)',
        content: { "application/json": { schema: resolver(errorResponseSchema) } },
      },
    },
  }),
  requireApiKey("trips:write"),
  withTripAccess(
    "tripId",
    async (c, tripId) => {
      const key = getApiKey(c);
      const dayNumberInt = parseDayNumber(c.req.param("dayNumber"));

      const day = await db.query.tripDays.findFirst({
        where: and(eq(tripDays.tripId, tripId), eq(tripDays.dayNumber, dayNumberInt)),
        columns: { id: true },
      });
      if (!day) {
        throw new ApiV1Error(404, "not_found", `Day ${dayNumberInt} not found in this trip`);
      }

      const body = await c.req.json();
      const parsed = v1CreatePatternSchema.safeParse(body);
      if (!parsed.success) {
        throw new ApiV1Error(400, "invalid_request", "Invalid request body");
      }

      const result = await createDayPatternCore(day.id, parsed.data.label);
      if (!result.ok) {
        throw new ApiV1Error(409, "conflict", "Per-day pattern limit reached", {
          reason: "pattern_limit_reached",
          details: { max: MAX_PATTERNS_PER_DAY },
        });
      }

      logActivity({
        tripId,
        userId: key.userId,
        action: "created",
        entityType: "pattern",
        entityName: result.pattern.label,
      });

      return c.json(serializePatternDto(result.pattern), 201);
    },
    { minRole: "editor" },
  ),
);

// ---------------------------------------------------------------------------
// PATCH /trips/:tripId/patterns/:patternId
// ---------------------------------------------------------------------------

patternsWriteApp.patch(
  "/trips/:tripId/patterns/:patternId",
  describeRoute({
    tags: ["Patterns"],
    summary: "Rename a pattern",
    description:
      "Renames a pattern (label only — sortOrder is not exposed in v1). Returns 404 when the pattern does not belong to the trip. Requires `trips:write` scope.",
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
        name: "patternId",
        in: "path",
        required: true,
        description: "Pattern UUID.",
        schema: { type: "string", format: "uuid" },
      },
    ],
    requestBody: {
      required: true,
      content: { "application/json": { schema: { type: "object" } } },
    },
    responses: {
      200: {
        description: "Pattern updated",
        content: { "application/json": { schema: resolver(v1PatternWriteResponseSchema) } },
      },
      400: {
        description: "Invalid request body or pattern id",
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
        description: "Trip not found, access denied, or pattern not in this trip",
        content: { "application/json": { schema: resolver(errorResponseSchema) } },
      },
    },
  }),
  requireApiKey("trips:write"),
  withTripAccess(
    "tripId",
    async (c, tripId) => {
      const key = getApiKey(c);
      const parsedId = uuidSchema.safeParse(c.req.param("patternId"));
      if (!parsedId.success) {
        throw new ApiV1Error(400, "invalid_request", "Invalid pattern id");
      }
      const patternId = parsedId.data;

      const pattern = await getPatternInTrip(tripId, patternId);
      if (!pattern) {
        throw new ApiV1Error(404, "not_found", "Pattern not found in this trip");
      }

      const body = await c.req.json();
      const parsed = v1UpdatePatternSchema.safeParse(body);
      if (!parsed.success) {
        throw new ApiV1Error(400, "invalid_request", "Invalid request body");
      }

      if (!hasChanges(pattern, parsed.data)) {
        return c.json(serializePatternDto(pattern));
      }

      const [updated] = await db
        .update(dayPatterns)
        .set(parsed.data)
        .where(eq(dayPatterns.id, patternId))
        .returning();

      logActivity({
        tripId,
        userId: key.userId,
        action: "updated",
        entityType: "pattern",
        entityName: updated.label,
      });

      return c.json(serializePatternDto(updated));
    },
    { minRole: "editor" },
  ),
);

// ---------------------------------------------------------------------------
// DELETE /trips/:tripId/patterns/:patternId
// ---------------------------------------------------------------------------

patternsWriteApp.delete(
  "/trips/:tripId/patterns/:patternId",
  describeRoute({
    tags: ["Patterns"],
    summary: "Delete a pattern",
    description:
      "Deletes a pattern and cascades its schedules. Idempotent: returns 200 in all cases. " +
      "deleted:true when the pattern was found and removed; deleted:false when the id is unknown " +
      "or belongs to another trip. The default pattern cannot be deleted " +
      '(400, error.reason: "cannot_delete_default_pattern"). Requires `trips:write` scope.',
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
        name: "patternId",
        in: "path",
        required: true,
        description: "Pattern UUID.",
        schema: { type: "string", format: "uuid" },
      },
    ],
    responses: {
      200: {
        description: "Deletion result (deleted:true when removed, deleted:false when already gone)",
        content: { "application/json": { schema: resolver(v1PatternDeleteResponseSchema) } },
      },
      400: {
        description:
          'Invalid pattern id, or attempted deletion of the default pattern (error.reason: "cannot_delete_default_pattern")',
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
      const parsedId = uuidSchema.safeParse(c.req.param("patternId"));
      if (!parsedId.success) {
        throw new ApiV1Error(400, "invalid_request", "Invalid pattern id");
      }
      const patternId = parsedId.data;

      const pattern = await getPatternInTrip(tripId, patternId);
      // Idempotent: unknown id or foreign trip → deleted:false, not 404.
      if (!pattern) {
        return c.json({ id: patternId, deleted: false });
      }
      if (pattern.isDefault) {
        throw new ApiV1Error(400, "invalid_request", "Cannot delete the default pattern", {
          reason: "cannot_delete_default_pattern",
        });
      }

      await db.delete(dayPatterns).where(eq(dayPatterns.id, patternId));

      logActivity({
        tripId,
        userId: key.userId,
        action: "deleted",
        entityType: "pattern",
        entityName: pattern.label,
      });

      return c.json({ id: patternId, deleted: true });
    },
    { minRole: "editor" },
  ),
);

// ---------------------------------------------------------------------------
// POST /trips/:tripId/patterns/:patternId/duplicate
// ---------------------------------------------------------------------------

patternsWriteApp.post(
  "/trips/:tripId/patterns/:patternId/duplicate",
  describeRoute({
    tags: ["Patterns"],
    summary: "Duplicate a pattern",
    description:
      'Clones a pattern (label becomes "{source} (copy)") along with its schedules, into the same day. ' +
      'Returns 409 when the per-day pattern limit (error.reason: "pattern_limit_reached") or the ' +
      'per-trip schedule limit (error.reason: "schedule_limit_reached") would be exceeded. ' +
      "Requires `trips:write` scope.",
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
        name: "patternId",
        in: "path",
        required: true,
        description: "Pattern UUID.",
        schema: { type: "string", format: "uuid" },
      },
    ],
    responses: {
      201: {
        description: "Pattern duplicated",
        content: { "application/json": { schema: resolver(v1PatternWriteResponseSchema) } },
      },
      400: {
        description: "Invalid pattern id",
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
        description: "Trip not found, access denied, or pattern not in this trip",
        content: { "application/json": { schema: resolver(errorResponseSchema) } },
      },
      409: {
        description: "Per-day pattern limit or per-trip schedule limit reached",
        content: { "application/json": { schema: resolver(errorResponseSchema) } },
      },
    },
  }),
  requireApiKey("trips:write"),
  withTripAccess(
    "tripId",
    async (c, tripId) => {
      const key = getApiKey(c);
      const parsedId = uuidSchema.safeParse(c.req.param("patternId"));
      if (!parsedId.success) {
        throw new ApiV1Error(400, "invalid_request", "Invalid pattern id");
      }
      const patternId = parsedId.data;

      const source = await db.query.dayPatterns.findFirst({
        where: eq(dayPatterns.id, patternId),
        with: { tripDay: { columns: { id: true, tripId: true } }, schedules: true },
      });
      if (!source || source.tripDay.tripId !== tripId) {
        throw new ApiV1Error(404, "not_found", "Pattern not found in this trip");
      }

      const result = await duplicateDayPatternCore(tripId, source.tripDay.id, source);
      if (!result.ok) {
        const max =
          result.error === "pattern_limit_reached" ? MAX_PATTERNS_PER_DAY : MAX_SCHEDULES_PER_TRIP;
        throw new ApiV1Error(409, "conflict", "Duplicate would exceed a limit", {
          reason: result.error,
          details: { max },
        });
      }

      logActivity({
        tripId,
        userId: key.userId,
        action: "duplicated",
        entityType: "pattern",
        entityName: result.pattern.label,
      });

      return c.json(serializePatternDto(result.pattern), 201);
    },
    { minRole: "editor" },
  ),
);

// ---------------------------------------------------------------------------
// POST /trips/:tripId/patterns/:patternId/overwrite
// ---------------------------------------------------------------------------

patternsWriteApp.post(
  "/trips/:tripId/patterns/:patternId/overwrite",
  describeRoute({
    tags: ["Patterns"],
    summary: "Overwrite a pattern with another pattern's schedules",
    description:
      "Replaces all of the target pattern's schedules with clones of sourcePatternId's schedules. " +
      "Source must belong to the same trip and the same day as the target (404 otherwise). " +
      'Returns 409 (error.reason: "schedule_limit_reached") when the per-trip schedule limit would ' +
      "be exceeded. Requires `trips:write` scope.",
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
        name: "patternId",
        in: "path",
        required: true,
        description: "Target pattern UUID.",
        schema: { type: "string", format: "uuid" },
      },
    ],
    requestBody: {
      required: true,
      content: { "application/json": { schema: { type: "object" } } },
    },
    responses: {
      200: {
        description: "Pattern overwritten",
        content: { "application/json": { schema: resolver(v1PatternWriteResponseSchema) } },
      },
      400: {
        description: "Invalid request body or pattern id",
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
        description:
          "Trip not found, access denied, target pattern not found, or source pattern not in the same trip/day",
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
      const parsedId = uuidSchema.safeParse(c.req.param("patternId"));
      if (!parsedId.success) {
        throw new ApiV1Error(400, "invalid_request", "Invalid pattern id");
      }
      const patternId = parsedId.data;

      const body = await c.req.json();
      const parsed = v1OverwritePatternSchema.safeParse(body);
      if (!parsed.success) {
        throw new ApiV1Error(400, "invalid_request", "Invalid request body");
      }

      const target = await getPatternInTrip(tripId, patternId);
      if (!target) {
        throw new ApiV1Error(404, "not_found", "Pattern not found in this trip");
      }

      // Source must be a sibling of the target — same trip AND same day.
      const source = await db.query.dayPatterns.findFirst({
        where: eq(dayPatterns.id, parsed.data.sourcePatternId),
        with: { tripDay: { columns: { id: true, tripId: true } }, schedules: true },
      });
      if (!source || source.tripDay.tripId !== tripId || source.tripDay.id !== target.tripDayId) {
        throw new ApiV1Error(404, "not_found", "Source pattern not found in this day");
      }

      const result = await overwriteDayPatternCore(tripId, patternId, source);
      if (!result.ok) {
        throw new ApiV1Error(
          409,
          "conflict",
          "Overwrite would exceed the per-trip schedule limit",
          {
            reason: "schedule_limit_reached",
            details: { max: MAX_SCHEDULES_PER_TRIP },
          },
        );
      }

      logActivity({
        tripId,
        userId: key.userId,
        action: "updated",
        entityType: "pattern",
        entityName: target.label,
      });

      return c.json(serializePatternDto(target));
    },
    { minRole: "editor" },
  ),
);
