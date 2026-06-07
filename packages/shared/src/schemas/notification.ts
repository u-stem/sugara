import { z } from "zod";

export const notificationTypeSchema = z.enum([
  "member_added",
  "member_removed",
  "role_changed",
  "schedule_created",
  "schedule_updated",
  "schedule_deleted",
  "poll_started",
  "poll_closed",
  "expense_added",
  "settlement_checked",
  "candidate_created",
  "candidate_deleted",
  "candidate_reaction",
  "discord_webhook_disabled",
  "article_shared_member_added",
]);

export type NotificationType = z.infer<typeof notificationTypeSchema>;

export const updateNotificationPreferenceSchema = z.object({
  type: notificationTypeSchema,
  inApp: z.boolean().optional(),
});

export const createPushSubscriptionSchema = z.object({
  endpoint: z.string().url(),
  p256dh: z.string().min(1),
  auth: z.string().min(1),
});

export const updatePushSubscriptionPreferenceSchema = z.object({
  endpoint: z.string().url(),
  type: notificationTypeSchema,
  enabled: z.boolean(),
});

/**
 * Default enabled state per notification type.
 * Only membership and voting events are on by default; activity-feed events are off.
 */
export const NOTIFICATION_DEFAULTS = {
  member_added: { inApp: true, push: true },
  member_removed: { inApp: true, push: true },
  role_changed: { inApp: true, push: false },
  schedule_created: { inApp: false, push: false },
  schedule_updated: { inApp: false, push: false },
  schedule_deleted: { inApp: false, push: false },
  poll_started: { inApp: true, push: false },
  poll_closed: { inApp: true, push: false },
  expense_added: { inApp: false, push: false },
  settlement_checked: { inApp: true, push: true },
  candidate_created: { inApp: false, push: false },
  candidate_deleted: { inApp: false, push: false },
  candidate_reaction: { inApp: true, push: false },
  discord_webhook_disabled: { inApp: true, push: true },
  article_shared_member_added: { inApp: true, push: false },
} satisfies Record<NotificationType, { inApp: boolean; push: boolean }>;

/** Japanese labels for notification types, used in preference settings UI. */
export const NOTIFICATION_TYPE_LABELS: Record<string, string> = {
  member_added: "旅行に招待された",
  member_removed: "メンバーから削除された",
  role_changed: "ロールが変更された",
  schedule_created: "予定が追加された",
  schedule_updated: "予定が更新された",
  schedule_deleted: "予定が削除された",
  poll_started: "日程投票が開始された",
  poll_closed: "日程投票が終了した",
  expense_added: "費用が追加された",
  settlement_checked: "精算チェック",
  candidate_created: "候補が追加された",
  candidate_deleted: "候補が削除された",
  candidate_reaction: "候補にリアクションがついた",
  discord_webhook_disabled: "Discord通知が無効化された",
  article_shared_member_added: "記事が共有されているメンバーが追加された",
};

/**
 * Returns the in-app display text for a notification.
 * Shared between the web app and any server-side rendering that needs it.
 */
export function formatNotificationText(type: string, payload: Record<string, string>): string {
  switch (type) {
    case "member_added":
      return `${payload.actorName}さんが「${payload.tripName}」に招待しました`;
    case "member_removed":
      return `「${payload.tripName}」のメンバーから削除されました`;
    case "role_changed":
      return `「${payload.tripName}」でのロールが変更されました`;
    case "schedule_created":
      return `${payload.actorName}さんが予定「${payload.entityName}」を追加しました`;
    case "schedule_updated":
      return `${payload.actorName}さんが予定「${payload.entityName}」を更新しました`;
    case "schedule_deleted":
      return `${payload.actorName}さんが予定を削除しました`;
    case "poll_started":
      return `「${payload.tripName}」で日程投票が開始されました`;
    case "poll_closed":
      return `「${payload.tripName}」の日程投票が終了しました`;
    case "expense_added":
      return `${payload.actorName}さんが費用「${payload.entityName}」を追加しました`;
    case "settlement_checked":
      return `${payload.actorName}さんが精算をチェックしました`;
    case "candidate_created":
      return `${payload.actorName}さんが候補「${payload.entityName}」を追加しました`;
    case "candidate_deleted":
      return `${payload.actorName}さんが候補を削除しました`;
    case "candidate_reaction":
      return `${payload.actorName}さんが候補「${payload.entityName}」にリアクションしました`;
    case "discord_webhook_disabled":
      return `「${payload.tripName}」のDiscord通知が無効化されました`;
    case "article_shared_member_added":
      return `「${payload.tripName}」に${payload.memberName}さんが参加しました。記事「${payload.articleTitle}」が共有されています`;
    default:
      return "新しい通知があります";
  }
}
