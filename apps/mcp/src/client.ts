import { z } from "zod";

// Error response schema from the v1 API.
// `reason` and `details` are additive fields carried alongside the frozen
// top-level code set (e.g. reason "trip_limit_reached" with details.max).
const v1ErrorBodySchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    reason: z.string().optional(),
    details: z.unknown().optional(),
  }),
});

const limitDetailsSchema = z.object({ max: z.number() });

// Localized messages for the v1 API's fine-grained `error.reason` codes. Limit
// reasons carry `details: { max }` and use a builder; non-limit reasons map to a
// static message. Keep in sync with ApiV1ErrorReason (apps/api/src/lib/external-api/errors.ts).
const LIMIT_REASON_MESSAGES: Record<string, (max: number) => string> = {
  trip_limit_reached: (max) => `旅行の作成上限（${max}件）に達しました`,
  schedule_limit_reached: (max) => `予定・候補の上限（1旅行あたり${max}件）に達しました`,
  expense_limit_reached: (max) => `費用の上限（1旅行あたり${max}件）に達しました`,
  bookmark_list_limit_reached: (max) => `ブックマークリストの上限（${max}件）に達しました`,
  bookmark_limit_reached: (max) => `ブックマークの上限（1リストあたり${max}件）に達しました`,
  article_limit_reached: (max) => `記事の作成上限（${max}件）に達しました`,
  souvenir_limit_reached: (max) => `お土産の上限（1旅行あたり${max}件）に達しました`,
  pattern_limit_reached: (max) => `パターンの上限（1日あたり${max}件）に達しました`,
};

const REASON_MESSAGES: Record<string, string> = {
  trip_has_no_days: "この旅行にはまだ日程がありません。先に日程を作成してください",
  cannot_delete_default_pattern: "デフォルトパターンは削除できません",
};

type V1ErrorCode =
  | "unauthorized"
  | "insufficient_scope"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "invalid_request"
  | "internal_error";

function isV1ErrorCode(code: string): code is V1ErrorCode {
  return [
    "unauthorized",
    "insufficient_scope",
    "not_found",
    "conflict",
    "rate_limited",
    "invalid_request",
    "internal_error",
  ].includes(code);
}

const ERROR_MESSAGES: Record<V1ErrorCode, string> = {
  unauthorized: "API キーが無効か期限切れです。SUGARA_API_KEY を確認してください",
  insufficient_scope: "このキーには必要なスコープがありません（例: trips:read）",
  not_found: "対象が見つからないか、アクセス権がありません",
  conflict: "操作を完了できませんでした（競合またはリソース上限に達しました）",
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
    const { code, reason, details } = parsed.data.error;
    if (reason !== undefined) {
      const limitMessage = LIMIT_REASON_MESSAGES[reason];
      if (limitMessage) {
        const limit = limitDetailsSchema.safeParse(details);
        if (limit.success) {
          return new Error(limitMessage(limit.data.max));
        }
      }
      const reasonMessage = REASON_MESSAGES[reason];
      if (reasonMessage) {
        return new Error(reasonMessage);
      }
    }
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

// Extended options for list endpoints that support ?q= partial-match filtering.
export type ListWithSearchOptions = PaginationOptions & {
  q?: string;
};

function addPagination(params: URLSearchParams, limit?: number, offset?: number): void {
  if (limit !== undefined) params.set("limit", String(limit));
  if (offset !== undefined) params.set("offset", String(offset));
}

function addSearch(params: URLSearchParams, q: string | undefined): void {
  if (q !== undefined) params.set("q", q);
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

  // Sends a mutating request (POST or PATCH). When body is provided it is sent
  // as JSON with Content-Type: application/json; when omitted (body-less POST
  // endpoints such as duplicate/unassign), no body or Content-Type is sent.
  private async mutate(method: "POST" | "PATCH", path: string, body?: unknown): Promise<unknown> {
    const url = new URL(`${this.baseUrl}/api/v1${path}`);

    let response: Response;
    try {
      response = await this._fetch(url.toString(), {
        method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          Accept: "application/json",
          ...(body !== undefined && { "Content-Type": "application/json" }),
        },
        ...(body !== undefined && { body: JSON.stringify(body) }),
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

  async listBookmarks(listId: string, opts?: ListWithSearchOptions): Promise<unknown> {
    const params = new URLSearchParams();
    addPagination(params, opts?.limit, opts?.offset);
    addSearch(params, opts?.q);
    return this.request(`/bookmark-lists/${encodeURIComponent(listId)}/bookmarks`, params);
  }

  async listArticles(opts?: ListWithSearchOptions): Promise<unknown> {
    const params = new URLSearchParams();
    addPagination(params, opts?.limit, opts?.offset);
    addSearch(params, opts?.q);
    return this.request("/articles", params);
  }

  async getArticle(id: string): Promise<unknown> {
    return this.request(`/articles/${encodeURIComponent(id)}`);
  }

  async listCandidates(tripId: string, opts?: ListWithSearchOptions): Promise<unknown> {
    const params = new URLSearchParams();
    addPagination(params, opts?.limit, opts?.offset);
    addSearch(params, opts?.q);
    return this.request(`/trips/${encodeURIComponent(tripId)}/candidates`, params);
  }

  async listSouvenirs(tripId: string, opts?: ListWithSearchOptions): Promise<unknown> {
    const params = new URLSearchParams();
    addPagination(params, opts?.limit, opts?.offset);
    addSearch(params, opts?.q);
    return this.request(`/trips/${encodeURIComponent(tripId)}/souvenirs`, params);
  }

  // Sends a DELETE request with no body. Used for idempotent resource removal.
  // The API always returns 200 + JSON (never 204) so response.json() is always valid.
  private async remove(path: string): Promise<unknown> {
    const url = new URL(`${this.baseUrl}/api/v1${path}`);

    let response: Response;
    try {
      response = await this._fetch(url.toString(), {
        method: "DELETE",
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

  // --- Write methods (33 endpoints, 1:1 with v1 write routes) ---

  async createTrip(body: unknown): Promise<unknown> {
    return this.mutate("POST", "/trips", body);
  }

  async updateTrip(id: string, body: unknown): Promise<unknown> {
    return this.mutate("PATCH", `/trips/${encodeURIComponent(id)}`, body);
  }

  async createSchedule(tripId: string, dayNumber: number, body: unknown): Promise<unknown> {
    // dayNumber is 1-indexed; the API path uses /days/:dayNumber/schedules.
    return this.mutate(
      "POST",
      `/trips/${encodeURIComponent(tripId)}/days/${encodeURIComponent(String(dayNumber))}/schedules`,
      body,
    );
  }

  async updateSchedule(tripId: string, scheduleId: string, body: unknown): Promise<unknown> {
    return this.mutate(
      "PATCH",
      `/trips/${encodeURIComponent(tripId)}/schedules/${encodeURIComponent(scheduleId)}`,
      body,
    );
  }

  async createExpense(tripId: string, body: unknown): Promise<unknown> {
    return this.mutate("POST", `/trips/${encodeURIComponent(tripId)}/expenses`, body);
  }

  async updateExpense(tripId: string, expenseId: string, body: unknown): Promise<unknown> {
    return this.mutate(
      "PATCH",
      `/trips/${encodeURIComponent(tripId)}/expenses/${encodeURIComponent(expenseId)}`,
      body,
    );
  }

  async createBookmarkList(body: unknown): Promise<unknown> {
    return this.mutate("POST", "/bookmark-lists", body);
  }

  async updateBookmarkList(listId: string, body: unknown): Promise<unknown> {
    return this.mutate("PATCH", `/bookmark-lists/${encodeURIComponent(listId)}`, body);
  }

  async createBookmark(listId: string, body: unknown): Promise<unknown> {
    return this.mutate("POST", `/bookmark-lists/${encodeURIComponent(listId)}/bookmarks`, body);
  }

  async updateBookmark(listId: string, bookmarkId: string, body: unknown): Promise<unknown> {
    return this.mutate(
      "PATCH",
      `/bookmark-lists/${encodeURIComponent(listId)}/bookmarks/${encodeURIComponent(bookmarkId)}`,
      body,
    );
  }

  async createArticle(body: unknown): Promise<unknown> {
    return this.mutate("POST", "/articles", body);
  }

  async updateArticle(id: string, body: unknown): Promise<unknown> {
    return this.mutate("PATCH", `/articles/${encodeURIComponent(id)}`, body);
  }

  async createCandidate(tripId: string, body: unknown): Promise<unknown> {
    return this.mutate("POST", `/trips/${encodeURIComponent(tripId)}/candidates`, body);
  }

  async updateCandidate(tripId: string, scheduleId: string, body: unknown): Promise<unknown> {
    return this.mutate(
      "PATCH",
      `/trips/${encodeURIComponent(tripId)}/candidates/${encodeURIComponent(scheduleId)}`,
      body,
    );
  }

  async createSouvenir(tripId: string, body: unknown): Promise<unknown> {
    return this.mutate("POST", `/trips/${encodeURIComponent(tripId)}/souvenirs`, body);
  }

  async updateSouvenir(tripId: string, itemId: string, body: unknown): Promise<unknown> {
    return this.mutate(
      "PATCH",
      `/trips/${encodeURIComponent(tripId)}/souvenirs/${encodeURIComponent(itemId)}`,
      body,
    );
  }

  async batchCreateCandidates(
    tripId: string,
    items: unknown[],
    onConflict?: "create" | "skip",
  ): Promise<unknown> {
    return this.mutate("POST", `/trips/${encodeURIComponent(tripId)}/candidates/batch`, {
      items,
      ...(onConflict !== undefined && { onConflict }),
    });
  }

  async batchCreateSouvenirs(
    tripId: string,
    items: unknown[],
    onConflict?: "create" | "skip",
  ): Promise<unknown> {
    return this.mutate("POST", `/trips/${encodeURIComponent(tripId)}/souvenirs/batch`, {
      items,
      ...(onConflict !== undefined && { onConflict }),
    });
  }

  async deleteCandidate(tripId: string, scheduleId: string): Promise<unknown> {
    return this.remove(
      `/trips/${encodeURIComponent(tripId)}/candidates/${encodeURIComponent(scheduleId)}`,
    );
  }

  async deleteSouvenir(tripId: string, itemId: string): Promise<unknown> {
    return this.remove(
      `/trips/${encodeURIComponent(tripId)}/souvenirs/${encodeURIComponent(itemId)}`,
    );
  }

  async deleteSchedule(tripId: string, scheduleId: string): Promise<unknown> {
    return this.remove(
      `/trips/${encodeURIComponent(tripId)}/schedules/${encodeURIComponent(scheduleId)}`,
    );
  }

  async deleteExpense(tripId: string, expenseId: string): Promise<unknown> {
    return this.remove(
      `/trips/${encodeURIComponent(tripId)}/expenses/${encodeURIComponent(expenseId)}`,
    );
  }

  async deleteBookmark(listId: string, bookmarkId: string): Promise<unknown> {
    return this.remove(
      `/bookmark-lists/${encodeURIComponent(listId)}/bookmarks/${encodeURIComponent(bookmarkId)}`,
    );
  }

  async deleteBookmarkList(listId: string): Promise<unknown> {
    return this.remove(`/bookmark-lists/${encodeURIComponent(listId)}`);
  }

  async deleteArticle(articleId: string): Promise<unknown> {
    return this.remove(`/articles/${encodeURIComponent(articleId)}`);
  }

  // --- Pattern methods (day_patterns: alternative schedule plans within a day) ---

  async createPattern(tripId: string, dayNumber: number, body: unknown): Promise<unknown> {
    return this.mutate(
      "POST",
      `/trips/${encodeURIComponent(tripId)}/days/${encodeURIComponent(String(dayNumber))}/patterns`,
      body,
    );
  }

  async updatePattern(tripId: string, patternId: string, body: unknown): Promise<unknown> {
    return this.mutate(
      "PATCH",
      `/trips/${encodeURIComponent(tripId)}/patterns/${encodeURIComponent(patternId)}`,
      body,
    );
  }

  async deletePattern(tripId: string, patternId: string): Promise<unknown> {
    return this.remove(
      `/trips/${encodeURIComponent(tripId)}/patterns/${encodeURIComponent(patternId)}`,
    );
  }

  async duplicatePattern(tripId: string, patternId: string): Promise<unknown> {
    return this.mutate(
      "POST",
      `/trips/${encodeURIComponent(tripId)}/patterns/${encodeURIComponent(patternId)}/duplicate`,
    );
  }

  async overwritePattern(tripId: string, patternId: string, body: unknown): Promise<unknown> {
    return this.mutate(
      "POST",
      `/trips/${encodeURIComponent(tripId)}/patterns/${encodeURIComponent(patternId)}/overwrite`,
      body,
    );
  }

  // --- Candidate assignment / schedule move methods ---

  async assignCandidate(tripId: string, scheduleId: string, body: unknown): Promise<unknown> {
    return this.mutate(
      "POST",
      `/trips/${encodeURIComponent(tripId)}/candidates/${encodeURIComponent(scheduleId)}/assign`,
      body,
    );
  }

  async unassignSchedule(tripId: string, scheduleId: string): Promise<unknown> {
    return this.mutate(
      "POST",
      `/trips/${encodeURIComponent(tripId)}/schedules/${encodeURIComponent(scheduleId)}/unassign`,
    );
  }

  async moveSchedule(tripId: string, scheduleId: string, body: unknown): Promise<unknown> {
    return this.mutate(
      "POST",
      `/trips/${encodeURIComponent(tripId)}/schedules/${encodeURIComponent(scheduleId)}/move`,
      body,
    );
  }
}
