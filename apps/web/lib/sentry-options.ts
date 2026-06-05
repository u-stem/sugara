import { ApiError } from "./api";

// Shared Sentry configuration: PII scrubbing and noise suppression, used by both
// the browser and server inits. Pure functions so they can be unit-tested without
// initializing the SDK. The structural ScrubbableEvent type is a supertype of
// Sentry's ErrorEvent, so beforeSend can be passed to Sentry.init directly.

// Expected client errors (handled by the UI) that should not be reported as issues.
const EXPECTED_CLIENT_STATUSES = new Set([400, 401, 403, 404, 409, 429]);

// Browser/runtime noise that is never actionable.
export const IGNORE_ERRORS = [
  "AbortError",
  "Failed to fetch",
  "NetworkError when attempting to fetch resource",
  "Load failed",
  "ResizeObserver loop limit exceeded",
  "ResizeObserver loop completed with undelivered notifications",
];

const SENSITIVE_HEADERS = new Set(["cookie", "authorization", "set-cookie", "x-csrf-token"]);

// Query keys whose values are secrets/share tokens and must not leave the client.
const SENSITIVE_QUERY_KEYS = new Set(["token", "shareToken", "share_token", "password"]);

// Share tokens also appear as a path segment (e.g. /shared/<token>, /p/<token>,
// /polls/shared/<token>). Scrub the segment that follows these prefixes.
const SENSITIVE_PATH_RE = /\/(p|shared|polls\/shared|quick-polls\/shared)\/[^/?#]+/g;

export function isExpectedClientError(err: unknown): boolean {
  return err instanceof ApiError && EXPECTED_CLIENT_STATUSES.has(err.status);
}

// Structural subset of Sentry's ErrorEvent covering only the fields we scrub.
// Field types are kept compatible with (i.e. wider than) Sentry's so an ErrorEvent
// is assignable here without a cast.
export interface ScrubbableEvent {
  user?: {
    id?: string | number;
    email?: string | null;
    username?: string | null;
    ip_address?: string | null;
  } | null;
  request?: {
    headers?: { [key: string]: string };
    cookies?: unknown;
    url?: string;
    query_string?: unknown;
  } | null;
}

function scrubUrl(url: string): string {
  let result: string;
  try {
    const parsed = new URL(url, "https://placeholder.invalid");
    for (const key of parsed.searchParams.keys()) {
      if (SENSITIVE_QUERY_KEYS.has(key)) parsed.searchParams.set(key, "[scrubbed]");
    }
    result = url.includes("://") ? parsed.toString() : `${parsed.pathname}${parsed.search}`;
  } catch {
    result = url;
  }
  return result.replace(SENSITIVE_PATH_RE, "/$1/[scrubbed]");
}

function scrubQueryString(qs: string): string {
  const params = new URLSearchParams(qs);
  for (const key of params.keys()) {
    if (SENSITIVE_QUERY_KEYS.has(key)) params.set(key, "[scrubbed]");
  }
  return params.toString();
}

export function scrubEvent(event: ScrubbableEvent): ScrubbableEvent {
  if (event.user) {
    // Keep only the opaque id; drop email / username / ip.
    event.user = event.user.id ? { id: event.user.id } : undefined;
  }
  const request = event.request;
  if (request) {
    if (request.headers) {
      const headers: { [key: string]: string } = {};
      for (const [key, value] of Object.entries(request.headers)) {
        if (!SENSITIVE_HEADERS.has(key.toLowerCase())) headers[key] = value;
      }
      request.headers = headers;
    }
    if (request.cookies) request.cookies = undefined;
    if (typeof request.url === "string") request.url = scrubUrl(request.url);
    const qs = request.query_string;
    if (typeof qs === "string") {
      request.query_string = scrubQueryString(qs);
    } else if (qs && typeof qs === "object" && !Array.isArray(qs)) {
      // Sentry may serialize query as an object; scrub sensitive keys in place.
      for (const key of Object.keys(qs)) {
        if (SENSITIVE_QUERY_KEYS.has(key)) Reflect.set(qs, key, "[scrubbed]");
      }
    }
  }
  return event;
}

interface ScrubbableBreadcrumb {
  message?: string;
  data?: { [key: string]: unknown };
}

// fetch/navigation breadcrumbs carry URLs that can include share tokens; scrub them.
export function beforeBreadcrumb<T extends ScrubbableBreadcrumb>(breadcrumb: T): T {
  const data = breadcrumb.data;
  if (data) {
    for (const key of ["url", "to", "from"]) {
      const value = data[key];
      if (typeof value === "string") data[key] = scrubUrl(value);
    }
  }
  return breadcrumb;
}

export function beforeSend<T extends ScrubbableEvent>(
  event: T,
  hint?: { originalException?: unknown },
): T | null {
  if (isExpectedClientError(hint?.originalException)) return null;
  scrubEvent(event);
  return event;
}
