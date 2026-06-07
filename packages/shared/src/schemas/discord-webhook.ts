import { z } from "zod";
import { notificationTypeSchema } from "./notification";

// Filter out types that should never be delivered via Discord:
// - discord_webhook_disabled: prevents recursive notification loops
// - article_shared_member_added: article-scoped notice, not relevant at trip level
const DISCORD_EXCLUDED_TYPES = new Set(["discord_webhook_disabled", "article_shared_member_added"]);
const discordEnabledTypeValues = notificationTypeSchema.options.filter(
  (t) => !DISCORD_EXCLUDED_TYPES.has(t),
);

export const discordEnabledTypeSchema = z.enum(discordEnabledTypeValues as [string, ...string[]]);

export type DiscordEnabledType = z.infer<typeof discordEnabledTypeSchema>;

export const DISCORD_ENABLED_TYPES_DEFAULT: DiscordEnabledType[] = [
  "member_added",
  "member_removed",
  "expense_added",
  "settlement_checked",
  "poll_started",
  "poll_closed",
];

export const discordWebhookUrlSchema = z
  .string()
  .url()
  .regex(
    /^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\/\d+\/[\w-]+$/,
    "Must be a Discord Webhook URL",
  );

export const localeSchema = z.enum(["ja", "en"]);

export const createDiscordWebhookSchema = z.object({
  webhookUrl: discordWebhookUrlSchema,
  enabledTypes: z.array(discordEnabledTypeSchema).min(1),
  locale: localeSchema.optional().default("ja"),
});

export type CreateDiscordWebhook = z.infer<typeof createDiscordWebhookSchema>;

export const updateDiscordWebhookSchema = z.object({
  webhookUrl: discordWebhookUrlSchema.optional(),
  enabledTypes: z.array(discordEnabledTypeSchema).min(1).optional(),
  locale: localeSchema.optional(),
  isActive: z.boolean().optional(),
});

export type UpdateDiscordWebhook = z.infer<typeof updateDiscordWebhookSchema>;

export function maskWebhookUrl(url: string): string {
  const parts = url.split("/");
  const token = parts.at(-1) ?? "";
  return `...${token.slice(-8)}`;
}
