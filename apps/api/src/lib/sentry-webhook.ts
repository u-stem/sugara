import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

// Sentry signs Internal Integration webhook requests with an HMAC-SHA256 of the
// raw request body, keyed by the integration's client secret, sent in the
// `sentry-hook-signature` header as a hex digest.
export function verifySentrySignature(
  rawBody: string,
  signature: string | undefined,
  secret: string,
): boolean {
  if (!signature) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");
  // timingSafeEqual throws on length mismatch; guard first to keep it constant-time-ish.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// Sentry's alert-rule webhook payload varies by resource. We read loosely and
// tolerate either an `event` (event_alert) or an `issue` (issue) shape, plus the
// snake_case field aliases Sentry uses.
const sentryPayloadSchema = z.object({
  data: z.object({
    event: z
      .object({
        issue_id: z.union([z.string(), z.number()]).optional(),
        title: z.string().optional(),
        culprit: z.string().optional(),
        level: z.string().optional(),
        environment: z.string().optional(),
        web_url: z.string().optional(),
        url: z.string().optional(),
      })
      .optional(),
    issue: z
      .object({
        id: z.union([z.string(), z.number()]).optional(),
        title: z.string().optional(),
        culprit: z.string().optional(),
        level: z.string().optional(),
        permalink: z.string().optional(),
      })
      .optional(),
  }),
});

export type SentryIssue = {
  issueId: string;
  title: string;
  culprit: string | null;
  level: string | null;
  environment: string | null;
  webUrl: string | null;
};

// Extracts the fields we need from a parsed Sentry payload. Returns null when the
// payload does not carry an identifiable issue (nothing to file).
export function parseSentryPayload(json: unknown): SentryIssue | null {
  const parsed = sentryPayloadSchema.safeParse(json);
  if (!parsed.success) return null;

  const { event, issue } = parsed.data.data;
  const rawId = event?.issue_id ?? issue?.id;
  if (rawId === undefined) return null;

  const title = event?.title ?? issue?.title;
  if (!title) return null;

  return {
    issueId: String(rawId),
    title,
    culprit: event?.culprit ?? issue?.culprit ?? null,
    level: event?.level ?? issue?.level ?? null,
    environment: event?.environment ?? null,
    webUrl: event?.web_url ?? event?.url ?? issue?.permalink ?? null,
  };
}

// Hidden marker embedded in the issue body so repeated alerts for the same Sentry
// issue can be deduped via GitHub search.
export function sentryIssueMarker(issueId: string): string {
  return `<!-- sentry-issue:${issueId} -->`;
}

export function buildIssueContent(issue: SentryIssue): { title: string; body: string } {
  const title = `[Sentry] ${issue.title}`;
  const lines = [
    issue.webUrl ? `**Sentry**: ${issue.webUrl}` : null,
    issue.culprit ? `**Culprit**: \`${issue.culprit}\`` : null,
    issue.level ? `**Level**: ${issue.level}` : null,
    issue.environment ? `**Environment**: ${issue.environment}` : null,
    "",
    sentryIssueMarker(issue.issueId),
  ].filter((line): line is string => line !== null);

  return { title, body: lines.join("\n") };
}
