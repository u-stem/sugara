import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestApp } from "../__tests__/test-helpers";
import {
  buildIssueContent,
  parseSentryPayload,
  sentryIssueMarker,
  verifySentrySignature,
} from "../lib/sentry-webhook";

const SECRET = "test-secret";

vi.mock("../lib/env", () => ({
  // Literal, not the SECRET const: vi.mock is hoisted above const initialization.
  env: {
    SENTRY_WEBHOOK_SECRET: "test-secret",
    GITHUB_TOKEN: "gh-token",
    GITHUB_SENTRY_REPO: "owner/repo",
  },
}));

const globalMockFetch = vi.fn();
vi.stubGlobal("fetch", globalMockFetch);

import { sentryWebhookRoutes } from "./sentry-webhook";

function sign(body: string): string {
  return createHmac("sha256", SECRET).update(body, "utf8").digest("hex");
}

const validPayload = {
  data: {
    event: {
      issue_id: 123456,
      title: "TypeError: undefined is not a function",
      culprit: "app/page.tsx",
      level: "error",
      environment: "production",
      web_url: "https://sentry.io/organizations/x/issues/123456/",
    },
  },
};

function post(body: string, signature?: string) {
  const app = createTestApp(sentryWebhookRoutes, "/api");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (signature !== undefined) headers["sentry-hook-signature"] = signature;
  return app.request("/api/sentry-webhook", { method: "POST", headers, body });
}

function jsonResponse(data: unknown, ok = true, status = 200) {
  return { ok, status, json: () => Promise.resolve(data) };
}

describe("POST /api/sentry-webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when the signature is missing", async () => {
    const res = await post(JSON.stringify(validPayload));
    expect(res.status).toBe(401);
  });

  it("returns 401 when the signature does not match", async () => {
    const res = await post(JSON.stringify(validPayload), "deadbeef");
    expect(res.status).toBe(401);
  });

  it("returns 400 when the body is not valid JSON", async () => {
    const body = "not-json";
    const res = await post(body, sign(body));
    expect(res.status).toBe(400);
  });

  it("creates a GitHub issue and returns 201 for a new Sentry issue", async () => {
    // First call: dedupe search finds nothing. Second call: issue creation.
    globalMockFetch
      .mockResolvedValueOnce(jsonResponse({ items: [] }))
      .mockResolvedValueOnce(jsonResponse({ html_url: "https://github.com/owner/repo/issues/1" }));

    const body = JSON.stringify(validPayload);
    const res = await post(body, sign(body));

    expect(res.status).toBe(201);
  });

  it("posts to the GitHub issues endpoint with the sentry label", async () => {
    globalMockFetch
      .mockResolvedValueOnce(jsonResponse({ items: [] }))
      .mockResolvedValueOnce(jsonResponse({ html_url: "https://github.com/owner/repo/issues/1" }));

    const body = JSON.stringify(validPayload);
    await post(body, sign(body));

    const createCall = globalMockFetch.mock.calls[1];
    expect(JSON.parse(createCall[1].body).labels).toEqual(["sentry"]);
  });

  it("skips creation and returns 200 when a matching issue already exists", async () => {
    globalMockFetch.mockResolvedValueOnce(
      jsonResponse({ items: [{ html_url: "https://github.com/owner/repo/issues/9" }] }),
    );

    const body = JSON.stringify(validPayload);
    const res = await post(body, sign(body));

    expect(res.status).toBe(200);
  });

  it("does not call the issue-creation endpoint when a duplicate exists", async () => {
    globalMockFetch.mockResolvedValueOnce(
      jsonResponse({ items: [{ html_url: "https://github.com/owner/repo/issues/9" }] }),
    );

    const body = JSON.stringify(validPayload);
    await post(body, sign(body));

    expect(globalMockFetch).toHaveBeenCalledTimes(1);
  });
});

describe("verifySentrySignature", () => {
  it("accepts a correct HMAC-SHA256 signature", () => {
    const body = "payload";
    expect(verifySentrySignature(body, sign(body), SECRET)).toBe(true);
  });

  it("rejects a tampered body", () => {
    const signature = sign("payload");
    expect(verifySentrySignature("tampered", signature, SECRET)).toBe(false);
  });

  it("rejects a missing signature", () => {
    expect(verifySentrySignature("payload", undefined, SECRET)).toBe(false);
  });
});

describe("parseSentryPayload", () => {
  it("extracts the issue id from the event shape", () => {
    const result = parseSentryPayload(validPayload);
    expect(result?.issueId).toBe("123456");
  });

  it("falls back to the issue shape when no event is present", () => {
    const result = parseSentryPayload({
      data: { issue: { id: "abc", title: "Boom", permalink: "https://sentry.io/x" } },
    });
    expect(result?.webUrl).toBe("https://sentry.io/x");
  });

  it("returns null when no identifiable issue is present", () => {
    expect(parseSentryPayload({ data: {} })).toBeNull();
  });
});

describe("buildIssueContent", () => {
  it("embeds a dedupe marker carrying the issue id", () => {
    const issue = parseSentryPayload(validPayload);
    if (!issue) throw new Error("expected a parsed issue");
    const { body } = buildIssueContent(issue);
    expect(body).toContain(sentryIssueMarker("123456"));
  });
});
