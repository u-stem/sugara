import { Hono } from "hono";
import { getAppSettings } from "../lib/app-settings";
import { auth } from "../lib/auth";
import { ERROR_MSG } from "../lib/constants";
import { rateLimitByIp } from "../middleware/rate-limit";

const authRoutes = new Hono();

// Per-path rate limits — these previously lived in Better Auth's `customRules`
// but were moved here so they can share the Upstash Redis store across
// serverless instances. Hono runs every matching middleware in registration
// order, so a request to /api/auth/sign-in/anonymous consumes all three
// matching counters (max:3, max:5, max:30). When tuning these values, treat
// the broader buckets (max:30) as a global ceiling for the whole auth surface
// rather than as an additional allowance. get-session is the one exception:
// it has its own dedicated bucket and is excluded from the broad ceiling (see
// below).
authRoutes.use("/api/auth/sign-in/anonymous", rateLimitByIp({ window: 60, max: 3 }));
authRoutes.use("/api/auth/sign-up/*", rateLimitByIp({ window: 60, max: 3 }));
authRoutes.use("/api/auth/change-password", rateLimitByIp({ window: 60, max: 3 }));
authRoutes.use("/api/auth/sign-in/*", rateLimitByIp({ window: 60, max: 5 }));
// get-session is a side-effect-free read that fires multiple times per page
// load (proxy guard + client bootstrap), so its cost model is nothing like the
// write-path endpoints above. Counting it against the broad 30/min ceiling
// capped legitimate browsing at ~15 page loads per IP-minute, which 429s users
// behind shared egress IPs (offices, schools, mobile CGNAT). It gets its own
// high ceiling instead — same order of magnitude as the v1 API read limit (#161).
const GET_SESSION_PATH = "/api/auth/get-session";
// Hono's use() with a literal path matches that exact path only (no prefix /
// trailing-slash matching), which keeps it consistent with the strict-equality
// guard in the broad middleware below. Keep both in sync if this ever changes.
authRoutes.use(GET_SESSION_PATH, rateLimitByIp({ window: 60, max: 300 }));
// The broad ceiling covers every other auth operation. E2E suites drive far
// more sign-ups/sign-ins per IP-minute than real browsing (one fresh account
// per test from a single runner IP), so they may raise it explicitly via env;
// production never sets this and keeps the default of 30. Only positive
// integers are honored (a stray "-5" or "0" must not zero out the auth
// surface). No NODE_ENV gate: CI runs the e2e suite against a production
// build (`next start`), so gating on NODE_ENV would disable the knob there.
function resolveBroadAuthLimit(): number {
  const parsed = Number(process.env.E2E_AUTH_RATE_LIMIT_MAX);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 30;
}
const broadAuthRateLimit = rateLimitByIp({ window: 60, max: resolveBroadAuthLimit() });
authRoutes.use("/api/auth/*", (c, next) => {
  // get-session is governed solely by its dedicated bucket above; letting it
  // also drain the broad bucket would starve sign-in/sign-up for the same IP.
  if (c.req.path === GET_SESSION_PATH) return next();
  return broadAuthRateLimit(c, next);
});

// Block email/password signup when the admin has disabled new registrations.
// Anonymous sign-in (/api/auth/sign-in/anonymous) is intentionally not blocked
// because guest accounts are ephemeral (7-day TTL) and accumulate minimal data.
authRoutes.post("/api/auth/sign-up/*", async (c, next) => {
  // Fail-closed on DB errors: a DB failure is a systemic issue that warrants
  // blocking signup rather than silently allowing registrations.
  const { signupEnabled } = await getAppSettings().catch(() => ({ signupEnabled: false }));
  if (!signupEnabled) {
    return c.json({ error: ERROR_MSG.SIGNUP_DISABLED }, 403);
  }
  return next();
});

authRoutes.on(["POST", "GET"], "/api/auth/*", (c) => {
  return auth.handler(c.req.raw);
});

export { authRoutes };
