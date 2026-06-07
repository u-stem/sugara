import {
  buildDiscordEmbed,
  NOTIFICATION_DEFAULTS,
  type NotificationType,
  PUSH_MSG,
} from "@sugara/shared";
import { and, asc, eq, inArray } from "drizzle-orm";
import webpush from "web-push";
import { db } from "../db/index";
import {
  articleTrips,
  discordWebhooks,
  notificationPreferences,
  notifications,
  pushSubscriptions,
  tripMembers,
  trips,
} from "../db/schema";
import { sendDiscordWebhook } from "./discord";
import { env } from "./env";
import { logger } from "./logger";

const MAX_NOTIFICATIONS_PER_USER = 100;

// Lazy VAPID setup: configured on first push send to avoid crashing at import
// when VAPID env vars are absent (e.g. in unit tests).
let vapidConfigured = false;
function ensureVapid() {
  if (!vapidConfigured && env.VAPID_PUBLIC_KEY) {
    webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
    vapidConfigured = true;
  }
}

export type NotificationPayload = {
  actorName?: string;
  tripName?: string;
  entityName?: string;
  newRole?: string;
  [key: string]: string | undefined;
};

type CreateNotificationParams = {
  type: NotificationType;
  userId: string;
  tripId?: string;
  payload: NotificationPayload;
};

// Sends a Discord embed for the trip's configured webhook, if active and subscribed to the type.
// Called once per event, outside the per-user notification loop.
async function sendDiscordForTrip(params: {
  type: NotificationType;
  tripId: string;
  payload: NotificationPayload;
}): Promise<void> {
  try {
    const webhook = await db.query.discordWebhooks.findFirst({
      where: eq(discordWebhooks.tripId, params.tripId),
    });

    if (!webhook || !webhook.isActive) return;

    const enabledTypes = webhook.enabledTypes as string[];
    if (!enabledTypes.includes(params.type)) return;

    const embed = buildDiscordEmbed({
      type: params.type,
      payload: params.payload,
      tripId: params.tripId,
      locale: webhook.locale,
      baseUrl: env.FRONTEND_URL,
    });

    await sendDiscordWebhook({
      webhookId: webhook.id,
      webhookUrl: webhook.webhookUrl,
      embed,
    });
  } catch (err) {
    logger.error({ err, tripId: params.tripId }, "Failed to send Discord notification");
  }
}

/**
 * Fire-and-forget: fetch trip title then notify multiple users.
 * Use when recipient userIds are already known (e.g. expense splits, member add/remove).
 */
export function notifyUsers(params: {
  type: NotificationType;
  tripId: string;
  userIds: string[];
  makePayload: (tripName: string) => NotificationPayload;
}): void {
  const { type, tripId, userIds, makePayload } = params;
  if (userIds.length === 0) return;
  void db.query.trips
    .findFirst({ where: eq(trips.id, tripId), columns: { title: true } })
    .then((trip) => {
      const tripName = trip?.title ?? "旅行";
      void sendDiscordForTrip({ type, tripId, payload: makePayload(tripName) });
      void Promise.all(
        userIds.map((userId) =>
          createNotification({ type, userId, tripId, payload: makePayload(tripName) }),
        ),
      );
    });
}

/**
 * Fire-and-forget: fetch all trip members and trip title in parallel,
 * then notify all members except the actor.
 * Use when recipient list = all trip members (e.g. schedule create/update/delete).
 */
export function notifyTripMembersExcluding(params: {
  type: NotificationType;
  tripId: string;
  actorId: string;
  makePayload: (tripName: string) => NotificationPayload;
}): void {
  const { type, tripId, actorId, makePayload } = params;
  void (async () => {
    const [members, trip] = await Promise.all([
      db.query.tripMembers.findMany({
        where: eq(tripMembers.tripId, tripId),
        columns: { userId: true },
      }),
      db.query.trips.findFirst({ where: eq(trips.id, tripId), columns: { title: true } }),
    ]);
    const tripName = trip?.title ?? "旅行";
    void sendDiscordForTrip({ type, tripId, payload: makePayload(tripName) });
    await Promise.all(
      members
        .filter((m) => m.userId !== actorId)
        .map((m) =>
          createNotification({ type, userId: m.userId, tripId, payload: makePayload(tripName) }),
        ),
    );
  })();
}

/**
 * Fire-and-forget notification creation. Errors are caught internally.
 */
export function createNotification(params: CreateNotificationParams): Promise<void> {
  return createNotificationInternal(params).catch((err) => {
    logger.error({ err, type: params.type }, "Notification creation failed");
  });
}

/**
 * C-2 helper: notify owners of non-public articles linked to `tripId` when new
 * members are added (manual POST or automatic poll confirmation). Fire-and-forget.
 *
 * - addedUserIds: the users who just joined; they are excluded from receiving
 *   notifications about their own articles.
 * - memberName: display name for the new member shown in the notification body.
 * - excludeOwnerId: when the actor who performed the add also owns articles
 *   linked to this trip, suppress that self-notification. Pass the actor's id
 *   for manual member adds; omit for poll auto-joins where notifying the
 *   poll-confirmer about their own article is meaningful.
 */
export async function notifyArticleOwnersOnMemberAdded(params: {
  tripId: string;
  addedUserIds: string[];
  memberName?: string;
  excludeOwnerId?: string;
}): Promise<void> {
  const { tripId, addedUserIds, memberName, excludeOwnerId } = params;
  if (addedUserIds.length === 0) return;

  const addedSet = new Set(addedUserIds);

  const linkedArticleRows = await db.query.articleTrips.findMany({
    where: eq(articleTrips.tripId, tripId),
    with: {
      article: { columns: { id: true, ownerId: true, title: true, visibility: true } },
    },
  });

  for (const { article } of linkedArticleRows) {
    // Public articles are already visible to everyone; no notification needed.
    if (article.visibility === "public") continue;
    // Don't notify an added user about their own article becoming visible.
    if (addedSet.has(article.ownerId)) continue;
    // Suppress self-notification for the actor performing a manual member add
    // (e.g. trip owner adding someone to a trip that has their own articles).
    if (excludeOwnerId !== undefined && article.ownerId === excludeOwnerId) continue;

    notifyUsers({
      type: "article_shared_member_added",
      tripId,
      userIds: [article.ownerId],
      makePayload: (tripName) => ({
        tripName,
        articleId: article.id,
        articleTitle: article.title,
        memberName: memberName ?? "",
      }),
    });
  }
}

function buildPushMessage(
  type: NotificationType,
  payload: NotificationPayload,
  tripId?: string,
): { title: string; body: string; url: string } {
  const tripUrl = tripId ? `/trips/${tripId}` : "/";
  return {
    title: payload.tripName ?? "旅行",
    body: PUSH_MSG[type](payload),
    url: type === "member_removed" ? "/" : tripUrl,
  };
}

async function createNotificationInternal(params: CreateNotificationParams): Promise<void> {
  const { type, userId, tripId, payload } = params;

  const pref = await db.query.notificationPreferences.findFirst({
    where: and(eq(notificationPreferences.userId, userId), eq(notificationPreferences.type, type)),
  });

  const inAppEnabled = pref?.inApp ?? NOTIFICATION_DEFAULTS[type].inApp;

  if (inAppEnabled) {
    await db.insert(notifications).values({ userId, tripId, type, payload });
    pruneOldNotifications(userId).catch((err) => {
      logger.error({ err }, "Notification pruning failed");
    });
  }

  sendPushToUser(userId, type, payload, tripId).catch((err) => {
    logger.error({ err }, "Push notification failed");
  });
}

async function pruneOldNotifications(userId: string): Promise<void> {
  const all = await db.query.notifications.findMany({
    where: eq(notifications.userId, userId),
    orderBy: [asc(notifications.createdAt)],
    columns: { id: true },
  });

  const excess = all.length - MAX_NOTIFICATIONS_PER_USER;
  if (excess <= 0) return;

  await db.delete(notifications).where(
    inArray(
      notifications.id,
      all.slice(0, excess).map((n) => n.id),
    ),
  );
}

async function sendPushToUser(
  userId: string,
  type: NotificationType,
  payload: NotificationPayload,
  tripId?: string,
): Promise<void> {
  ensureVapid();
  const subs = await db.query.pushSubscriptions.findMany({
    where: eq(pushSubscriptions.userId, userId),
  });
  if (subs.length === 0) return;

  // Filter subscriptions by per-device preferences, falling back to global defaults
  const enabledSubs = subs.filter(
    (sub) => (sub.preferences as Record<string, boolean>)[type] ?? NOTIFICATION_DEFAULTS[type].push,
  );
  if (enabledSubs.length === 0) return;

  const message = buildPushMessage(type, payload, tripId);
  await Promise.allSettled(
    enabledSubs.map((sub) =>
      webpush
        .sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(message),
        )
        .catch(async (err: unknown) => {
          // 410 Gone / 404 Not Found means the subscription has expired; remove it
          const status = (err as { statusCode?: number })?.statusCode;
          if (status === 410 || status === 404) {
            await db
              .delete(pushSubscriptions)
              .where(
                and(
                  eq(pushSubscriptions.endpoint, sub.endpoint),
                  eq(pushSubscriptions.userId, userId),
                ),
              );
          }
        }),
    ),
  );
}
