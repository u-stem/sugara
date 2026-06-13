// Single source of truth for API endpoints that respond `204 No Content`.
//
// Client calls to these MUST use `apiVoid()`, never `api<T>()`. `api<T>()`
// expects a JSON body, so calling it against a 204 endpoint trips the runtime
// guard in `lib/api.ts` and surfaces a developer-facing error to the user
// (this regressed in PR #88 / fixed in PR #148). `api<void>()` also type-checks
// fine, so the type system cannot catch the mistake.
//
// `no-content-endpoints.test.ts` statically scans every `api()` call site in
// the web app and fails CI if any of them targets one of these (method, path)
// pairs — turning a runtime-only error into a build-time failure (#151).
//
// Keep this list in sync with the server routes that return 204
// (`apps/api/src/routes/*`). Each `pattern` matches a *normalized* request path
// where dynamic segments (`${id}`) are written as `:param`.

export type NoContentEndpoint = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  pattern: RegExp;
};

export const NO_CONTENT_ENDPOINTS: readonly NoContentEndpoint[] = [
  // DELETE /api/account — apps/api/src/routes/account.ts
  { method: "DELETE", pattern: /^\/api\/account$/ },
  // DELETE /api/quick-polls/:id — apps/api/src/routes/quick-polls.ts
  { method: "DELETE", pattern: /^\/api\/quick-polls\/:param$/ },
  // DELETE /api/trips/:tripId/souvenirs/:itemId — apps/api/src/routes/souvenirs.ts
  { method: "DELETE", pattern: /^\/api\/trips\/:param\/souvenirs\/:param$/ },
  // DELETE /api/trips/:tripId/settlement-payments/:paymentId — apps/api/src/routes/settlement-payments.ts
  { method: "DELETE", pattern: /^\/api\/trips\/:param\/settlement-payments\/:param$/ },
  // DELETE /api/trips/:tripId/expenses/:expenseId — apps/api/src/routes/expenses.ts
  { method: "DELETE", pattern: /^\/api\/trips\/:param\/expenses\/:param$/ },
];

// Normalize a path extracted from source into the `:param` form the patterns
// match: template substitutions (`${...}`) and `:id`-style segments collapse to
// `:param`, and any trailing query string is dropped.
export function normalizeApiPath(rawPath: string): string {
  return rawPath
    .replace(/\?.*$/, "")
    .replace(/\$\{[^}]*\}/g, ":param")
    .replace(/\/:[A-Za-z_][\w]*/g, "/:param");
}

export function matchesNoContentEndpoint(method: string, normalizedPath: string): boolean {
  const upper = method.toUpperCase();
  return NO_CONTENT_ENDPOINTS.some((e) => e.method === upper && e.pattern.test(normalizedPath));
}
