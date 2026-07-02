import type { MemberRole } from "@sugara/shared";
import { canEdit } from "@sugara/shared";
import { eq } from "drizzle-orm";
import type { Context } from "hono";
import { z } from "zod";
import { db } from "../../db";
import { dayPatterns, users } from "../../db/schema";
import { ApiV1Error, getApiKey, type V1Env } from "../../lib/external-api/errors";
import { checkTripAccess } from "../../lib/permissions";

// Fetches the display name for a user, used for notification payloads.
// Returns "Unknown" when the user row is not found (defensive fallback).
export async function getActorName(userId: string): Promise<string> {
  const row = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { name: true },
  });
  return row?.name ?? "Unknown";
}

// Looks up a pattern and verifies it belongs to tripId (patterns are scoped by
// tripDayId, not tripId directly, so the trip is confirmed via the joined day).
// Returns null when the pattern doesn't exist or belongs to a different trip —
// callers use this single null case to 404 without leaking which reason applied.
export async function getPatternInTrip(tripId: string, patternId: string) {
  const pattern = await db.query.dayPatterns.findFirst({
    where: eq(dayPatterns.id, patternId),
    with: { tripDay: { columns: { id: true, tripId: true } } },
  });
  if (!pattern || pattern.tripDay.tripId !== tripId) {
    return null;
  }
  return pattern;
}

// Shared UUID schema used across all v1 routes.
// z.guid() validates the 8-4-4-4-12 hex GUID format without enforcing UUID
// version/variant bits, so it accepts test fixtures and ids from non-v4 generators.
export const uuidSchema = z.string().check(z.guid());

type TripAccessOptions = {
  // When "editor", viewer-role members receive a 404 (same existence-concealment
  // policy as the internal canEdit() guard) rather than a 403.
  minRole?: "editor";
};

export type TripAccessHandler = (
  c: Context<V1Env>,
  tripId: string,
  role: MemberRole,
) => Promise<Response>;

// HOF that enforces trip membership before delegating to the inner handler.
//
// Design rationale (mirrors the original in index.ts):
//   1. Validates the path param as a GUID (400 if invalid).
//   2. Checks trip membership via checkTripAccess (404 if not a member).
//   3. Optionally enforces a minimum role (404 — not 403 — to preserve existence
//      concealment: viewers cannot infer that a trip exists by getting a 403).
//   4. Calls the inner handler with (c, tripId, role) so callers have both values
//      without a second lookup.
//
// The HOF pattern means the compiler can only reach the inner handler when the
// guards have already run — accidental direct calls without the guard are impossible.
export function withTripAccess(
  paramName: "id" | "tripId",
  handler: TripAccessHandler,
  options?: TripAccessOptions,
) {
  return async (c: Context<V1Env>): Promise<Response> => {
    const rawId = c.req.param(paramName);
    const parsed = uuidSchema.safeParse(rawId);
    if (!parsed.success) {
      throw new ApiV1Error(400, "invalid_request", "Invalid trip id");
    }
    const tripId = parsed.data;
    const key = getApiKey(c);
    const role = await checkTripAccess(tripId, key.userId);
    if (role === null) {
      throw new ApiV1Error(404, "not_found", "Trip not found or access denied");
    }
    // Viewer-role rejection: same 404 used by the internal app so callers cannot
    // determine trip existence by comparing 403 vs 404 responses.
    if (options?.minRole === "editor" && !canEdit(role)) {
      throw new ApiV1Error(404, "not_found", "Trip not found or access denied");
    }
    return handler(c, tripId, role);
  };
}
