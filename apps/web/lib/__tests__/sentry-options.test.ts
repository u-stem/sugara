import { describe, expect, it } from "vitest";
import { ApiError } from "../api";
import {
  beforeBreadcrumb,
  beforeSend,
  DATA_COLLECTION,
  isExpectedClientError,
  scrubEvent,
} from "../sentry-options";

describe("isExpectedClientError", () => {
  it("treats 4xx ApiErrors as expected (handled by UX)", () => {
    for (const status of [400, 401, 403, 404, 409, 429]) {
      expect(isExpectedClientError(new ApiError("x", status))).toBe(true);
    }
  });

  it("treats 5xx ApiErrors as unexpected", () => {
    expect(isExpectedClientError(new ApiError("x", 500))).toBe(false);
    expect(isExpectedClientError(new ApiError("x", 503))).toBe(false);
  });

  it("treats non-ApiError values as unexpected", () => {
    expect(isExpectedClientError(new Error("boom"))).toBe(false);
    expect(isExpectedClientError(undefined)).toBe(false);
    expect(isExpectedClientError("nope")).toBe(false);
  });
});

describe("scrubEvent", () => {
  it("removes PII from event.user but keeps the id", () => {
    const event = {
      user: { id: "u1", email: "a@b.com", username: "alice", ip_address: "1.2.3.4" },
    };
    const scrubbed = scrubEvent(event);
    expect(scrubbed.user).toEqual({ id: "u1" });
  });

  it("removes sensitive request headers", () => {
    const event = {
      request: {
        headers: { Cookie: "session=secret", Authorization: "Bearer x", "User-Agent": "test" },
      },
    };
    const scrubbed = scrubEvent(event);
    expect(scrubbed.request?.headers).toEqual({ "User-Agent": "test" });
  });

  it("scrubs share tokens from the request URL query string and path", () => {
    const event = {
      request: {
        url: "https://sugara.app/shared/abc123?token=secret",
        query_string: "token=secret",
      },
    };
    const scrubbed = scrubEvent(event);
    // both the path token (abc123) and the query token (secret) are scrubbed
    expect(scrubbed.request?.url).not.toContain("secret");
    expect(scrubbed.request?.url).not.toContain("abc123");
    expect(scrubbed.request?.query_string).not.toContain("secret");
  });

  it("scrubs token path segments under known share prefixes", () => {
    const event = { request: { url: "/p/deadbeef" } };
    expect(scrubEvent(event).request?.url).toBe("/p/[scrubbed]");
  });

  it("scrubs sensitive keys when query_string is an object", () => {
    const event = { request: { query_string: { token: "secret", page: "2" } } };
    const scrubbed = scrubEvent(event);
    expect(scrubbed.request?.query_string).toEqual({ token: "[scrubbed]", page: "2" });
  });
});

describe("beforeBreadcrumb", () => {
  it("scrubs share tokens from breadcrumb URLs", () => {
    const crumb = { data: { url: "https://sugara.app/shared/tok123?token=secret" } };
    const result = beforeBreadcrumb(crumb);
    expect(result.data?.url).not.toContain("secret");
    expect(result.data?.url).not.toContain("tok123");
  });

  it("leaves breadcrumbs without url data untouched", () => {
    const crumb = { message: "clicked", data: { count: 3 } };
    expect(beforeBreadcrumb(crumb)).toEqual({ message: "clicked", data: { count: 3 } });
  });
});

describe("beforeSend", () => {
  it("drops events whose original exception is an expected 4xx ApiError", () => {
    const event = { user: { email: "a@b.com" } };
    expect(beforeSend(event, { originalException: new ApiError("nope", 404) })).toBeNull();
  });

  it("keeps and scrubs events for unexpected errors", () => {
    const event = { user: { id: "u1", email: "a@b.com" } };
    const result = beforeSend(event, { originalException: new Error("boom") });
    expect(result).not.toBeNull();
    expect(result?.user).toEqual({ id: "u1" });
  });

  it("keeps and scrubs events for 5xx ApiErrors", () => {
    const event = { user: { id: "u1", email: "a@b.com" } };
    const result = beforeSend(event, { originalException: new ApiError("server", 500) });
    expect(result).not.toBeNull();
    expect(result?.user).toEqual({ id: "u1" });
  });
});

// Sentry v11 replaced `sendDefaultPii` with `dataCollection`, and leaving it unset
// collects far more than v10's `sendDefaultPii: false`. These tests pin the v10 range.
const V10_DENYLIST = ["forwarded", "-ip", "remote-", "via", "-user"];

describe("DATA_COLLECTION", () => {
  it("does not infer user info", () => {
    expect(DATA_COLLECTION.userInfo).toBe(false);
  });

  it("does not collect cookies", () => {
    expect(DATA_COLLECTION.cookies).toBe(false);
  });

  it("filters IP-revealing request headers", () => {
    expect(DATA_COLLECTION.httpHeaders).toMatchObject({ request: { deny: V10_DENYLIST } });
  });

  it("filters IP-revealing response headers", () => {
    expect(DATA_COLLECTION.httpHeaders).toMatchObject({ response: { deny: V10_DENYLIST } });
  });

  it("does not collect HTTP bodies", () => {
    expect(DATA_COLLECTION.httpBodies).toEqual([]);
  });

  it("filters IP-revealing URL query params", () => {
    expect(DATA_COLLECTION.urlQueryParams).toEqual({ deny: V10_DENYLIST });
  });

  it("does not collect GenAI inputs or outputs", () => {
    expect(DATA_COLLECTION.genAI).toEqual({ inputs: false, outputs: false });
  });

  it("does not collect MCP inputs or outputs", () => {
    expect(DATA_COLLECTION.mcp).toEqual({ inputs: false, outputs: false });
  });

  it("does not collect GraphQL documents or variables", () => {
    expect(DATA_COLLECTION.graphQL).toEqual({ document: false, variables: false });
  });

  it("does not collect database query data", () => {
    expect(DATA_COLLECTION.databaseQueryData).toBe(false);
  });

  it("does not collect queue task arguments", () => {
    expect(DATA_COLLECTION.queues).toBe(false);
  });
});
