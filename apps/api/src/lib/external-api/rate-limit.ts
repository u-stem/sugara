import type { MiddlewareHandler } from "hono";
import { rateLimitByIp } from "../../middleware/rate-limit";
import { ApiV1Error, type V1Env } from "./errors";

// Wraps rateLimitByIp so that 429 responses are re-raised as ApiV1Error,
// routing them through v1ErrorHandler and producing the v1 error shape
// { error: { code, message } } instead of the internal { error: string }.
// rate-limit.ts itself is not modified — internal routes keep their own shape.
export function v1RateLimit(opts: { window: number; max: number }): MiddlewareHandler<V1Env> {
  const inner = rateLimitByIp(opts);
  return async (c, next) => {
    const res = await inner(c, next);
    if (res?.status === 429) {
      throw new ApiV1Error(429, "rate_limited", "Rate limit exceeded");
    }
    return res;
  };
}
