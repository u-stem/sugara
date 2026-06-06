import { createHmac, timingSafeEqual } from "node:crypto";

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

export type SentryIssue = {
  issueId: string;
  title: string;
  culprit: string | null;
  level: string | null;
  environment: string | null;
  webUrl: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

// Sentry's id can arrive as a string or a number depending on the resource.
function asId(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return null;
}

// Sentry's alert-rule webhook payload varies by resource. We read loosely and
// tolerate either an `event` (event_alert) or an `issue` (issue) shape, plus the
// snake_case field aliases Sentry uses. Returns null when the payload does not
// carry an identifiable issue (nothing to file).
export function parseSentryPayload(json: unknown): SentryIssue | null {
  if (!isRecord(json)) return null;
  const data = json.data;
  if (!isRecord(data)) return null;

  const event = isRecord(data.event) ? data.event : null;
  const issue = isRecord(data.issue) ? data.issue : null;

  const issueId = asId(event?.issue_id) ?? asId(issue?.id);
  if (issueId === null) return null;

  const title = asString(event?.title) ?? asString(issue?.title);
  if (title === null) return null;

  return {
    issueId,
    title,
    culprit: asString(event?.culprit) ?? asString(issue?.culprit),
    level: asString(event?.level) ?? asString(issue?.level),
    environment: asString(event?.environment),
    webUrl: asString(event?.web_url) ?? asString(event?.url) ?? asString(issue?.permalink),
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
