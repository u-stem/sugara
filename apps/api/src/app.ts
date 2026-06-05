import { Hono } from "hono";
import { cors } from "hono/cors";
import { env } from "./lib/env";
import { handleError } from "./lib/error-handler";
import { requestLogger } from "./middleware/request-logger";
import { accountRoutes } from "./routes/account";
import { activityLogRoutes } from "./routes/activity-logs";
import { adminRoutes } from "./routes/admin";
import { announcementRoutes } from "./routes/announcement";
import { authRoutes } from "./routes/auth";
import { bookmarkListRoutes } from "./routes/bookmark-lists";
import { bookmarkRoutes } from "./routes/bookmarks";
import { candidateRoutes } from "./routes/candidates";
import { directionsRoutes } from "./routes/directions";
import { discordWebhookRoutes } from "./routes/discord-webhook";
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
import { settlementPaymentRoutes, unsettledSummaryRoutes } from "./routes/settlement-payments";
import { shareRoutes } from "./routes/share";
import { souvenirRoutes } from "./routes/souvenirs";
import { tripDayRoutes } from "./routes/trip-days";
import { tripRoutes } from "./routes/trips";

const app = new Hono<{ Variables: { requestId: string } }>();

app.use(
  "*",
  cors({
    origin: env.FRONTEND_URL,
    credentials: true,
  }),
);

app.use("*", requestLogger());

app.onError(handleError);

// Hono is mounted at /api/[[...route]] and sees the full path including /api, so this needs
// the /api prefix to be reachable externally (e.g. post-deploy smoke checks).
app.get("/api/health", (c) => {
  return c.json({ status: "ok" });
});

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
app.route("/api/users", profileRoutes);
app.route("/api/users", unsettledSummaryRoutes);
app.route("/api", accountRoutes);
app.route("/api", feedbackRoutes);
app.route("/api", ogpRoutes);
app.route("/api/directions", directionsRoutes);
app.route("/api/exchange-rate", exchangeRateRoutes);
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

export { app };
