# 外部 API v1

アカウント保持者がスクリプト・CLI・ローカル LLM から自分の旅行データを読み取るための REST API。内部 API（Cookie セッション専用）とは独立したルーターとして実装されており、API キー（Bearer 認証）でアクセスする。

## 認証方式

**自前 self-hash 実装（Better Auth プラグイン不採用）**

- キー形式: `sk_` + `base64url(crypto.randomBytes(32))`（256bit 高エントロピー乱数）
- DB 保存: `apiKeys` テーブルに SHA-256 ハッシュ（`keyHash` 列）のみ保存。生キーは復元不可
- 発行時: 生キーをレスポンスで 1 回だけ返す
- 検証: `Authorization: Bearer <key>` ヘッダを `^Bearer\s+(\S+)$` で厳密パース → SHA-256(token) を `keyHash` と照合
- 有効性判定（行の存在・`expiresAt > now`）のいずれかが偽の場合は一律 `401 unauthorized`（理由を区別しない）
- `lastRequest` / `lastUsedAt` の追跡は設計上持たない（verify ごとの DB write を排除）

## スコープ一覧

キー発行時にスコープを選択する。`requireApiKey(scope)` が唯一の入口で fail-closed（スコープ未保有は `403 insufficient_scope`）。

| スコープ | 説明 |
|---|---|
| `trips:read` | 旅行・日程・メンバーの読み取り |
| `expenses:read` | 費用・精算の読み取り |
| `articles:read` | 記事の読み取り（自分が作成した記事のみ） |
| `bookmarks:read` | ブックマークの読み取り（自分が所有するリストのみ） |

書き込み系スコープ（`trips:write` / `expenses:write` 等）は将来の拡張として予約されており、v1 では未実装。

## エンドポイント一覧

ベースパス: `/api/v1`。全エンドポイント Bearer 必須・例外なし。

| メソッド | パス | スコープ | 概要 |
|---|---|---|---|
| GET | `/trips` | `trips:read` | 自分がアクセスできる旅行の一覧 |
| GET | `/trips/:id` | `trips:read` | 旅行詳細（日程・メンバーを含む） |
| GET | `/trips/:tripId/expenses` | `expenses:read` | 旅行の費用一覧 |
| GET | `/articles` | `articles:read` | 自分の記事一覧（本文なし） |
| GET | `/articles/:id` | `articles:read` | 記事詳細（本文あり） |
| GET | `/bookmark-lists` | `bookmarks:read` | 自分のブックマークリスト一覧 |
| GET | `/bookmark-lists/:listId/bookmarks` | `bookmarks:read` | リスト内のブックマーク |

**ページネーション**: offset/limit 方式。`limit` 既定 50・上限 100、`offset` 0 以上。

**アクセス制御**:
- `:id` / `:tripId` を取る旅行系エンドポイントは `withTripAccess` ラッパが `checkTripAccess(tripId, userId)` を呼び、非メンバーには `404 not_found`（存在秘匿）
- 記事・ブックマークは `ownerId === userId` / `list.userId === userId` のみで境界完結

**外部 DTO**:
- 内部 user UUID・メールアドレスは一切出さない
- 旅行メンバー・費用の支払者・費用の分割は `memberNo`（trip 内ローカルの通し番号: `joinedAt` 昇順・`userId` tie-break の 1 始まり）と `displayName` で表現

## キー管理 API

Web 設定画面から使う内部エンドポイント（Cookie 認証・本登録ユーザー限定）。

| メソッド | パス | 概要 |
|---|---|---|
| POST | `/api/api-keys` | キー発行（名前・有効期限・スコープを指定。生キーを 1 回だけ返す） |
| GET | `/api/api-keys` | 自分のキー一覧（メタのみ。`keyHash` / 生キーは返さない） |
| DELETE | `/api/api-keys/:id` | 即時失効（所有者チェック） |

有効期限の上限（90 日）とスコープのホワイトリスト検証はルート側 Zod スキーマが権威的に強制する。

Web UI は設定画面の「API キー」タブ（`apps/web/components/api-keys-section.tsx`）。発行フォーム（名前・有効期限 7/30/90 日・スコープのチェックボックス。最小権限のため既定では未選択）、生キーの 1 回限り表示 + コピー、一覧（期限切れ Badge 表示）、削除確認ダイアログを提供する。E2E は `apps/web/e2e/api-keys.spec.ts`（発行 → v1 読み取り → スコープ外 403 → 失効 → 401 のライフサイクル）。

## レート制限

既存の `rateLimitByIp` を `/api/v1` に適用。IP 単位で全リクエストを計上（`window: 60s / max: 300`）。

- 主消費者は単一/少数 IP 集中（CLI・ローカル LLM）のため正規バーストを許容する値に設定
- fail-open（Upstash 到達不可時は通す）
- 認証（`verifyApiKey`）は常に fail-closed でレート可用性とは独立

## 監査ログ

全リクエストにキー ID・ユーザー ID・スコープ・HTTP ステータス・パスを pino で構造化記録。`Authorization` ヘッダは redact 設定で隠蔽。

## エラーモデル

```json
{ "error": { "code": "...", "message": "..." } }
```

| HTTP | code | 用途 |
|---|---|---|
| 400 | `invalid_request` | パラメータ不正（UUID 形式誤り等） |
| 401 | `unauthorized` | キー無効・欠落・期限切れ・失効（理由を区別しない） |
| 403 | `insufficient_scope` | スコープ不足 |
| 404 | `not_found` | リソースなし または アクセス権なし（存在秘匿） |
| 429 | `rate_limited` | レート超過 |
| 500 | `internal_error` | 詳細は返さない |

v1 は独立した `onError` を持ち、グローバルの `handleError`（内部エラー形・日本語メッセージ）を継承しない。

## パスワードリセット / 変更時のキー失効

パスワードリセット時（`emailAndPassword.onPasswordReset`）および認証済みパスワード変更時（Better Auth の `hooks.after` で `/change-password` 成功を検知、`apps/api/src/lib/auth-hooks.ts`）に、当該ユーザーの全 `apiKeys` 行を一括削除する。セッション全失効と API キー失効を同じ資格情報ローテーション境界で揃える。失効処理は意図的に try-catch しない（fail-closed。失効失敗を握りつぶしてサイレント成功させない）。

## ルーター分離

v1 は独立した Hono インスタンス（`v1App`）として `app.route("/api/v1", v1App)` でマウント。親の `cors` / `requestLogger` は `/api/v1` を除外したパス指定に変更済みで、CORS ヘッダを v1 応答に付与しない（サーバ間・CLI 専用のためブラウザ直叩き非対応）。

v1 のマウントは**全内部ルーターより先**に置く。Hono は登録順にハンドラを実行するため、後段マウントだと兄弟ルーターの wildcard middleware（例: `/api` 直下にマウントされたルーターの `use("*", requireAuth)`）が v1 の Bearer 認証より先に走り、Cookie 認証の応答で横取りされる（実際に発生した回帰。`v1-mounting.test.ts` が合成済み `app` 経由で再発を検出する）。加えて `v1App` 末尾の catch-all が未知の `/api/v1` パスを v1 形式の `404 not_found` で終端し、親側へのフォールスルーを構造的に断つ。

## 今後の課題

- レート制限の具体値（IP 段の window/max）を実負荷に基づいて調整
- OpenAPI spec（`/api/_docs`）および Scalar UI の整備
- キー ID 単位のレート制限・`X-RateLimit-*` ヘッダ（公開拡大時に後方互換追加）
- 書き込み系スコープ（`trips:write` / `expenses:write`）の追加
- MCP サーバによる LLM 連携（v1 REST を下層として薄くラップ）
