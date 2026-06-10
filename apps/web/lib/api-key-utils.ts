/**
 * Returns true when the given ISO expiry timestamp is in the past.
 */
export function isApiKeyExpired(expiresAt: string): boolean {
  return new Date(expiresAt) < new Date();
}
