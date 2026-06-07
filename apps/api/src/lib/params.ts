import type { Context } from "hono";

/**
 * Extract a route parameter as a guaranteed string.
 * Route params defined in the path pattern (e.g. "/:tripId") always exist
 * when the handler runs, but Hono types them as `string | undefined`.
 */
export function getParam(c: Context, name: string): string {
  const value = c.req.param(name);
  if (value === undefined) {
    throw new Error(`Missing route parameter: ${name}`);
  }
  return value;
}

// RFC 4122 UUID — prevents Postgres "invalid input syntax for type uuid" errors
// on routes that pass the raw param directly into a UUID column comparison.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidUuid(id: string): boolean {
  return UUID_RE.test(id);
}
