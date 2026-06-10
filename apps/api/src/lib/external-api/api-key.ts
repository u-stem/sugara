import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { db } from "../../db";
import { apiKeys } from "../../db/schema";

const KEY_PREFIX = "sk_";
const RAW_KEY_BYTES = 32;
// KEY_PREFIX (3 chars) + 8 visible chars, shown in the key list for identification.
const START_LENGTH = 11;

// Why hex over base64: the column is varchar(64) and a fixed-width hex digest is
// trivially indexable and comparable. The raw key is never stored.
//
// Why unsalted SHA-256 and not bcrypt/argon2 (CodeQL js/insufficient-password-hash
// flags this as a false positive): the input is a 256-bit CSPRNG token, not a
// human password. Slow hashes exist to make brute-forcing low-entropy secrets
// expensive; a 2^256 search space cannot be brute-forced regardless of hash
// speed. A per-hash salt would also break the indexed equality lookup that
// verifyApiKey relies on. Same scheme GitHub uses for PAT storage.
export function hashApiKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}

export function generateApiKey(): { rawKey: string; keyHash: string; start: string } {
  const rawKey = KEY_PREFIX + randomBytes(RAW_KEY_BYTES).toString("base64url");
  return { rawKey, keyHash: hashApiKey(rawKey), start: rawKey.slice(0, START_LENGTH) };
}

export type VerifiedApiKey = {
  id: string;
  userId: string;
  scopes: string[];
  expiresAt: Date;
};

// Deletes all API keys for the given user. Called on password reset so that
// compromised credentials do not leave long-lived API keys intact.
export async function revokeApiKeysByUserId(userId: string): Promise<void> {
  await db.delete(apiKeys).where(eq(apiKeys.userId, userId));
}

// Looks up a raw bearer token by its hash. Returns null for every invalid case
// (unknown key / expired) without distinguishing them — the caller maps all to a
// single 401 so response differences can't be used to enumerate keys.
export async function verifyApiKey(token: string): Promise<VerifiedApiKey | null> {
  const keyHash = hashApiKey(token);
  const rows = await db
    .select({
      id: apiKeys.id,
      userId: apiKeys.userId,
      scopes: apiKeys.scopes,
      expiresAt: apiKeys.expiresAt,
    })
    .from(apiKeys)
    .where(and(eq(apiKeys.keyHash, keyHash), gt(apiKeys.expiresAt, new Date())))
    .limit(1);
  return rows[0] ?? null;
}
