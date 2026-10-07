import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// vi.mock is hoisted above all imports. Set BETTER_AUTH_SECRET here so that
// betterAuth() in lib/auth.ts can read it from process.env when the module
// is first evaluated — before any test body runs.
vi.mock("../../db/index", async () => {
  process.env.BETTER_AUTH_SECRET ??= "test-secret-for-integration-tests-only";
  const { getTestDb } = await import("./setup");
  return { db: getTestDb() };
});

// Intentionally NOT mocking ../../lib/auth — these tests exercise the real
// Better Auth handler and hooks. `tripLimit` and `guestExpiresAt` are
// server-managed columns; a client must never be able to set them.

import { eq } from "drizzle-orm";
import { users } from "../../db/schema";
import { auth } from "../../lib/auth";
import { cleanupTables, getTestDb, teardownTestDb } from "./setup";

const BASE_URL = "http://localhost:3000";
const FAR_FUTURE = "2099-01-01T00:00:00.000Z";

function sessionCookieFrom(headers: Headers): string {
  const pairs: string[] = [];
  headers.forEach((value, name) => {
    if (name.toLowerCase() === "set-cookie") {
      pairs.push(value.split(";")[0].trim());
    }
  });
  return pairs.join("; ");
}

async function signUp(
  overrides: Record<string, unknown> = {},
): Promise<{ response: Response; userId: string | null; sessionCookie: string }> {
  const response = await auth.handler(
    new Request(`${BASE_URL}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "fields@test.com",
        password: "password-1234",
        name: "Fields User",
        username: "fieldsuser",
        ...overrides,
      }),
    }),
  );
  if (!response.ok) {
    return { response, userId: null, sessionCookie: "" };
  }
  const body: { user: { id: string } } = await response.clone().json();
  return { response, userId: body.user.id, sessionCookie: sessionCookieFrom(response.headers) };
}

async function signInAnonymously(): Promise<{ userId: string; sessionCookie: string }> {
  const response = await auth.handler(
    new Request(`${BASE_URL}/api/auth/sign-in/anonymous`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    }),
  );
  const body: { user: { id: string } } = await response.json();
  return { userId: body.user.id, sessionCookie: sessionCookieFrom(response.headers) };
}

function postUpdateUser(sessionCookie: string, body: Record<string, unknown>) {
  return auth.handler(
    new Request(`${BASE_URL}/api/auth/update-user`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: sessionCookie,
        Origin: BASE_URL,
      },
      body: JSON.stringify(body),
    }),
  );
}

async function findUser(userId: string) {
  const [row] = await getTestDb().select().from(users).where(eq(users.id, userId));
  return row;
}

describe("user server-managed fields (integration)", () => {
  beforeEach(async () => {
    await cleanupTables();
  });

  afterAll(async () => {
    await cleanupTables();
    await teardownTestDb();
  });

  describe("POST /update-user", () => {
    it("rejects a request that sets tripLimit", async () => {
      const { sessionCookie } = await signUp();

      const res = await postUpdateUser(sessionCookie, { tripLimit: 100000 });

      expect(res.status).toBe(400);
    });

    it("does not change tripLimit when the request sets it", async () => {
      const { userId, sessionCookie } = await signUp();
      if (!userId) throw new Error("sign-up failed");

      await postUpdateUser(sessionCookie, { tripLimit: 100000 });

      expect((await findUser(userId)).tripLimit).toBeNull();
    });

    it("rejects a request that sets guestExpiresAt", async () => {
      const { sessionCookie } = await signInAnonymously();

      const res = await postUpdateUser(sessionCookie, { guestExpiresAt: FAR_FUTURE });

      expect(res.status).toBe(400);
    });

    it("does not extend guestExpiresAt when the request sets it", async () => {
      const { userId, sessionCookie } = await signInAnonymously();
      const before = (await findUser(userId)).guestExpiresAt;

      await postUpdateUser(sessionCookie, { guestExpiresAt: FAR_FUTURE });

      expect((await findUser(userId)).guestExpiresAt).toEqual(before);
    });

    it("still allows updating the display name", async () => {
      const { sessionCookie } = await signUp();

      const res = await postUpdateUser(sessionCookie, { name: "Renamed" });

      expect(res.status).toBe(200);
    });
  });

  describe("POST /sign-up/email", () => {
    it("rejects a request that sets tripLimit", async () => {
      const { response } = await signUp({ tripLimit: 100000 });

      expect(response.status).toBe(400);
    });

    it("rejects a request that sets guestExpiresAt", async () => {
      const { response } = await signUp({ guestExpiresAt: FAR_FUTURE });

      expect(response.status).toBe(400);
    });
  });

  describe("POST /sign-in/anonymous", () => {
    it("assigns guestExpiresAt on the server", async () => {
      const { userId } = await signInAnonymously();

      expect((await findUser(userId)).guestExpiresAt).not.toBeNull();
    });
  });

  describe("user.additionalFields config", () => {
    it("marks guestExpiresAt as not client-settable", () => {
      expect(auth.options.user?.additionalFields?.guestExpiresAt?.input).toBe(false);
    });

    it("marks tripLimit as not client-settable", () => {
      expect(auth.options.user?.additionalFields?.tripLimit?.input).toBe(false);
    });
  });

  describe("databaseHooks.user.update.before", () => {
    const beforeUserUpdate = auth.options.databaseHooks?.user?.update?.before;

    it("rejects an update that contains tripLimit", async () => {
      await expect(beforeUserUpdate?.({ tripLimit: 5 })).rejects.toThrow();
    });

    it("rejects an update that contains guestExpiresAt", async () => {
      await expect(beforeUserUpdate?.({ guestExpiresAt: new Date(FAR_FUTURE) })).rejects.toThrow();
    });

    it("lets an unrelated update through", async () => {
      await expect(beforeUserUpdate?.({ name: "Renamed" })).resolves.toBeUndefined();
    });
  });
});
