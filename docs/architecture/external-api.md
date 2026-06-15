# 外部 API v1

アカウント保持者がスクリプト・CLI・ローカル LLM から自分の旅行データを読み書きするための REST API。内部 API（Cookie セッション専用）とは独立したルーターとして実装されており、API キー（Bearer 認証）でアクセスする。

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
| `trips:read` | 旅行・日程・メンバー・候補の読み取り |
| `expenses:read` | 費用・精算の読み取り |
| `articles:read` | 記事の読み取り（自分が作成した記事のみ） |
| `bookmarks:read` | ブックマークの読み取り（自分が所有するリストのみ） |
| `souvenirs:read` | お土産の読み取り（自分のもの + 他メンバーの共有アイテム） |
| `trips:write` | 旅行・予定・候補の作成・更新 |
| `expenses:write` | 費用の作成・更新 |
| `articles:write` | 記事の作成・更新（自分の記事のみ） |
| `bookmarks:write` | ブックマークリスト・ブックマークの作成・更新（自分のリストのみ） |
| `souvenirs:write` | お土産の作成・更新（自分のお土産のみ） |

write は read を**含意しない**（最小権限。read と write は独立に付与する）。`trips:write` は候補の削除、`souvenirs:write` はお土産の削除にも使用する。既存の read のみのキーは write スコープを保有しないため挙動不変（後方互換）。

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
| POST | `/trips` | `trips:write` | 旅行作成（キー所有者が owner。上限超過は 409） |
| PATCH | `/trips/:id` | `trips:write` | 旅行更新（部分更新。費用がある旅行の通貨変更は 409） |
| POST | `/trips/:tripId/days/:dayNumber/schedules` | `trips:write` | 指定日（1 始まり）への予定追加（末尾に挿入） |
| PATCH | `/trips/:tripId/schedules/:scheduleId` | `trips:write` | 予定更新 |
| POST | `/trips/:tripId/expenses` | `expenses:write` | 費用作成（memberNo ベース入力） |
| PATCH | `/trips/:tripId/expenses/:expenseId` | `expenses:write` | 費用更新 |
| POST | `/bookmark-lists` | `bookmarks:write` | ブックマークリスト作成 |
| PATCH | `/bookmark-lists/:listId` | `bookmarks:write` | リスト更新 |
| POST | `/bookmark-lists/:listId/bookmarks` | `bookmarks:write` | ブックマーク追加 |
| PATCH | `/bookmark-lists/:listId/bookmarks/:bookmarkId` | `bookmarks:write` | ブックマーク更新 |
| POST | `/articles` | `articles:write` | 記事作成（キー所有者が owner） |
| PATCH | `/articles/:id` | `articles:write` | 記事更新（自分の記事のみ） |
| GET | `/trips/:tripId/candidates` | `trips:read` | 旅行の候補（未割り当てスポット）一覧 |
| POST | `/trips/:tripId/candidates` | `trips:write` | 候補作成（上限超過は 409） |
| PATCH | `/trips/:tripId/candidates/:scheduleId` | `trips:write` | 候補更新（割り当て済みは 404） |
| DELETE | `/trips/:tripId/candidates/:scheduleId` | `trips:write` | 候補削除（冪等。未割り当て候補のみ対象。割り当て済み・不明は `deleted: false`） |
| GET | `/trips/:tripId/souvenirs` | `souvenirs:read` | 旅行のお土産一覧（自分のもの + 共有アイテム） |
| POST | `/trips/:tripId/souvenirs` | `souvenirs:write` | お土産作成（上限超過は 409） |
| PATCH | `/trips/:tripId/souvenirs/:itemId` | `souvenirs:write` | お土産更新（自分のお土産のみ） |
| DELETE | `/trips/:tripId/souvenirs/:itemId` | `souvenirs:write` | お土産削除（冪等。自分のお土産のみ対象。他ユーザーのもの・不明は `deleted: false`） |

候補は schedules テーブルの行（`dayPatternId = NULL`）であり、専用スコープではなく既存の `trips:*` を用いる（予定 write が `trips:write` を使う前例に揃える）。お土産は旅行構造に属さない独立リソースのため専用の `souvenirs:*` スコープを持つ。

**ページネーション**: offset/limit 方式。`limit` 既定 50・上限 100、`offset` 0 以上。

**アクセス制御**:
- `:id` / `:tripId` を取る旅行系エンドポイントは `withTripAccess` ラッパが `checkTripAccess(tripId, userId)` を呼び、非メンバーには `404 not_found`（存在秘匿）
- 旅行系の write は `withTripAccess` の `minRole: "editor"` で editor 以上を要求。ロール不足も `404 not_found`（内部 API と同じ存在秘匿ポリシー）。候補 write も同様に editor 以上
- お土産は例外的に editor を要求しない（`withTripAccess` の `minRole` 省略 = viewer を含む任意メンバー）。各メンバーが自分のお土産を管理する内部セマンティクスに準拠し、更新は所有者本人のみ（`userId === キー所有者`）。お土産の所有者は memberNo + displayName で表現し、旅行を離脱した所有者の共有アイテムは displayName のみ（memberNo なし）にフォールバックする
- 記事・ブックマークは `ownerId === userId` / `list.userId === userId` のみで境界完結
- 日程調整中（trip_days 未生成）の旅行への予定・費用作成は `409 conflict`

**書き込みの入力**:
- リクエストスキーマは `packages/shared` の内部スキーマから派生した v1 専用形（`apps/api/src/routes/v1/write-schemas.ts`）。`coverImageUrl` 等の内部 Storage 参照や楽観ロック用フィールドは外部に公開しない
- 費用の支払者・分割は `paidByMemberNo` / `splits[].memberNo` で指定し、サーバ側で userId に逆引きする。不明な memberNo は `400 invalid_request`
- 費用金額（`amount`）・分割金額（`splits[].amount`）・明細金額（`lineItems[].amount`）はすべて **major units**（例: USD なら $12.50 を `12.5` として送る）。サーバ側で minor units（例: 1250 cents）に変換して DB に保存する。分割合計は minor units 換算後に `amount` の minor units と一致しなければならない（`split_amount_mismatch`）
- GET レスポンスの `amount` / `splits[].amount` は **minor units**（例: USD なら $12.50 が `1250`）。equal 分割の splits は旅行通貨建て、custom/itemized は費用通貨建て
- memberNo はメンバー増減で振り直されるため、書き込み直前に `GET /trips/:id` で最新の対応を確認すること
- 作成は `201`、更新は `200`。レスポンスは read 系と同じ外部 DTO（memberNo + displayName、内部 UUID 非公開）
  - **例外**: `POST /trips/:tripId/candidates`、`PATCH /trips/:tripId/candidates/:scheduleId`、`POST /trips/:tripId/souvenirs`、`PATCH /trips/:tripId/souvenirs/:itemId` はトップレベルに `_meta: { count: number, max: number }` フィールドを追加で返す。`DELETE` 系（候補・お土産）は `{ id, deleted, remaining: { count, max } }` 形式で同等の残余情報を返す（冪等: 常に 200）。他のエンドポイント（schedule write を含む）には付かない
  - `_meta.count` の意味（リソースごとに異なる）
    - **candidate**: 当該 trip 内の全 schedule 件数（割り当て済みと候補の合算）。`max` = `MAX_SCHEDULES_PER_TRIP`(300)
    - **souvenir**: API キー所有者のこの trip における件数（共有アイテムは含めない自分のお土産のみ）。`max` = `MAX_SOUVENIRS_PER_USER_PER_TRIP`(100)
  - **注意**: `_meta.count` は GET の `limit` / `offset` による候補一覧の総件数とは異なる。candidate は「割り当て済みも含めた全 schedule」、souvenir は「他メンバーの共有アイテムを除いた自分の件数」。上限チェック（409 conflict）のロジックと同じフィルタが使われる
- 共有ロジック: 旅行更新・費用作成/更新は内部 API と同一のサービス関数（`apps/api/src/lib/trip-service.ts` / `expense-service.ts`）を経由し、検証・通知・アクティビティログの挙動を揃える

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

Web UI は設定画面の「API キー」タブ（`apps/web/components/api-keys-section.tsx`）。発行フォーム（名前・有効期限 7/30/90 日・スコープのチェックボックス。最小権限のため既定では未選択）、生キーの 1 回限り表示 + コピー、一覧（期限切れ Badge 表示）、削除確認ダイアログを提供する。E2E は `apps/web/e2e/api-keys.spec.ts`（発行 → v1 読み取り → スコープ外 403 → 失効 → 401 のライフサイクル）。**E2E は CI では実行されない手動回帰用**（`bun run --filter @sugara/web test:e2e -- api-keys`。ローカル dev サーバー + ローカル DB 前提）。CI で機械検証されるのは v1 の単体・結合テストと `v1-mounting.test.ts`（合成 app 経由の横取り回帰）。

## レート制限

既存の `rateLimitByIp` を `/api/v1` に適用。IP 単位で全リクエストを計上（`window: 60s / max: 300`）。

- 主消費者は単一/少数 IP 集中（CLI・ローカル LLM）のため正規バーストを許容する値に設定
- fail-open（Upstash 到達不可時は通す）
- 認証（`verifyApiKey`）は常に fail-closed でレート可用性とは独立

## 監査ログ

全リクエストにキー ID・ユーザー ID・スコープ・HTTP ステータス・パスを pino で構造化記録。`Authorization` ヘッダは redact 設定で隠蔽。

## エラーモデル

```json
{ "error": { "code": "...", "message": "...", "reason": "...", "details": { } } }
```

| HTTP | code | 用途 |
|---|---|---|
| 400 | `invalid_request` | パラメータ不正（UUID 形式誤り等） |
| 401 | `unauthorized` | キー無効・欠落・期限切れ・失効（理由を区別しない） |
| 403 | `insufficient_scope` | スコープ不足 |
| 404 | `not_found` | リソースなし または アクセス権なし（存在秘匿） |
| 409 | `conflict` | 現在の状態と矛盾する書き込み（旅行数上限・費用がある旅行の通貨変更・日程未確定の旅行への予定追加等） |
| 429 | `rate_limited` | レート超過 |
| 500 | `internal_error` | 詳細は返さない |

`reason` と `details` は省略可能（該当しないエラーでは key 自体が含まれない）。`code` の集合は後方互換のため凍結し、エラー種別の細分化は optional な `reason`（機械可読な細分化コード）と `details`（構造化データ）の追加で表現する。現在の `reason`:

| reason | 付随する code | details |
|---|---|---|
| `trip_limit_reached` | `conflict` (409) | `{ "max": <ユーザー毎の旅行数上限の実値> }` |

v1 は独立した `onError` を持ち、グローバルの `handleError`（内部エラー形・日本語メッセージ）を継承しない。

## パスワードリセット / 変更時のキー失効

パスワードリセット時（`emailAndPassword.onPasswordReset`）および認証済みパスワード変更時（Better Auth の `hooks.after` で `/change-password` 成功を検知、`apps/api/src/lib/auth-hooks.ts`）に、当該ユーザーの全 `apiKeys` 行を一括削除する。セッション全失効と API キー失効を同じ資格情報ローテーション境界で揃える。失効処理は意図的に try-catch しない（fail-closed。失効失敗を握りつぶしてサイレント成功させない）。

## ルーター分離

v1 は独立した Hono インスタンス（`v1App`）として `app.route("/api/v1", v1App)` でマウント。親の `cors` / `requestLogger` は `/api/v1` を除外したパス指定に変更済みで、CORS ヘッダを v1 応答に付与しない（サーバ間・CLI 専用のためブラウザ直叩き非対応）。

v1 のマウントは**全内部ルーターより先**に置く。Hono は登録順にハンドラを実行するため、後段マウントだと兄弟ルーターの wildcard middleware（例: `/api` 直下にマウントされたルーターの `use("*", requireAuth)`）が v1 の Bearer 認証より先に走り、Cookie 認証の応答で横取りされる（実際に発生した回帰。`v1-mounting.test.ts` が合成済み `app` 経由で再発を検出する）。加えて `v1App` 末尾の catch-all が未知の `/api/v1` パスを v1 形式の `404 not_found` で終端し、親側へのフォールスルーを構造的に断つ。

## OpenAPI ドキュメント

v1 エンドポイントの OpenAPI 3.1 仕様と Scalar UI を提供する。

**マウント先**: `/api/_docs`（`/api/v1` の外）

`/api/v1` は 100% Bearer 認証のドメインとして不変にするため、Cookie 認証が必要なドキュメントエンドポイントは別プレフィックスにマウントする。

| パス | 概要 |
|---|---|
| `/api/_docs/openapi.json` | OpenAPI 3.1 spec（JSON） |
| `/api/_docs` | Scalar UI（API リファレンス） |

**認証**: `requireAuth` + `requireNonGuest`（Cookie セッション + 本登録ユーザー限定）。ゲストアカウントや未認証ユーザーには公開しない。

**spec の内容**: v1 の 27 エンドポイント（read 9 + write 18）のみ記載。Bearer セキュリティスキーム（`type: http, scheme: bearer`）を `components.securitySchemes.bearerAuth` に定義し、全操作に適用。`servers: [{ url: "/api/v1" }]` でベースパスを明示。

**Scalar UI のアセット**: `@scalar/api-reference` を `apps/web` の devDependency として固定バージョン管理する。`apps/web/scripts/copy-scalar-assets.ts` が dev サーバ起動時（`predev`）とビルド時（`prebuild`）に standalone バンドルを `apps/web/public/scalar/standalone.js` へコピーし、Next.js が同一オリジン（`/scalar/standalone.js`）から配信する。第三者オリジン依存ゼロ。生成物は `.gitignore` で除外済み（3.5 MB をリポジトリにコミットしない）。

**CSP**: `/api/_docs` のレスポンスに最小 CSP を付与する（`addDocsCsp` ミドルウェア）。同一オリジン配信後は外部オリジンが不要なため `connect-src 'self'` が主効果（万一のスクリプト注入でもデータ外部送信を遮断）。`script-src 'unsafe-inline'` は Scalar の inline 初期化スクリプト（`Scalar.createApiReference('#app', config)`）のために必要。

**実装**: `hono-openapi` の `describeRoute` を v1 の全ルートに追加してメタデータを付与し、`generateSpecs(v1App, ...)` で spec を生成。`@scalar/hono-api-reference` の `Scalar` ミドルウェアで UI を提供。`Scalar({ cdn: "/scalar/standalone.js", withDefaultFonts: false })` で外部 CDN とフォントサービスへの依存を排除。

## MCP サーバ（apps/mcp）

v1 REST を LLM（Claude Desktop / Claude Code 等）から扱うための MCP サーバ。`apps/mcp`（`private`、未公開）に置き、**stdio トランスポート**で動作する（LLM クライアントが子プロセスとして起動）。

- 認証: API キーを環境変数 `SUGARA_API_KEY` で受け取り `Authorization: Bearer` で v1 を叩く。接続先は `SUGARA_API_URL`。生キーはログ・エラーに出さない
- ツール: v1 の 27 エンドポイントに 1:1 対応する 29 ツール（batch 2 つを含む）。read 9 つ（`list_trips` / `get_trip` / `list_trip_expenses` / `list_bookmark_lists` / `list_bookmarks` / `list_articles` / `get_article` / `list_candidates` / `list_souvenirs`）+ write 20（`create_trip` / `update_trip` / `create_schedule` / `update_schedule` / `create_expense` / `update_expense` / `create_bookmark_list` / `update_bookmark_list` / `create_bookmark` / `update_bookmark` / `create_article` / `update_article` / `create_candidate` / `update_candidate` / `create_souvenir` / `update_souvenir` / `batch_create_candidates` / `batch_create_souvenirs` / `delete_candidate` / `delete_souvenir`）。入力は zod で境界検証（limit 1–100 / offset 0+ / uuid / scope enum）
- annotations: read ツールは `readOnlyHint: true`、create 系は `destructiveHint: false`、update/delete 系は `destructiveHint: true, idempotentHint: true` を明示し、MCP クライアント側の確認 UI 判断に供する
- エラー: v1 の `{ error: { code, message } }` を人間可読メッセージに写像（`isError: true`）
- stdio のため公開ネットワーク面はなく、攻撃面は「キーを持つローカルプロセス」に限定
- SDK: `@modelcontextprotocol/sdk`。実行はビルドせず `bun run src/index.ts`（モノレポの TS 直接実行規約に準拠）
- セットアップ手順は `apps/mcp/README.md`

## 今後の課題

- レート制限の具体値（IP 段の window/max）を実負荷に基づいて調整
- キー ID 単位のレート制限・`X-RateLimit-*` ヘッダ（公開拡大時に後方互換追加）
- 書き込み専用の低いレート制限（現状は read と同じ IP 300/min を適用）
- memberNo の安定化（現状は書き込み直前の `GET /trips/:id` での確認を要求。メンバー増減と書き込みが競合すると別メンバーに紐づくリスクが残る。恒久対応はメンバー参照のトークン化）
