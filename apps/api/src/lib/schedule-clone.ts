/**
 * Extract clonable fields from a schedule source.
 * Centralizes the field list so schema changes only need updating here.
 */

const CLONE_FIELDS = [
  "name",
  "category",
  "address",
  "startTime",
  "endTime",
  "sortOrder",
  "memo",
  "urls",
  "departurePlace",
  "arrivalPlace",
  "transportMethod",
  "cost",
  "color",
  "latitude",
  "longitude",
  "placeId",
  "endDayOffset",
] as const;

type CloneField = (typeof CLONE_FIELDS)[number];

export function buildScheduleCloneValues<T extends Record<CloneField, unknown>>(
  source: T,
  overrides?: Partial<Pick<T, CloneField>>,
): Pick<T, CloneField> {
  const values = {} as Record<string, unknown>;
  for (const field of CLONE_FIELDS) {
    values[field] = source[field];
  }
  if (overrides) {
    Object.assign(values, overrides);
  }
  return values as Pick<T, CloneField>;
}
