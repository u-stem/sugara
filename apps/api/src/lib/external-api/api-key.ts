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
