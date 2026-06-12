import { reportError } from "@/lib/report-error";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    // Standardized error code (e.g. "VALIDATION"); undefined for legacy responses.
    public code?: string,
    // Structured error detail (e.g. Zod flatten); undefined when not provided.
    public details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// Parse an error body into { message, code, details }, accepting both the
// standardized { code, message, details? } shape and legacy { error } responses.
// A legacy object `error` (e.g. Zod flatten) is preserved as `details` rather
// than being dropped behind a generic message.
function parseErrorBody(
  body: unknown,
  status: number,
): {
  message: string;
  code?: string;
  details?: unknown;
} {
  const fallback = `API error: ${status}`;
  if (body === null || typeof body !== "object") {
    return { message: fallback };
  }
  const record = body as Record<string, unknown>;
  if (typeof record.code === "string" && typeof record.message === "string") {
    return { message: record.message, code: record.code, details: record.details };
  }
  if (typeof record.error === "string") {
    return { message: record.error };
  }
  if (record.error !== undefined) {
    return { message: fallback, details: record.error };
  }
  return { message: fallback };
}

type FetchOptions = RequestInit & {
  params?: Record<string, string>;
};

async function fetchApi(path: string, options: FetchOptions): Promise<Response> {
  const { params, ...fetchOptions } = options;

  let url = `${API_BASE}${path}`;
  if (params) {
    const searchParams = new URLSearchParams(params);
    url += `?${searchParams.toString()}`;
  }

  const headers: HeadersInit = { ...fetchOptions.headers };
  if (fetchOptions.body && !(fetchOptions.body instanceof FormData)) {
    (headers as Record<string, string>)["Content-Type"] = "application/json";
  }

  const res = await fetch(url, {
    ...fetchOptions,
    credentials: "include",
    headers,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: "Unknown error" }));
    const { message, code, details } = parseErrorBody(body, res.status);
    throw new ApiError(message, res.status, code, details);
  }

  return res;
}

/**
 * Call a JSON API endpoint that returns a body of type T.
 * Use {@link apiVoid} for endpoints that return 204 No Content.
 */
export async function api<T>(path: string, options: FetchOptions = {}): Promise<T> {
  const res = await fetchApi(path, options);

  if (res.status === 204) {
    const guardError = new ApiError(
      `Expected JSON body from ${path} but got 204 No Content. Use apiVoid() for endpoints that return no body.`,
      204,
    );
    // The user only sees a localized fallback toast (getApiErrorMessage never
    // surfaces this message), so report it or the misuse stays invisible
    reportError(guardError);
    throw guardError;
  }

  return res.json();
}

/**
 * Call an API endpoint that returns no body (typically 204 No Content).
 * Throws if the endpoint returns a non-2xx status; ignores the body otherwise.
 */
export async function apiVoid(path: string, options: FetchOptions = {}): Promise<void> {
  await fetchApi(path, options);
}

/**
 * Extract a user-facing error message from an unknown catch value.
 *
 * Server-originated messages (ApiError.message) and JS runtime messages
 * (Error.message) are developer-facing and English-only, so they are never
 * shown to users. Callers supply a localized {@link fallback} and may pass
 * per-status overrides; when no override matches, the localized fallback is
 * returned. This guarantees the user always sees a translated message.
 */
export function getApiErrorMessage(
  err: unknown,
  fallback: string,
  opts?: { badRequest?: string; conflict?: string; notFound?: string },
): string {
  if (err instanceof ApiError) {
    if (err.status === 400) return opts?.badRequest ?? fallback;
    if (err.status === 409) return opts?.conflict ?? fallback;
    if (err.status === 404) return opts?.notFound ?? fallback;
  }
  return fallback;
}
