import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// vi.mock is hoisted above all imports. Set BETTER_AUTH_SECRET here so that
// betterAuth() in lib/auth.ts can read it from process.env when the module
// is first evaluated — before any test body runs.
vi.mock("../../db/index", async () => {
  process.env.BETTER_AUTH_SECRET ??= "test-secret-for-integration-tests-only";
  const { getTestDb } = await import("./setup");
  return { db: getTestDb() };
});

// Intentionally NOT mocking ../../lib/auth — this test exercises the real
// Better Auth handler and hooks to guard against path-string regressions.

import { eq } from "drizzle-orm";
import { apiKeys } from "../../db/schema";
import { auth } from "../../lib/auth";
import { generateApiKey } from "../../lib/external-api/api-key";
import { cleanupTables, getTestDb, teardownTestDb } from "./setup";

// BETTER_AUTH_BASE_URL defaults to "http://localhost:3000" via env.ts withDefault.
const BASE_URL = "http://localhost:3000";

// Extract every Set-Cookie value from a response and combine them into a
// single Cookie header string suitable for subsequent requests.
function sessionCookieFrom(headers: Headers): string {
  const pairs: string[] = [];
  headers.forEach((value, name) => {
    if (name.toLowerCase() === "set-cookie") {
      // Keep only the name=value portion; strip Path/HttpOnly/... directives.
      const pair = value.split(";")[0];
      pairs.push(pair.trim());
    }
  });
  return pairs.join("; ");
}

// Sign up a new user through the real Better Auth handler and return the
// session cookie string and the created user's ID.
async function signUp(opts: {
  email: string;
  password: string;
  name: string;
  username: string;
}): Promise<{ userId: string; sessionCookie: string }> {
  // No Origin header needed for sign-up: originCheckMiddleware skips origin
  // validation when the request has no Cookie header.
  const res = await auth.handler(
    new Request(`${BASE_URL}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(opts),
    }),
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`sign-up failed: ${res.status} ${body}`);
  }

  const body: { user: { id: string } } = await res.json();
  return {
    userId: body.user.id,
    sessionCookie: sessionCookieFrom(res.headers),
  };
}

// Insert a test API key directly into the DB and return its row ID.
async function insertApiKey(userId: string): Promise<string> {
  const db = getTestDb();
  const { keyHash, start } = generateApiKey();
  const [row] = await db
    .insert(apiKeys)
    .values({
      userId,
      name: "test key",
      keyHash,
      start,
      scopes: ["trips:read"],
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    })
    .returning({ id: apiKeys.id });
  return row.id;
}

describe("change-password API key revocation (integration)", () => {
  beforeEach(async () => {
    await cleanupTables();
  });

  afterAll(async () => {
    await cleanupTables();
    await teardownTestDb();
  });

  it("revokes api_keys for the user when change-password succeeds", async () => {
    // Arrange: create a user through the real BA handler, insert an API key
    const { userId, sessionCookie } = await signUp({
      email: "cp-revoke@test.com",
      password: "password-before",
      name: "CP Revoke User",
      username: "cprevkeuser",
    });
    await insertApiKey(userId);

    // Act: call change-password via auth.handler so the after-hook fires.
    // Origin is required by Better Auth's originCheckMiddleware when a Cookie
    // header is present — the value must be in trustedOrigins (FRONTEND_URL).
    const res = await auth.handler(
      new Request(`${BASE_URL}/api/auth/change-password`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: sessionCookie,
          Origin: BASE_URL,
        },
        body: JSON.stringify({
          currentPassword: "password-before",
          newPassword: "password-after",
          revokeOtherSessions: false,
        }),
      }),
    );

    // Assert: change-password succeeded
    expect(res.status).toBe(200);

    // Assert: the after-hook fired and revoked all API keys for the user
    const db = getTestDb();
    const remaining = await db.select().from(apiKeys).where(eq(apiKeys.userId, userId));
    expect(remaining).toHaveLength(0);
  });

  it("does not revoke api_keys when change-password fails due to wrong current password", async () => {
    // Arrange: create a separate user, insert an API key
    const { userId, sessionCookie } = await signUp({
      email: "cp-keep@test.com",
      password: "correct-password",
      name: "CP Keep User",
      username: "cpkeepuser2",
    });
    const keyId = await insertApiKey(userId);

    // Act: send wrong currentPassword — Better Auth returns an error, the
    // after-hook detects isAPIError(ctx.context.returned) and skips revocation.
    const res = await auth.handler(
      new Request(`${BASE_URL}/api/auth/change-password`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: sessionCookie,
          Origin: BASE_URL,
        },
        body: JSON.stringify({
          currentPassword: "wrong-password",
          newPassword: "new-password",
          revokeOtherSessions: false,
        }),
      }),
    );

    // Assert: the request was rejected (wrong password)
    expect(res.status).not.toBe(200);

    // Assert: the API key was NOT revoked because no password change occurred
    const db = getTestDb();
    const remaining = await db.select().from(apiKeys).where(eq(apiKeys.userId, userId));
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe(keyId);
  });
});
