import { z } from "zod";

// Authoritative list of scopes. The route-layer Zod schema (createApiKeySchema)
// is the single enforcement point for valid scope values and expiry bounds.
export const API_KEY_SCOPES = [
  "trips:read",
  "expenses:read",
  "articles:read",
  "bookmarks:read",
  "souvenirs:read",
  "trips:write",
  "expenses:write",
  "articles:write",
  "bookmarks:write",
  "souvenirs:write",
] as const;
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

// 90 days — maximum lifetime for any issued key. Self-use context.
export const MAX_API_KEY_EXPIRES_IN_SECONDS = 90 * 24 * 60 * 60; // 7,776,000

export const createApiKeySchema = z.object({
  name: z.string().min(1).max(100),
  // Lifetime in seconds. Enforced here so the helper function can run without
  // re-validating (it runs in a trusted server context).
  expiresIn: z.number().int().min(1).max(MAX_API_KEY_EXPIRES_IN_SECONDS),
  scopes: z.array(z.enum(API_KEY_SCOPES)).min(1),
});

export type CreateApiKeyInput = z.infer<typeof createApiKeySchema>;
