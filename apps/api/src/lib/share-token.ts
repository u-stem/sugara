import crypto, { createHash } from "node:crypto";
import { SEVEN_DAYS_MS } from "./constants";

export function generateShareToken(): string {
  // 32 bytes → 43 base64url chars. 64 bit was too thin for public /api/shared/:token brute force.
  return crypto.randomBytes(32).toString("base64url");
}

export function shareExpiresAt(): Date {
  return new Date(Date.now() + SEVEN_DAYS_MS);
}

/**
 * Derive the Realtime channel key for shared-link viewers from a share token.
 *
 * Trip members receive this key from the API instead of the token itself, so a
 * member cannot hand out a working share link. The token holder can compute the
 * same key (SHA-256, lowercase hex), but the token cannot be recovered from it.
 */
export function deriveShareChannelKey(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Drop share secrets from a trip row before returning it to a member who may not be the owner. */
export function omitShareSecrets<T extends { shareToken?: unknown; shareTokenExpiresAt?: unknown }>(
  trip: T,
): Omit<T, "shareToken" | "shareTokenExpiresAt"> {
  const { shareToken: _token, shareTokenExpiresAt: _expiresAt, ...rest } = trip;
  return rest;
}
