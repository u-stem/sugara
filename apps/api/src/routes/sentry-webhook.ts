import { ERROR_MSG } from "@sugara/shared";
import { Hono } from "hono";
import { env } from "../lib/env";
import { createGithubIssue, findGithubIssueByMarker, REPO_FORMAT } from "../lib/github";
import { logger } from "../lib/logger";
import {
  buildIssueContent,
  parseSentryPayload,
  sentryIssueMarker,
  verifySentrySignature,
} from "../lib/sentry-webhook";

export const sentryWebhookRoutes = new Hono();

// Receives Sentry Internal Integration alert webhooks and files them as GitHub
// issues. No requireAuth: this is an external POST from Sentry, gated by the
// HMAC signature instead.
sentryWebhookRoutes.post("/sentry-webhook", async (c) => {
  const secret = env.SENTRY_WEBHOOK_SECRET;
  if (!secret) {
    return c.json({ error: ERROR_MSG.SENTRY_NOT_CONFIGURED }, 503);
  }

  // HMAC is over the raw body, so read text before any JSON parsing.
  const raw = await c.req.text();
  const signature = c.req.header("sentry-hook-signature");
  if (!verifySentrySignature(raw, signature, secret)) {
    return c.json({ error: ERROR_MSG.SENTRY_INVALID_SIGNATURE }, 401);
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return c.json({ error: ERROR_MSG.INVALID_JSON }, 400);
  }

  const issue = parseSentryPayload(json);
  if (!issue) {
    return c.json({ error: ERROR_MSG.INVALID_JSON }, 400);
  }

  const token = env.GITHUB_TOKEN;
  const repo = env.GITHUB_SENTRY_REPO;
  if (!token || !repo || !REPO_FORMAT.test(repo)) {
    return c.json({ error: ERROR_MSG.GITHUB_NOT_CONFIGURED }, 500);
  }

  const existing = await findGithubIssueByMarker({
    token,
    repo,
    marker: sentryIssueMarker(issue.issueId),
  });
  if (existing) {
    return c.json({ skipped: true, url: existing }, 200);
  }

  const { title, body } = buildIssueContent(issue);
  const url = await createGithubIssue({ token, repo, title, body, labels: ["sentry"] });
  if (!url) {
    logger.error({ issueId: issue.issueId }, "Failed to create Sentry GitHub issue");
    return c.json({ error: ERROR_MSG.GITHUB_API_FAILED }, 502);
  }

  return c.json({ url }, 201);
});
