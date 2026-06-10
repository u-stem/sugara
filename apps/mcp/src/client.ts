import { z } from "zod";

// Error response schema from the v1 API
const v1ErrorBodySchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});

type V1ErrorCode =
  | "unauthorized"
  | "insufficient_scope"
  | "not_found"
  | "rate_limited"
  | "invalid_request"
  | "internal_error";

function isV1ErrorCode(code: string): code is V1ErrorCode {
  return [
    "unauthorized",
    "insufficient_scope",
    "not_found",
    "rate_limited",
    "invalid_request",
    "internal_error",
  ].includes(code);
}

const ERROR_MESSAGES: Record<V1ErrorCode, string> = {
  unauthorized: "API キーが無効か期限切れです。SUGARA_API_KEY を確認してください",
  insufficient_scope: "このキーには必要なスコープがありません（例: trips:read）",
  not_found: "対象が見つからないか、アクセス権がありません",
  rate_limited: "レート制限を超えました。少し待って再試行してください",
  invalid_request: "リクエストが無効です",
  internal_error: "サーバーの内部エラーが発生しました",
};

async function buildApiError(response: Response): Promise<Error> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return new Error(`HTTP ${response.status} error`);
  }
  const parsed = v1ErrorBodySchema.safeParse(body);
  if (parsed.success) {
    const code = parsed.data.error.code;
    const message = isV1ErrorCode(code)
      ? ERROR_MESSAGES[code]
      : `Server error (${response.status})`;
    return new Error(message);
  }
  return new Error(`HTTP ${response.status} error`);
}

// A minimal fetch-compatible callable used for DI and testing.
// We do not use `typeof fetch` directly because bun's global fetch has
// additional properties (e.g. preconnect) that vi.fn() mocks cannot satisfy.
export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export type ListTripsOptions = {
  scope?: "owned" | "shared";
  limit?: number;
  offset?: number;
};

export type PaginationOptions = {
  limit?: number;
  offset?: number;
};

function addPagination(params: URLSearchParams, limit?: number, offset?: number): void {
  if (limit !== undefined) params.set("limit", String(limit));
  if (offset !== undefined) params.set("offset", String(offset));
}

/**
 * Thin HTTP client for the sugara external API v1.
 * All requests include Authorization: Bearer <apiKey>.
 * Network errors and v1 error codes are mapped to human-readable Japanese messages.
 * The API key is never included in thrown error messages.
 */
export class ApiClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly _fetch: FetchLike;

  constructor(
    baseUrl: string,
    apiKey: string,
    fetchFn: FetchLike = (input, init) => fetch(input, init),
  ) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
    this._fetch = fetchFn;
  }

  private async request(path: string, params?: URLSearchParams): Promise<unknown> {
    const url = new URL(`${this.baseUrl}/api/v1${path}`);
    if (params) {
      for (const [key, value] of params.entries()) {
        url.searchParams.set(key, value);
      }
    }

    let response: Response;
    try {
      response = await this._fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          Accept: "application/json",
        },
      });
    } catch {
      throw new Error("SUGARA_API_URL に接続できません");
    }

    if (!response.ok) {
      throw await buildApiError(response);
    }

    return response.json();
  }

  async listTrips(opts?: ListTripsOptions): Promise<unknown> {
    const params = new URLSearchParams();
    if (opts?.scope !== undefined) params.set("scope", opts.scope);
    addPagination(params, opts?.limit, opts?.offset);
    return this.request("/trips", params);
  }

  async getTrip(id: string): Promise<unknown> {
    return this.request(`/trips/${encodeURIComponent(id)}`);
  }

  async listTripExpenses(tripId: string, opts?: PaginationOptions): Promise<unknown> {
    const params = new URLSearchParams();
    addPagination(params, opts?.limit, opts?.offset);
    return this.request(`/trips/${encodeURIComponent(tripId)}/expenses`, params);
  }

  async listBookmarkLists(opts?: PaginationOptions): Promise<unknown> {
    const params = new URLSearchParams();
    addPagination(params, opts?.limit, opts?.offset);
    return this.request("/bookmark-lists", params);
  }

  async listBookmarks(listId: string, opts?: PaginationOptions): Promise<unknown> {
    const params = new URLSearchParams();
    addPagination(params, opts?.limit, opts?.offset);
    return this.request(`/bookmark-lists/${encodeURIComponent(listId)}/bookmarks`, params);
  }

  async listArticles(opts?: PaginationOptions): Promise<unknown> {
    const params = new URLSearchParams();
    addPagination(params, opts?.limit, opts?.offset);
    return this.request("/articles", params);
  }

  async getArticle(id: string): Promise<unknown> {
    return this.request(`/articles/${encodeURIComponent(id)}`);
  }
}
