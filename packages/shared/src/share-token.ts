// Format of the tokens produced by generateShareToken() in the API:
// 32 random bytes encoded as base64url (43 characters, no padding).
const SHARE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/**
 * True when the value has the exact shape of a generated share token.
 * Use it before interpolating a URL segment into an API path so a crafted value
 * (e.g. "../admin") can never address another endpoint.
 */
export function isShareToken(value: string): boolean {
  return SHARE_TOKEN_PATTERN.test(value);
}
