import { Hono } from "hono";
import { cors } from "hono/cors";
import { env } from "./lib/env";
import { handleError } from "./lib/error-handler";
import { requestLogger } from "./middleware/request-logger";
import { accountRoutes } from "./routes/account";
import { activityLogRoutes } from "./routes/activity-logs";
import { adminRoutes } from "./routes/admin";
import { announcementRoutes } from "./routes/announcement";
import { apiKeyRoutes } from "./routes/api-keys";
import { articleRoutes, tripArticleRoutes } from "./routes/articles";
import { authRoutes } from "./routes/auth";
import { bookmarkListRoutes } from "./routes/bookmark-lists";
import { bookmarkRoutes } from "./routes/bookmarks";
import { candidateRoutes } from "./routes/candidates";
import { cronRoutes } from "./routes/cron";
import { directionsRoutes } from "./routes/directions";
import { discordWebhookRoutes } from "./routes/discord-webhook";
import { docsRoutes } from "./routes/docs";
import { exchangeRateRoutes } from "./routes/exchange-rate";
import { expenseRoutes } from "./routes/expenses";
import { faqRoutes } from "./routes/faqs";
import { feedbackRoutes } from "./routes/feedback";
import { friendRoutes } from "./routes/friends";
import { groupRoutes } from "./routes/groups";
import { memberRoutes } from "./routes/members";
import { notificationPreferenceRoutes } from "./routes/notification-preferences";
import { notificationRoutes } from "./routes/notifications";
import { ogpRoutes } from "./routes/ogp";
import { patternRoutes } from "./routes/patterns";
import { pollShareRoutes } from "./routes/poll-share";
import { pollRoutes } from "./routes/polls";
import { profileRoutes } from "./routes/profile";
import { publicSettingsRoutes } from "./routes/public-settings";
import { pushSubscriptionRoutes } from "./routes/push-subscriptions";
import { quickPollShareRoutes } from "./routes/quick-poll-share";
import { quickPollRoutes } from "./routes/quick-polls";
import { reactionRoutes } from "./routes/reactions";
import { scheduleRoutes } from "./routes/schedules";
import { sentryWebhookRoutes } from "./routes/sentry-webhook";
import { settlementPaymentRoutes, unsettledSummaryRoutes } from "./routes/settlement-payments";
import { shareRoutes } from "./routes/share";
import { souvenirRoutes } from "./routes/souvenirs";
import { tripDayRoutes } from "./routes/trip-days";
import { tripRoutes } from "./routes/trips";
import { v1App } from "./routes/v1/index";
import { weatherRoutes } from "./routes/weather";
import type { AppEnv } from "./types";

// Typed as AppEnv so that middleware context in this file is compatible with
// MiddlewareHandler<AppEnv> (e.g. requestLogger). Variables set by later
// middleware (user, session, tripRole) are intentionally absent at this layer
// in practice, but the type widening causes no real harm since app.ts never
// reads those variables itself.
const app = new Hono<AppEnv>();

// v1 runs as an isolated Hono instance with its own onError. The parent's cors
// and requestLogger middleware must NOT apply to /api/v1 paths because:
//   (a) cors would attach Access-Control-Allow-Origin to external-API responses,
//       contradicting the "server-to-server only, no CORS" policy (§0 / §7).
//   (b) middleware exceptions thrown by the parent are caught by the parent's
//       handleError, not by v1App.onError, leaking internal error shapes (§3.1).
// Inline factory calls (not cached variables) avoid any stored-instance type
// mismatch; the wrapper's c: Context<AppEnv> satisfies MiddlewareHandler<AppEnv>.
app.use("*", (c, next) => {
  if (c.req.path.startsWith("/api/v1")) return next();
  return cors({ origin: env.FRONTEND_URL, credentials: true })(c, next);
});
app.use("*", (c, next) => {
  if (c.req.path.startsWith("/api/v1")) return next();
  return requestLogger()(c, next);
});

app.onError(handleError);

// Hono is mounted at /api/[[...route]] and sees the full path including /api, so this needs
// the /api prefix to be reachable externally (e.g. post-deploy smoke checks).
app.get("/api/health", (c) => {
  return c.json({ status: "ok" });
});

// v1 is mounted BEFORE all internal routers. Hono runs matching handlers in
// registration order, so mounting v1 first guarantees no sibling router's
// wildcard middleware (e.g. a use("*", requireAuth) under the "/api" prefix)
// can run ahead of v1's Bearer auth and intercept /api/v1 requests with the
// internal cookie-auth response. v1's own catch-all terminates every /api/v1
// path, so nothing falls through to the routers below.
app.route("/api/v1", v1App);

app.route("/", authRoutes);
app.route("/api/trips", tripRoutes);
app.route("/api/trips", patternRoutes);
app.route("/api/trips", scheduleRoutes);
app.route("/api/trips", candidateRoutes);
app.route("/api/trips", reactionRoutes);
app.route("/api/trips", memberRoutes);
app.route("/api/trips", tripDayRoutes);
app.route("/api/trips", activityLogRoutes);
app.route("/api/trips", expenseRoutes);
app.route("/api/trips", settlementPaymentRoutes);
app.route("/api/trips", souvenirRoutes);
app.route("/api/trips", discordWebhookRoutes);
app.route("/api/polls", pollRoutes);
app.route("/api/quick-polls", quickPollRoutes);
app.route("/api/friends", friendRoutes);
app.route("/api/groups", groupRoutes);
app.route("/api/bookmark-lists", bookmarkListRoutes);
app.route("/api/bookmark-lists", bookmarkRoutes);
app.route("/api/articles", articleRoutes); // articleDetailRoutes is embedded inside articleRoutes
app.route("/api/trips", tripArticleRoutes);
app.route("/api/users", profileRoutes);
app.route("/api/users", unsettledSummaryRoutes);
app.route("/api", accountRoutes);
app.route("/api", feedbackRoutes);
app.route("/api", sentryWebhookRoutes);
app.route("/api", cronRoutes);
app.route("/api", ogpRoutes);
app.route("/api/directions", directionsRoutes);
app.route("/api/exchange-rate", exchangeRateRoutes);
app.route("/api/weather", weatherRoutes);
app.route("/api/notifications", notificationRoutes);
app.route("/api/push-subscriptions", pushSubscriptionRoutes);
app.route("/api/notification-preferences", notificationPreferenceRoutes);
app.route("/", shareRoutes);
app.route("/", pollShareRoutes);
app.route("/", quickPollShareRoutes);
app.route("/", publicSettingsRoutes);
app.route("/", adminRoutes);
app.route("/", faqRoutes);
app.route("/", announcementRoutes);
app.route("/api/api-keys", apiKeyRoutes);

// _docs is mounted after all internal routers. It has no interference with v1
// (different prefix) and its per-route requireAuth + requireNonGuest guards mean
// no wildcard auth can leak out to siblings.
app.route("/api/_docs", docsRoutes);

export { app };
