import type { Env } from "hono";
import { Hono } from "hono";
import { handleError } from "../lib/error-handler";

export const TEST_USER = { id: "user-1", name: "Test User", email: "test@example.com" };

export function createTestApp<E extends Env>(routes: Hono<E>, prefix: string) {
  const app = new Hono();
  app.route(prefix, routes);
  // Mirror the production global error handler so routes that throw AppError are
  // serialized the same way in tests as in the real app (apps/api/src/app.ts).
  app.onError(handleError);
  return app;
}
