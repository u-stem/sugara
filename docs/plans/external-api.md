# sugara 外部API 設計書（External Public API v1）

> ステータス: **設計中（ドラフト）** — 実装前にこの文書で合意形成する。`docs/plans/` は一時的な作業ドキュメントであり、実装完了後に削除し、確定版は `docs/architecture/external-api.md` に残す。

## 0. Context / 目的

内部APIはCookieセッション専用（`requireAuth` が `getSession` でCookieのみ参照、CORSは `FRONTEND_URL` 単一許可）で、外部のスクリプト・CLI・ローカルLLM/Claude からは叩けない。
アカウント保持者が**期限付きトークン**を発行し、それで自分の旅行データを外部から扱える機構を提供する。

### 消費者モデル（誰のための何か）

真の主消費者は **自分専用 + ローカル LLM/Claude** である。これを踏まえ、本機構は次のように位置づける:

- **v1 REST（Bearer）を下層の安定基盤**とする。サーバ間/CLI から直接叩ける最小の HTTP サーフェスを提供する
- **LLM 連携は将来この REST を薄くラップする MCP サーバで実現**する（MCP サーバ自体が認証付き HTTP サーフェスを必要とするため、REST を下層に置く本設計と競合せず**補完**関係になる）
- 主目的は「自分専用 + LLM」であり「不特定多数への External Public API」ではない。したがって §1 の Stable contract / Versioned / Swagger は**初期は最小限**に留め、DTO 安定化・`/v2` バージョニング・存在秘匿などの公開API向け重装備は**公開拡大時に格上げ**する段階設計とする（→ §1, §9）

確定方針（不変の前提）:
- デファクト準拠（Bearer / `/v1` / ハッシュ保存 / OpenAPI）
- 攻撃面は厳密（スコープ最小化・期限必須・レート制限・監査ログ・生キー1回表示・即時失効）
- 内部/外部を**構造的に分離**（外部は公開した操作しか存在しない独立ルーター）
- 認証は **self-hash 方式（自前実装・better-auth プラグイン不採用）**。`apikey` テーブルに高エントロピー乱数キーの SHA-256 ハッシュを保存し、発行・検証・スコープ照合を自前で行う（決定理由は後述）
- 初期は**読み取りのみ**、利用形態は**サーバ間/CLI**（ブラウザ直叩き非対応＝CORSを開けない）

> ✅ **認証方式の決定（self-hash 自前実装・プラグイン不採用）**: better-auth `apiKey` プラグインは v1.5 で独立パッケージ `@better-auth/api-key` に分離済みで、その採用には本体を 1.6.11→**1.6.15**（peer `^1.6.15`）へ更新する必要がある。だが 1.6.15 は調査時点（2026-06-09）で**前日 2026-06-08 リリース**＝本番認証基盤に載せるには未成熟で Phase 7b の 7 日ルール（`PACKAGE_MIN_AGE_DAYS=7`）にも抵触し、認証ライブラリ本体更新の影響範囲（ログイン/セッション/匿名ユーザー）も大きい。よって **better-auth は 1.6.11 据え置き、API キー認証は self-hash で自前実装する**（dependency-review 経由で決定）。
> - キー: `sk_` + `base64url(crypto.randomBytes(32))`。**生キーは発行時に1回だけ返し、DB には SHA-256 ハッシュのみ保存**（復元不能）
> - 検証: `requireApiKey` が Bearer 抽出 → SHA-256(token) で `apikey` 行を単一インデックス照合 → 有効性（行の存在・`expiresAt`）→ スコープを自前突合（fail-closed）
> - **この決定で消える設計負債**: プラグイン由来の不確実性（`permissions` 省略時 skip・`Record<string,string[]>` 構造照合・`lastRequest` write・エンドポイント無効化設定の非存在）が**全て不要**。さらにプラグインを入れないため `/api/auth/api-key/*` が生成されず、§2.1 の「二つの扉」「catch-all 404 遮断ミドルウェア」「`apiKey()` のアトミック投入」も**まるごと不要**になる（§2.1 / §2.2 のプラグイン前提節は self-hash 採用により無効。各節冒頭に注記）
> - 依存追加ゼロ・既存認証に無影響・サプライチェーン面積を増やさない。スコープは `apikey.scopes`（`text[]`、`["trips:read", ...]` のフラットラベル）に保存し配列照合するため、§2.2 の Record 構造への正準変換も不要

---

## 1. 設計原則（このAPIの約束事）

- **Stable contract**: 内部スキーマをそのまま晒さない。外部レスポンスは専用シェイプ（DTO）を定義し、内部DBカラム追加で勝手に露出が変わらないようにする
- **Least privilege**: スコープは必要最小限。未定義スコープの操作はルート自体が存在しない
- **Predictable errors**: エラーは機械可読な統一形（`code` + `message`）。情報漏洩しない粒度
- **Versioned**: 破壊的変更は `/v2` を切る。`/v1` 内では後方互換のみ
- **Observable**: 全リクエストにキーID・スコープ・status を監査ログ

> **装備量の段階方針（消費者モデルに基づく）**: 当面の利用者は自分専用 + LLM のため、Stable contract（DTO 安定化）・`/v2` ポリシー・Scalar Swagger UI・存在秘匿 404 などは**初期は最小限**で良い。ただし「内部エラーを外部に透過しない」「他人の内部 user uuid を出さない」「スコープ fail-closed」「認証前段のレート制限」といった**セキュリティ統制は初期から必須**で妥協しない。重装備のうち契約安定性に関わるものだけを公開拡大時に格上げする。

---

## 2. 認証 / 認可

### 2.1 トークン形式 / Bearer 抽出 / 検証

- ヘッダー: `Authorization: Bearer sk_xxxxxxxx`
- **発行**: 自前の `lib/external-api/api-key.ts`（`createApiKey` 関数）で実装。**生キーは `sk_` + `base64url(crypto.randomBytes(32))` で生成し、発行時に1回だけ返す。DB には SHA-256 ハッシュのみ保存**し、生キーは復元不可（§0）
- **検証**: 外部専用 `requireApiKey(scope)` ミドルウェアで自前の `verifyApiKey` 関数を呼び出す（Better Auth プラグイン不採用のため外部の OAuth/Session をバイパスして自前 DB のみ参照）

> ✅ **self-hash 採用により無効（撤回）**: かつての「プラグイン標準エンドポイントの無効化」「catch-all 404 遮断」「アトミック投入」の議論は、**プラグインを入れないため本問題は構造的に発生しない**。`/api/auth/api-key/*` は生成されず、ミドルウェア配線も不要。self-hash 採用により消える設計負債（§0）

**Bearer 抽出と status 写像（fail-closed・列挙対策）**:

- `requireApiKey` は `Authorization` を `^Bearer\s+(\S+)$` で**厳密パース**する。スキーム不一致・複数値・空トークンは即 `401 unauthorized`（理由を区別しない）
- 抽出したトークンを SHA-256 ハッシュ化し、`apikey.keyHash` と単一インデックス照合
- **有効性判定**（行の存在・`expiresAt > now`）のいずれかが偽で**全て一律 `401 unauthorized`**。欠落 / 期限切れ / 不正キーで**メッセージ・ステータスを区別しない**（応答差分によるキー列挙を防ぐ）
- `403 insufficient_scope` は**有効キー前提**なので区別してよい
- `Authorization` 全体ではなく抽出した `\S+` のトークンのみを検証に渡す

**v1 の user コンテキスト（AppEnv を流用しない）**:

自前 `verifyApiKey` の戻り値は `{ userId, scopes, expiresAt }` で、`userId`（`apikey.userId` 列）を認可判定に使う。`requireAuth` の full `AuthUser`（`name`/`email`/`isAnonymous` 等）を再現しない。

- v1 はアクセス判定を **`userId` のみ**から行い、`checkTripAccess(tripId, userId)`（`lib/permissions.ts`、純関数として抽出済み）を**直接呼ぶ**
- `AppEnv` 型の `requireTripAccess` ミドルウェアは**流用しない**（エラー応答が内部形・日本語メッセージで §3.1 と非互換のため。→ §4.2）。v1 専用の薄い access チェックを置く
- 読み取り専用かつ §5 で発行者は**本登録のみ＝ゲスト不可**のため、`guestExpiresAt` 判定も full user の再フェッチも**不要**（user 再フェッチ要否の論点はここでクローズ）

### 2.2 スコープ（permissions）

| スコープ | 説明 | v1初期 |
|---|---|---|
| `trips:read` | 旅行・日程・メンバーの読み取り | ✅ |
| `expenses:read` | 費用・精算の読み取り | ✅ |
| `articles:read` | 記事の読み取り（**自分の記事のみ**） | ✅ |
| `bookmarks:read` | ブックマークの読み取り（**自分のリストのみ**） | ✅ |
| `trips:write` | 旅行の作成・更新 | ❌（将来） |
| `expenses:write` | 費用の作成・更新・削除 | ❌（将来） |

- キー発行時に付与、検証時に必須スコープを照合
- **未定義スコープに対応するルートは実装しない**（存在しない＝叩けない）

**スコープ強制は fail-closed（配列照合・中央集権の唯一の入口）**:

`apikey` テーブルの `scopes` カラムは `text[]`（フラットなラベル配列。例: `["trips:read", "expenses:read"]`）で保存。`requireApiKey(scope)` ミドルウェアは要求スコープをこの配列に`includes` で突合し、なければ `403 insufficient_scope`。各ルートが個別にスコープチェックする設計では、チェック漏れの瞬間にスコープ昇格/バイパスになるため:

- **`requireApiKey(scope)` ミドルウェアを唯一の入口**とし、ルートハンドラはスコープチェックを直接呼ばない
- `scope` 未指定では**起動時に型エラー/拒否**となる fail-closed 設計にする（必須引数）。各ルートは要求スコープをミドルウェア引数として宣言する
- §4 の各エンドポイント定義の「スコープ」欄は、そのまま `requireApiKey(scope)` の引数に機械的に対応する

スコープラベルは以下4種（v1 初期）:

| スコープ | 説明 |
|---|---|
| `trips:read` | 旅行・日程・メンバーの読み取り |
| `expenses:read` | 費用・精算の読み取り |
| `articles:read` | 記事の読み取り（**自分の記事のみ**） |
| `bookmarks:read` | ブックマークの読み取り（**自分のリストのみ**） |

- `requireApiKey(scope)` は要求スコープを `apikey.scopes` 配列に直接 `includes` で突合。スコープ表のいずれかが必ず一致する（未定義スコープに対応するルートは存在しない）
- §8 チェック項目に「**スコープ未保有キーが実際に 403 insufficient_scope になる**」ことを確認する統合テストを追加する（チェック漏れによる素通りの回帰防止）

### 2.3 期限

- `expiresIn` 必須。サーバ側 `maxExpiresIn = 90日` で上限強制（**決定**: 読み取り専用かつ自分専用前提のため短めに倒す。長期常駐が必要なら再発行で更新する運用）
- **上限・スコープの権威的強制はルート側 Zod に置く（決定）**: `expiresIn ≤ maxExpiresIn` と `scopes ⊆ ホワイトリスト` の**権威的（authoritative）強制は §5 の `POST /api/api-keys` ルート側 Zod スキーマ**に置く。自前 `createApiKey` 関数は trusted server context で各検証に頼るため、ルート側 Zod を 1 行落とすと無期限・任意スコープのキーが発行できる。ルート Zod を単一の権威とする（§5 / §8）
- 失効・期限切れは即 `401`

> **決定**: スコープ粒度はリソース単位（`trips`/`expenses`）× 動作（`read`/`write`）の4分割で v1 を開始する。`members:read` 等の細分化は需要が出た時点で追加する（後方互換に追加できるため初期は粗く保つ）。

---

## 3. ベースパス / バージョニング / 共通仕様

- ベースパス: `/api/v1`
- Content-Type: `application/json`
- 認証: **`/api/v1` 配下は 100% Bearer 必須・例外なし**（`requireApiKey` 単一入口）。docs/openapi.json は `/api/v1` 名前空間に**置かず** Cookie 認証の内部名前空間にマウントするため、この不変条件に穴を開けない（→ §6）
- ページネーション: offset/limit（`limit` 既定 50・上限 100、`offset` 0 以上）で v1 を開始する（**決定**: cursor は件数規模が小さい現状では過剰。将来の大規模化時に cursor へ後方互換で移行）

### 3.0 レート制限（既存 IP 制限を流用・v1 専用機構は作らない）

> **決定（簡素化）**: v1 専用の新規レート機構（keyID 段・`keyFn` 一般化・`X-RateLimit-*` ヘッダ・二段構成）は**作らない**。既存 `rateLimitByIp`（`middleware/rate-limit.ts`）を `/api/v1` に適用するだけに留める。理由: 主消費者は自分専用・低トラフィックで、API キーは高エントロピー乱数のためブルートフォースは非現実的（防御の主役はキーのエントロピー）。新規二段機構が担えるのは「Upstash 正常時の DB 負荷平滑化」程度で実装コストに見合わない。keyID 単位の制御・レート残量ヘッダは**公開拡大（MCP 公開等）時に後方互換で追加**する。

- **適用**: `/api/v1` 全体（`v1App` 内、`requireApiKey` の前段）に既存 `rateLimitByIp({ window, max })` を置く。IP 単位で全リクエストを計上する
- **`max` は十分大きく**: 主消費者は単一/少数 IP 集中（CLI・ローカル LLM エージェント）で、正規のバースト読み取りが 429 を踏むとオーナー自身が弾かれる。オーナー単独 IP の平常バーストを十分上回る値にする（具体値は §9）
- **fail-mode は既存どおり fail-open**（`rate-limit.ts` の現挙動を変更しない。Upstash 到達不可時は通す。in-memory は同一インスタンス内の暴発抑制の best-effort）。**認証（`verifyApiKey`）は常に fail-closed**でレート可用性とは独立
**`lastRequest`/`lastUsedAt` 追跡の write（決定）**: self-hash 方式では `apikey` テーブルに最初からこれらの列を持たないため、**verify ごとの write はゼロ**。生キーを DB に保存しないことで、verify 実装も単純（SHA-256 照合のみ）且つ検証効率が高い。

### 3.1 エラーモデル（統一）

```json
{ "error": { "code": "unauthorized", "message": "..." } }
```
| HTTP | code | 用途 |
|---|---|---|
| 400 | `invalid_request` | パラメータ不正 |
| 401 | `unauthorized` | キー無効/欠落/期限切れ/失効 |
| 403 | `insufficient_scope` | スコープ不足 |
| 404 | `not_found` | リソース無し or アクセス権無し（存在を秘匿） |
| 429 | `rate_limited` | レート超過 |
| 500 | `internal_error` | 詳細は返さない |

**v1 専用エラーハンドラ（グローバル onError を継承しない）**:

グローバルの `app.onError(handleError)`（`lib/error-handler.ts`）は `/api/v1` で投げた例外にもそのまま適用され、`AppError.message` / `details` をレスポンスに含め、さらに `invalid input syntax for type uuid` を `400 invalid_id_format` に、`SyntaxError` を `invalid_json` にマップするなど**内部実装由来の文言・分類を外部に漏らす**。これは §1 の「内部 `ERROR_MSG` を流用しない」を無効化する。よって:

- **`/api/v1` ルーターは独立した `onError`（error boundary）を持つ**。グローバル `handleError` を継承しない
- 内部 `AppError` / `ERROR_MSG` を**一切透過させず**、§3.1 の `code` 体系のみへ写像する
- 未知例外は必ず **`500 internal_error`（詳細なし）に丸める**。DB 由来文言・内部分類は外部に出さない
- 内部の `ERROR_MSG`（日本語）を流用せず、外部用の安定した code 体系を新設する

**パラメータ検証は onError ではなくルート前段の Zod で行う（DB のパース例外に依存しない）**:

v1 専用 onError は未知例外を一律 `500 internal_error` に丸めるため、グローバル `handleError` の `invalid input syntax for type uuid → 400 invalid_id_format` 写像を**意図的に継承しない**。この状態で不正な uuid を `/api/v1/trips/:id` 等に渡すと、Postgres のパース例外が未知例外として `500 internal_error` に丸められ、§3.1 のエラーモデル表（`400 invalid_request` = パラメータ不正）と矛盾し、かつ不正 id が認証前段で弾けず無駄な DB ヒットを生む。よって:

- **パスパラメータ・クエリは §4 各エンドポイントで Zod により境界検証する**。`:id` / `:tripId` は **uuid スキーマ**で `requireApiKey` 直後（DB アクセス前）に検証し、不一致は `400 invalid_request` を返して**DB に到達させない**
- パラメータの妥当性は**ルート前段の Zod が唯一の権威**とし、DB のパース例外には依存しない（onError は予期せぬ内部例外のフォールバックに限定する）

**v1 を親の `app.use("*")` 前段ミドルウェアから外す（cors/requestLogger の v1 適用を断つ）**:

> ⚠️ **Hono 挙動の訂正**: 旧記述「`app.route("/api/v1", v1App)` で 1 点マウントすれば親の `cors`/`requestLogger`/`handleError` が v1 経路に効かない」は**不正確**。`app.ts:47-55` の `cors` と `requestLogger` は `app.use("*")` で親に登録されているため、サブアプリにマウントしても **`/api/v1/*` に対して必ず実行される**（`app.route` は親の wildcard ミドルウェアからサブアプリを遮蔽しない、実測で確認）。さらに**親 `*` ミドルウェア（cors/requestLogger）が v1 リクエスト処理中に投げた例外は、`v1App` の `onError` ではなく親 `handleError` に捕捉**され（実測で shape=PARENT_global、内部 message を透過）、§3.1 で塞いだはずの内部エラー形（`details`・日本語 `ERROR_MSG`・uuid 構文マップ）が `/api/v1` 応答に漏れうる。`v1App` 自身の `onError` がハンドラ内例外を捕捉するのは正しいが、それは**ハンドラ／`v1App` 内ミドルウェア由来の例外のみ**で、親 `*` ミドルウェア由来の例外は別途断つ必要がある。

この結果、放置すると (a) グローバル `cors` が `/api/v1` にも `Access-Control-Allow-Origin: FRONTEND_URL` + `credentials: true` を反射し、「CORS は開けない／サーバ間前提」という方針（§0/§6）と矛盾する、(b) 親 `requestLogger` が v1 でも走り `Authorization` ヘッダを通過させる（§7 の redact 設定は任意でなく**必須**になる）。よって:

- **親 `app` の `cors`/`requestLogger` を `app.use("*")` ブランケットから外す**。内部ルート専用サブルーター（または `/api/v1` を**除外**したパス指定）に付け替え、**v1 経路を親 `*` ミドルウェアから外す**。これにより親 `*` ミドルウェア由来の例外が `/api/v1` に漏れる経路自体を断つ
- v1 には **CORS ヘッダを一切付与しない**（`Access-Control-Allow-Origin` を返さない）。CORS が必要なら v1 用に `v1App` 内で別実装する（初期は不要）。`requestLogger` 相当が v1 で必要なら `v1App` 内に再実装し、`Authorization` を redact する
- v1 は**独立した Hono インスタンス（`v1App`）**として `app.route("/api/v1", v1App)` でマウントし、IP レート制限（既存 `rateLimitByIp` 流用）・`requireApiKey`・各ルート・v1 onError を**すべて `v1App` 内に置く**
- §8 チェック項目に「v1 応答に `Access-Control-Allow-Origin` が付かない」「v1 経路で（ハンドラ内および前段相当で）意図的に例外を投げても `internal_error`（詳細なし）のみが返り、親 `handleError` 形（details・日本語・uuid マップ）が出ない」テストを追加する

---

## 4. エンドポイント定義（v1 読み取り専用）

> レスポンスは**外部DTO**。内部カラム（`ownerId` 生ID 等）をそのまま出すかは各所の ❓ で決める。

**全エンドポイント共通: パスパラメータ・クエリは Zod で境界検証する（決定）**。`:id` / `:tripId` は uuid スキーマ、`scope` / `limit` / `offset` 等のクエリも対応スキーマで `requireApiKey` 直後（DB アクセス前）に検証し、不一致は `400 invalid_request`。DB のパース例外（uuid 構文エラー）に検証を委ねない（§3.1）。

**メンバー識別子 `memberNo` の導出（決定・全エンドポイント共通の不変条件）**:

メンバー / 支払者 / 分割先は、内部 user uuid・email を**一切出さず**、**trip 内ローカルの通し番号 `memberNo`（整数）+ `displayName`** で表現する。

旧案「HMAC-SHA256 による不透明 memberId」は**撤回**する。セキュリティの絶対則「**出していない情報は漏れない**」に照らすと、HMAC は内部 ID を鍵で変換して**出す**方式で、鍵漏洩・変換実装ミス・将来の解析という漏洩余地を原理的に残す。内部 ID を**そもそも出さない** `memberNo` 方式の方が攻撃面が小さく、かつ専用秘密鍵の env 管理・「鍵を一生変えられない」不変制約という運用負債も不要になる。さらに旧々案「`trip_member` 行 id 由来」も実装不能（現スキーマの `trip_members` は複合主キー `(tripId, userId)` のみで row id 列が無い（`db/schema.ts:205-220`）。`expenses.paidByUserId` / `expense_splits.userId` は `users.id` を直接参照（`schema.ts:575,597`））。定義:

- `memberNo` は trip の**現メンバー**（`trip_members` 行）を**安定順序**（`joinedAt` 昇順、同値は `userId` で tie-break）で並べた **1 始まりの通し番号**
- レスポンス内の members[] / payer / 各 split は、**`userId → memberNo` の単一マップ**で解決する（同一関数で一致を保証）

この方式は次の不変条件を満たす:

1. **内部 ID を出さない（絶対則）**: 内部 user uuid・email を外部に一切出さないため、第三者突合（相関）も逆算も「出していない情報」として原理的に不可能。秘密鍵も不要
2. **同一レスポンス内で payer と split が決定的に一致**: members[] / payer / split を同一の `userId → memberNo` マップで解決するため、同じ userId は同じ `memberNo` になり、**同名メンバーがいても払者/割り勘相手が正確に一致する**（表示名のみ方式の同名衝突を回避する目的）
3. **trip スコープに閉じ跨ぎ名寄せ不可**: `memberNo` は当該 trip のメンバー並び順から振る番号で内部 ID と無関係。別 trip の同一ユーザーが同じ番号になる保証はなく、複数 trip を跨いだ突合に使えない

- **費用に登場する userId は必ず現 `trip_members` に存在する**（不変条件）。根拠: (1) メンバー脱退 API は費用に紐づくメンバー（`paidByUserId` / `expenseSplits.userId` に登場）の削除を `has_expenses` で**拒否**する（`routes/members.ts:204-260`、TOCTOU 防止でトランザクション内チェック）、(2) アカウント削除時は `expenses.paidByUserId` / `expense_splits.userId` が `users.id` を `onDelete: cascade` で参照するため費用行ごと消える（`schema.ts:577,599`）。よって「費用行に残る脱退者」は発生せず、**全 payer/split は必ず `memberNo` を持ち members[] に存在する**（旧『脱退者は memberNo なし』規約は撤回。§4.3）
- members[] / payer / split が**単一の `userId → memberNo` マップ**で解決されることを**設計上の不変条件**として §7 に記す（秘密鍵は登場しない）

### 4.1 `GET /api/v1/trips`
自分がアクセスできる旅行の一覧。
- スコープ: `trips:read`
- Query: `scope=owned|shared`（任意）, ページネーション（`limit` 既定 50 / 上限 100、`offset` 0 以上。§3）
- **`scope` の定義（決定）**: `owned` = 自分が `owner` ロールの trip、`shared` = 自分が `editor`/`viewer` で参加する trip。省略時は両方を返す
- Response 200:
```json
{
  "data": [
    {
      "id": "uuid",
      "title": "string",
      "startDate": "2026-06-01",
      "endDate": "2026-06-05",
      "currency": "JPY",
      "role": "owner|editor|viewer",
      "memberCount": 3,
      "updatedAt": "ISO8601"
    }
  ],
  "pagination": { "limit": 50, "offset": 0, "total": 123 }
}
```
> **決定**: `mapsEnabled` / `totalSchedules` 等の内部算出フィールドは**外部に出さない**（最小セット）。

**v1 認可は `checkTripAccess` が単一防御線（決定・共通ラッパで構造的にスキップ不能化）**:

`schema.ts` は trips 等で `.enableRLS()` を宣言しているが、v1 が使う Drizzle の db 接続は**特権ロールで RLS をバイパス**するため、**RLS による多層防御（defense-in-depth）は v1 では効かない**。よって v1 のデータ露出防止は **app レベルの `checkTripAccess(tripId, userId)` のみが唯一の認可境界**になる。`:tripId` を取る 3 本のルートで個別に `checkTripAccess` を呼ぶ構造だと、1 本でも呼び忘れた瞬間に他人の trip が丸ごと露出する。よって:

- `:tripId` / `:id` を取る v1 データルートは、各ルートが個別に `checkTripAccess` を呼ぶのではなく、**共通ラッパ `withTripAccess(userId)`（純関数合成。uuid 検証 → `checkTripAccess` → 不可なら `404 not_found` 変換までを 1 箇所に閉じ込めた高階関数）で包み、構造的にスキップ不能**にする。新規ルート追加時も `withTripAccess` を通さないと `:tripId` ハンドラを書けない形にする
- §8 チェック項目に「**非メンバーキーで `trips/:id` と `trips/:tripId/expenses` が共に `404` になる**」テストを**ルート毎に**追加する（1 本だけ通る回帰を検出）

### 4.2 `GET /api/v1/trips/:id`
旅行詳細（日程・メンバー・スケジュール）。
- スコープ: `trips:read`（`requireApiKey("trips:read")`）+ trip メンバーであること
- **membership 判定**: 上記 **`withTripAccess(userId)` 共通ラッパ**を通す。`requireTripAccess` ミドルウェアは**流用しない**（エラー時に内部形 `{ error: ERROR_MSG.TRIP_NOT_FOUND }`（日本語）を返し §3.1 と非互換のため）。ラッパ内部で **`checkTripAccess(tripId, userId)`（純関数）を直接呼び**、アクセス不可は §3.1 の `404 not_found`（存在秘匿）へ変換する。再利用できるのは `checkTripAccess` / `canEdit` / `isOwner`（`lib/permissions.ts` の純関数）のみ。ミドルウェア（`requireTripAccess` / `requireAuth`）は不可
- Response 200: trip 基本情報 + `days[]`（日付・スケジュール）+ `members[]`（`memberNo`/`displayName`/`role`）
- **メンバー DTO（決定）**: `email` も**内部 user uuid も出さない**。上記**共通の `memberNo` 導出**（trip 内ローカルの通し番号）で解決した **`memberNo` + `displayName` + `role`** を返す。内部 ID を出さないこと自体が相関・逆算の絶対的な防御になる（出していない情報は漏れない）
- **`members[]` の集合定義（注記）**: `members[]` は trip の現メンバー（`trip_members` 行）を列挙し `memberNo` を振る。**費用に登場する payer/split の userId は必ずこの集合に含まれる**（§4 の不変条件: 費用に紐づくメンバーは脱退できず、アカウント削除時は費用行ごと cascade で消えるため）。よって消費側は `payer`/`split` の `memberNo` を `members[]` に**確実に join できる**

### 4.3 `GET /api/v1/trips/:tripId/expenses`
費用一覧。
- スコープ: `expenses:read`（`requireApiKey("expenses:read")`）+ メンバー（§4.2 と同じ **`withTripAccess(userId)` 共通ラッパ**を通す。個別呼びにしない）
- Query: ページネーション（`limit` 既定 50 / 上限 100、`offset` 0 以上。§3 と同じ。費用は件数が伸びうるため trips 一覧と同じく必ず適用する）
- Response 200: `data[]`（金額・通貨・カテゴリ・支払者・日付・分割）+ `pagination`（§4.1 と同形）
- **支払者/分割 DTO（決定）**: 内部 user uuid を出さず、§4.2 と同じ**共通の `memberNo`**（現メンバーの場合）+ `displayName` で表現する（支払者・各分割先とも）。`memberNo` は同一の `userId → memberNo` マップで解決するため、members[] と payer/splits が**同一関数で解決され一致する**（同名でも一致する）

**費用参加者は必ず現メンバー（不変条件・脱退者規約は撤回）**:

旧設計は「`expenses.paidByUserId` / `expense_splits.userId` は `users.id` 直参照の独立 FK だから脱退後も費用行が残り、payer/split に現メンバー外の userId が出る」と仮定し、脱退者解決規約（`former_member` プレースホルダ等）を置いていた。この**前提は誤り**で、規約ごと撤回する。実コード確認:

- メンバー脱退 API は、費用に紐づくメンバー（`paidByUserId` / `expenseSplits.userId` に登場）の削除を **`has_expenses` で拒否**する（`routes/members.ts:204-260`。TOCTOU 防止でトランザクション内チェック）。費用が残る限りそのメンバーは `trip_members` に残り続ける
- アカウント削除時は `expenses.paidByUserId` / `expense_splits.userId` が `users.id` を **`onDelete: cascade`** で参照するため、費用行・split 行ごと消える（`schema.ts:577,599`）

よって **「費用に登場する userId は必ず現 `trip_members` に存在する」が不変条件として成立**し、payer/split は常に `memberNo` を持ち members[] に join できる。`displayName` も members[] から引けるため個別解決も不要。

> **防御的フォールバック（任意・最小）**: 将来この不変条件（脱退時 `has_expenses` 拒否 / users 削除 cascade）が崩れると payer/split に未知 userId が現れうる。その場合も **`500` にはせず**、`memberNo` を欠いた `displayName` のみで表現するフォールバックを実装段階で 1 箇所だけ用意してよい（常態ではなく不変条件破れの保険）。

### 4.4 記事（`articles:read`・自分の記事のみ）

記事は個人所有（`articles.ownerId`）+ `visibility`（private/friends_only/public）+ `articleTrips` で trip に多対多紐付け（`schema.ts:418-470`）。**v1 は自分の記事のみ**を返す（owned 限定）ため、`isArticleVisibleTo`（friends/trip context 判定）は v1 では**使わず**、`ownerId === userId` だけで境界が完結する（公開拡大時に可視判定を導入）。

**アクセス境界（決定・所有者一致のみ）**: trip の `withTripAccess` のような共通ラッパは不要。一覧は **`where ownerId = userId` でクエリ自体を絞る**。詳細 `:id` は記事取得後に `article.ownerId === userId` を確認し、不一致は §3.1 の `404 not_found`（存在秘匿）。`:id` は uuid を Zod 境界検証（§3.1 / §4 共通）。

#### 4.4.1 `GET /api/v1/articles`
自分の記事一覧。
- スコープ: `articles:read`（`requireApiKey("articles:read")`）
- Query: ページネーション（`limit` 既定 50 / 上限 100、`offset` 0 以上。§3）
- Response 200: `data[]`（`id` / `title` / `tags` / `visibility` / `tripIds`（紐付く旅行の id 配列）/ `createdAt` / `updatedAt`。**一覧は本文を返さない**か先頭抜粋に留める）+ `pagination`（§4.1 と同形）

#### 4.4.2 `GET /api/v1/articles/:id`
自分の記事詳細。
- スコープ: `articles:read` + `ownerId === userId`（不一致は `404`）
- Response 200: `id` / `title` / `content`（本文 full）/ `tags` / `visibility` / `tripIds`（紐付く旅行の id 配列）/ `createdAt` / `updatedAt`
- **DTO（決定）**: 内部 `ownerId`（uuid）は出さない。`articleTrips` の紐付け `tripId` は **`tripIds` 配列として出す**（LLM が記事と旅行を関連付けられるよう初期から提供。trip の `id` は §4.1 で既に外部に出している識別子なので一貫する）。`likeCount`/`likedByMe` は自分用途では不要のため出さない

### 4.5 ブックマーク（`bookmarks:read`・自分のリストのみ）

`bookmarkLists`（`userId` 所有 + `visibility`）配下に `bookmarks`（個別 visibility なし、リストの可視性に従う。`schema.ts:382-413`）。**v1 は自分が所有するリストのみ**を返す。

**アクセス境界（決定・所有者一致のみ）**: 一覧は **`where userId = userId`**。リスト内ブックマークは `listId` のリストを取得し `list.userId === userId` を確認、不一致は `404`（既存 `verifyListOwnership` 相当を `lib/` に純関数抽出して再利用。`bookmarks.ts:25-31` のローカル関数のままでは流用しない＝§8）。`:listId` は uuid を Zod 境界検証。

#### 4.5.1 `GET /api/v1/bookmark-lists`
自分のブックマークリスト一覧。
- スコープ: `bookmarks:read`（`requireApiKey("bookmarks:read")`）
- Query: ページネーション（§3）
- Response 200: `data[]`（`id` / `name` / `visibility` / `bookmarkCount` / `createdAt` / `updatedAt`）+ `pagination`

#### 4.5.2 `GET /api/v1/bookmark-lists/:listId/bookmarks`
リスト内のブックマーク。
- スコープ: `bookmarks:read` + `list.userId === userId`（不一致は `404`）
- Query: ページネーション（§3）
- Response 200: `data[]`（`id` / `name` / `memo` / `urls` / `createdAt` / `updatedAt`）+ `pagination`
- **DTO（決定）**: 内部 `userId` / `listId`（uuid）は出さない

> **決定**: v1初期は **7本**（trips 一覧 / trip 詳細 / expenses 一覧 / 記事一覧 / 記事詳細 / ブックマークリスト一覧 / リスト内ブックマーク）で開始する。記事・ブックマークは**自分が所有するもののみ**（友達公開・trip 共有・他人の public の取り込みは公開拡大時）。`GET /trips/:id/schedules` 単体や精算サマリ（`/settlements`）は需要を見て後方互換で追加する。

---

## 5. キー管理API（内部・Cookie認証、`/api/...`）

外部公開ではなく Web 設定画面から使う。**キー発行の唯一の経路**。`requireAuth` + **本登録ユーザーのみ（ゲスト不可）**。

- `POST /api/api-keys` — 発行。Body: `{ name, expiresIn, scopes[] }`。**ルート側 Zod を権威的強制とし**（`expiresIn ≤ maxExpiresIn`＝90日・`scopes ⊆ ホワイトリスト`）、検証を通過したものだけ自前の `createApiKey()` 関数を呼ぶ。関数内で (1) `crypto.randomBytes(32)` で高エントロピー乱数を生成し `sk_` + `base64url()` で生キーを成形、(2) SHA-256 ハッシュを計算して `apikey.keyHash` に保存、(3) 先頭8文字を `apikey.start` に保存（一覧表示用）、(4) **生キーを1回だけレスポンス本文で返す**（再発行不可・生キーは復元不能）
- `GET /api/api-keys` — 自分のキー一覧（メタのみ: `name` / `start` / `scopes` / `expiresAt`）。生キー・hash は返さない。§3.0 で verify 毎 write をゼロに設計したため `lastUsedAt` は列そのものが無い
- `DELETE /api/api-keys/:id` — 即時失効（所有者チェック）

**資格情報ローテーション時のキー失効（決定）**:

API キーのライフサイクルは**アカウント資格情報から分離**しており、`verifyApiKey` は `apikey` 行のみを参照する。これを放置すると、アカウント侵害後にパスワードを変えても、攻撃者が握った発行済みキーで**最大 90 日読み取りを継続**できる。よって:

- **パスワードリセット時に、当該ユーザーの全 API キーを失効させる**（Better Auth の `databaseHooks` か reset コールバックで該当 `userId` の `apikey` 行を一括 delete する）。セッション全失効と API キー失効を**同じ資格情報ローテーション境界**で揃える
- §7 のセキュリティ統制に「資格情報ローテーション時のキー失効」を 1 項目として追加する（→ §7, §8）

**ゲスト不可の明示ガード（決定）**: `requireAuth`（`middleware/auth.ts`）は**ゲスト（`isAnonymous`）を弾かない**（`guestExpiresAt` 期限切れのみ 401 にするだけで、期限内の匿名ユーザーは通過する）。よって `requireAuth` の後段で `user.isAnonymous` を弾く**明示ガード（`403`）= `requireNonGuest`** を追加する。汎用の「本登録必須」ミドルウェアが無ければ新設し、§5 のキー発行ルートに適用する。

Web UI: 設定配下にトークン管理画面（発行=期限/スコープ選択、一覧、失効）。発行直後のみ生キー表示＋コピー、再表示不可を明記。専門用語を避けた文言。

---

## 6. OpenAPI / Swagger

- `hono-openapi` で v1 ルートに `describeRoute()` を後付け、`@scalar/hono-api-reference` でUI
- spec/UI の**マウント先は `/api/v1` の外**（Cookie 認証の内部名前空間）。例: `GET /api/_docs/openapi.json`（spec）, `GET /api/_docs`（UI）
- Bearer セキュリティスキームを明記、v1（外部公開分）のみ記載

**マウント位置と単一入口の不変条件（決定）**: `openapi.json` / `/docs` を `/api/v1` 名前空間に置くと、Bearer 専用ルーター `v1App`（§3.1 の単一マウント）内に Cookie 認証ルートが同居し、§2.2 の「`/api/v1` は全て Bearer / `requireApiKey` 単一入口」という fail-closed 不変条件を破る（`requireApiKey` を回避して `requireAuth` を当てる特例配線が必要になり、配線ミスで docs が無認証露出するリスクが生じる）。よって:

- **docs/openapi.json は `/api/v1` ではなく内部 Cookie 名前空間（例 `/api/_docs`）にマウント**し、`/api/v1` 配下からは外す。これにより「`/api/v1` = 100% Bearer・`requireApiKey` 単一入口」を保つ（§2.2 / §3）
- `/api/_docs` 系は **Cookie 認証（本登録ユーザー）+ `requireNonGuest` 配下**に置き、同一オリジンの設定画面から閲覧させる。将来の write 系・内部専用ルートを spec に含めない（Cookie 認証下なので未認証クローラは到達できず `noindex` は本来冗長。付与は任意）
- Scalar の Try-it は**同一オリジンで動く**ため CORS を開ける必要はない（外部公開エンドポイント化しない）

**公開可否（決定）**: `openapi.json` と `/docs` は**無認証で公開しない**。無認証公開は外部 API の存在・全エンドポイント構造・パラメータを攻撃者に開示し攻撃面マッピングを容易にするうえ、「CORS を開けない/サーバ間前提」というスタンスとも矛盾する。

> ❓ zod 互換: `packages/shared` の zod バージョンが `hono-openapi` のアダプタと噛み合わない場合、spec を別生成して Scalar 配信のみにフォールバック。

---

## 7. セキュリティ統制（実装時 security-audit で検証）

- **キー発行経路は1つに限定**し、自前 `lib/external-api/api-key.ts` の `createApiKey()` 関数を §5 ルート（`requireAuth + requireNonGuest`）からのみ呼ぶ。self-hash 採用により外部エンドポイント生成の心配がない（§0 / §2.1）
- **生キーは SHA-256 ハッシュ保存・1回表示・復元不能**: 生キーは発行時に 1 回だけレスポンスで返し、DB には SHA-256 ハッシュのみ保存。検証は生キーに対して SHA-256 を計算し `apikey.keyHash` と一致照合。不要な write がないため verify 毎 DB 負荷なし（§3.0）
- **生キーのログ混入を契約で防ぐ（決定）**: pino に redact パス（`req.headers.authorization`, `*.apiKey`, `*.rawKey`, `*.token` 等）を**恒久設定**し、生キーを logger に渡さないことを実装条件とする。キー発行レスポンスのボディは**一切ログ化しない**（→ §8 チェック項目）
- 期限必須 + 上限（`maxExpiresIn=90日`、**権威的強制はルート側 Zod**＝§2.3）+ 失効後即401、スコープ昇格不可（`requireApiKey(scope)` 配列照合・fail-closed）
- **スコープ照合は配列照合で fail-closed**: `apikey.scopes` を `text[]` フラットラベルで保存し、`requireApiKey(scope)` で要求スコープを `includes` で直接突合。プラグイン不採用のためプラグイン挙動 verify は不要（§2.2）
- **v1 認可は `checkTripAccess` が単一防御線**（特権ロール接続で RLS バイパス＝多層防御なし）。`:tripId` ルートは共通ラッパ `withTripAccess(userId)` で構造的にスキップ不能化する（§4.2 / §4.3）
- **レート制限は既存 `rateLimitByIp` を `/api/v1` に流用**（v1 専用の keyID 段・二段機構・`X-RateLimit-*` は作らない＝§3.0）。**認証（`verifyApiKey`）は常に fail-closed**、レート制限は既存どおり **fail-open**（Upstash 障害時は通す。in-memory は best-effort）。ブルートフォース耐性の主役はキーの高エントロピー。IP 段は全リクエスト計上のため、`max` は単一 IP 集中の正規バーストを許容する十分大きい値（§3.0、具体値 §9）
- **v1 に CORS ヘッダを付与しない**: 親 `cors`/`requestLogger` は `app.use("*")` で v1 にも効くため、wildcard から外して `/api/v1` を除外し、`Access-Control-Allow-Origin` を v1 応答に一切付けない。親 `*` ミドルウェア由来例外が親 `handleError` で内部形漏洩する経路も同時に断つ（§3.1）
- **資格情報ローテーション時のキー失効**: パスワードリセット時に当該ユーザーの全 API キーを失効させ、セッション全失効とキー失効を同じ境界で揃える（§5）
- **v1 は独立 Hono インスタンス（`v1App`）でマウントし、親 `cors`/`requestLogger` を `app.use("*")` から外して `/api/v1` を除外**する（マウントだけでは親 wildcard ミドルウェアを遮蔽できない）。これにより前段ミドルウェアの例外を親 `handleError` に漏らさない（§3.1）。**パラメータは Zod 境界検証**で `400 invalid_request`、DB のパース例外に依存しない（§3.1 / §4）
- **v1 専用 onError** で内部 `AppError`/`ERROR_MSG` を透過させず §3.1 の code 体系へ写像、未知例外は `500 internal_error`（詳細なし）（§3.1）
- `404` でリソース存在を秘匿、エラーは詳細を返さない
- 外部DTOで内部フィールド露出を遮断。メンバー email を出さないのに加え、**他メンバーの内部 user uuid も出さず** trip 内ローカルの `memberNo`（通し番号）+ `displayName` に解決（§4.2 / §4.3）。内部 ID を出さないこと自体が相関・逆算の絶対的防御（出していない情報は漏れない）。秘密鍵は使わない
- **`memberNo` は単一の `userId → memberNo` マップで解決**することを不変条件とする。`members[]` と payer/splits が必ず同一マップで一致し（同名でも一致）、脱退者は `memberNo` なし + `displayName` で表現する（§4.2 / §4.3）
- 監査ログ: キーID/userId/scope/status を構造化記録

---

## 8. 実装フェーズ（設計確定後に着手）

1. **`apikey` テーブル自前定義 + `lib/external-api/api-key.ts` 実装** — `db-schema-change` skill
   - (a) `db/schema.ts` に `apikey` テーブルを追加: `id` (uuid pk) / `userId` (uuid, `references users(id) onDelete cascade`)  / `name` / `keyHash`(SHA-256 hex) / `start`(先頭8文字) / `scopes`(`text[]`) / `expiresAt` / `createdAt`。**`userId` は `references users(id) onDelete cascade`** を明記し、ユーザー削除でキー行も消えること（孤児化防止）を保証する（§5）。`lastRequest`/`lastUsedAt` は持たない（verify 毎 write 排除のため）
   - (b) `lib/external-api/api-key.ts` に `createApiKey(userId, name, expiresIn, scopes): { rawKey, keyHash, start }` 関数を実装。内部で `crypto.randomBytes(32)` → `sk_` + `base64url()` 生成、SHA-256 ハッシュ計算、DB 保存、生キー 1 回返す（§2.1 / §5）
   - (c) `lib/external-api/api-key.ts` に `verifyApiKey(token): { userId, scopes, expiresAt } | null` 関数を実装。Bearer token に対して SHA-256 ハッシュ化し `apikey.keyHash` インデックス照合、有効性判定（行存在・期限）。スコープ照合はここではなく `requireApiKey` ミドルウェアで実施（§2.1 / §2.2）
   - (d) Better Auth の `databaseHooks`（または reset コールバック）でパスワードリセット時に当該 `userId` の全 `apikey` 行を一括 delete する配線を追加（§5）
   - `bun run db:generate` で migration 生成（`db-schema-change` skill に従う）
2. **`requireApiKey` ミドルウェア + 外部DTO + v1 読み取りルート + レート制限 + v1 onError**
   - **v1 を独立 Hono インスタンス `v1App` として `app.route("/api/v1", v1App)` でマウント**し、**親 `app` の `cors`/`requestLogger` を `app.use("*")` から外して `/api/v1` を除外**する（親 wildcard ミドルウェアは v1 にも効くため。マウントだけでは遮蔽されない）。IP レート制限（既存 `rateLimitByIp` 流用）・`requireApiKey`・各ルート・v1 onError を全て `v1App` 内に置く。v1 応答に `Access-Control-Allow-Origin` を付けない（§3.1）
   - `requireApiKey(scope)` を fail-closed（scope 必須）で実装、Bearer 厳密パース `^Bearer\s+(\S+)$`、`verifyApiKey` が null なら一律 401。スコープは `verifyApiKey` の戻り値 `scopes` 配列に対して `includes` で直接突合。スコープ未保有なら 403 insufficient_scope（§2.1 / §2.2）
   - **パスパラメータ・クエリの Zod 境界検証**（`:id`/`:tripId` は uuid、不一致は `400 invalid_request`、DB 到達前）（§3.1 / §4）
   - v1 専用 access ガードを **`withTripAccess(userId)` 共通ラッパ**として実装し、`:tripId` ルートを構造的にスキップ不能化（内部で `checkTripAccess` 直呼び→404 変換。`requireTripAccess`/`requireAuth` は流用しない。RLS バイパスのため単一防御線）（§4.2 / §4.3）
   - **v1 専用 onError** を実装し、グローバル `handleError` を継承しない（§3.1）
   - 既存 `rateLimitByIp({ window, max })` を `/api/v1`（`v1App` 内、`requireApiKey` 前段）に適用するのみ。**v1 専用の keyID 段・`keyFn` 一般化・`X-RateLimit-*` は作らない**（公開拡大時に後方互換で追加）。`max` は単一 IP 集中の正規バーストを許容する十分大きい値（§3.0）
   - 外部 DTO（**`memberNo`＝trip 現メンバーを `joinedAt` 昇順・`userId` tie-break で並べた 1 始まりの通し番号** を単一 `userId → memberNo` マップで解決。内部 uuid/email 非露出、秘密鍵なし）。費用参加者は必ず現メンバーのため payer/split も members[] に join 可能（§4）
   - 記事・ブックマークの read ルート（**自分のもののみ**）: 記事は一覧 `where ownerId = userId` / 詳細は取得後 `ownerId === userId` 確認→不一致 `404`。ブックマークは一覧 `where userId = userId` / リスト所有確認は **`verifyListOwnership` 相当を `lib/` に純関数抽出して再利用**（`bookmarks.ts:25-31` のローカルのままは流用しない）。owned 限定のため `isArticleVisibleTo`（friends/trip context 判定）は v1 では使わない。DTO は内部 uuid 非露出。`articleTrips` は `tripIds` 配列として出す（trip の id は外部に出る識別子＝一貫。記事↔旅行の関連付けを LLM に提供）（§4.4 / §4.5）
3. キー管理API（`requireAuth + requireNonGuest`、単一発行経路）+ Web設定UI（`start` 表示）
4. OpenAPI/Swagger（v1のみ、Cookie 認証配下 + noindex）（§6）
5. ドキュメント（`docs/architecture/external-api.md`）+ FAQ/お知らせ（ja/en、`feature-update` skill）

**実装時チェック項目（抜粋）**:
- [ ] **生キーが DB に平文保存されない**（`apikey.keyHash` に SHA-256 ハッシュのみ保存。`apikey.start` に先頭8文字のみ保存）
- [ ] **SHA-256 照合で有効/失効/期限切れが正しく判定される**（`verifyApiKey` テスト）。有効でないキーが全て 401 unauthorized（理由区別なし）
- [ ] `requireApiKey` は scope 未指定で起動時拒否（fail-closed）
- [ ] **スコープ配列照合で実装**: `apikey.scopes` を `includes` で直接突合、スコープ未保有キーが 403 insufficient_scope になる（統合テスト）
- [ ] **上限超過 `expiresIn` / ホワイトリスト外スコープでの発行リクエストが `400` で拒否される**（ルート Zod が権威）
- [ ] 親 `cors`/`requestLogger` が `/api/v1` から除外され、**v1 応答に `Access-Control-Allow-Origin` が付かない**
- [ ] v1 が独立 Hono インスタンスでマウントされ、（ハンドラ内および前段相当で）意図的に例外を投げても `internal_error`（詳細なし）のみが返り親 `handleError` 形が出ない
- [ ] v1 ルーターが独立 onError を持ち内部 `AppError`/`ERROR_MSG` を透過しない
- [ ] 不正 uuid のパスパラメータが `400 invalid_request` になり DB に到達しない（Zod 境界検証）
- [ ] **非メンバーキーで `trips/:id` と `trips/:tripId/expenses` が共に `404`** になる（`withTripAccess` 共通ラッパ。ルート毎にテスト）
- [ ] **他人の記事 `articles/:id` / 他人のリスト `bookmark-lists/:listId/bookmarks` が `404`**（owner 不一致）。一覧 `articles` / `bookmark-lists` は自分が所有するものだけ返る
- [ ] `lib/logger.ts` に redact パス設定済み、発行レスポンスをログ化しない
- [ ] 外部 DTO に内部 user uuid / email が含まれない。`memberNo` は単一 `userId → memberNo` マップで members[] と payer/splits が一致する（同名でも一致）。費用参加者が必ず members[] に含まれる（脱退拒否 + cascade）ことをテスト
- [ ] `apikey.userId` が `onDelete cascade`、パスワードリセットで当該ユーザーの全キーが失効する
- [ ] レート制限は既存 `rateLimitByIp` を `/api/v1` に適用するのみ（v1 専用 keyID 段・`X-RateLimit-*` は作らない）。レートは fail-open、認証は fail-closed

最小スライス（trips read + キー発行 + curl 疎通）を1本目PRに。

---

## 9. 決定事項 / 残課題

第1巡レビューで以下を確定した。

- [x] **スコープ粒度**: `trips`/`expenses` × `read`/`write` の4分割で開始。細分化は需要次第で後方互換追加（§2.2）
- [x] **`maxExpiresIn`**: 90日（読み取り専用 + 自分専用前提で短めに倒す）（§2.3）
- [x] **ページネーション**: offset/limit（既定 50 / 上限 100）。cursor は将来移行（§3）
- [x] **レート制限の機構と fail-mode**: v1 専用の新規機構（keyID 段・二段・`keyFn` 一般化・`X-RateLimit-*`）は**作らず、既存 `rateLimitByIp` を `/api/v1` に流用**するだけに簡素化。理由: 主消費者は自分専用・低トラフィックでキーが高エントロピー＝ブルートフォースは非現実的、新規機構は DB 負荷平滑化程度の価値しか無く実装コストに見合わない。レートは既存どおり fail-open、認証は常に fail-closed。keyID 単位・レート残量ヘッダは公開拡大時に後方互換追加。具体値（IP 段 max）は残課題（§3.0 / §7）
- [x] **上限・スコープの権威的強制位置**: ルート側 Zod を単一権威とする。自前 `createApiKey` 関数は trusted server context（§2.3 / §5）
- [x] **v1 への親ミドルウェア適用**: 親 `cors`/`requestLogger` は `app.use("*")` で v1 にも効く（マウントだけでは遮蔽されない）ため、wildcard から外して `/api/v1` を除外。v1 に CORS ヘッダを付けず、親 `*` 由来例外の `handleError` 漏洩経路も断つ（§3.1 / §7）
- [x] **v1 認可の単一防御線**: RLS は特権ロール接続でバイパスされ多層防御が無いため、`checkTripAccess` を唯一境界とし `:tripId` ルートを共通ラッパ `withTripAccess(userId)` で構造的にスキップ不能化（§4.2 / §4.3 / §7）
- [x] **メンバー識別子**: HMAC 不透明 memberId 案・`trip_member` 行 id 案をいずれも撤回。**trip 内ローカルの通し番号 `memberNo`（`joinedAt` 昇順・`userId` tie-break の 1 始まり）+ `displayName`** で表現。内部 user uuid / email を出さない＝「出していない情報は漏れない」絶対則で相関・逆算を防ぎ、秘密鍵も不要。members[]/payer/split を単一 `userId → memberNo` マップで解決し同名でも一致（§4.2 / §4.3 / §7）
- [x] **費用参加者は必ず現メンバー（脱退者規約は撤回）**: 費用に紐づくメンバーは脱退 API が `has_expenses` で拒否（`members.ts:204-260`）、アカウント削除時は費用行が cascade で消える（`schema.ts:577,599`）。よって payer/split の userId は常に現 `trip_members` に存在し `memberNo` を持つ。旧『脱退後も費用行が残る』前提と `former_member` 規約は誤りとして撤回（§4.3）
- [x] **スコープの配列照合**: スコープを `apikey.scopes`(`text[]`)で保存し `requireApiKey` で `includes` 直接突合。未保有キーが 403 になることをテスト（§2.2 / §8）
- [x] **キーのライフサイクル**: `apikey.userId` を `onDelete cascade`、パスワードリセットで全キー失効（§5 / §8-1）
- [x] **v1 のマウント**: 独立 Hono インスタンス（`v1App`）をマウントしたうえで、**親 `cors`/`requestLogger` の `app.use("*")` から `/api/v1` を除外**する（マウントだけでは親 wildcard を遮蔽できないという Hono 挙動の訂正を反映）。前段例外の親 `handleError` 漏れと v1 への CORS ヘッダ付与を同時に断つ（§3.1 / §7）
- [x] **パラメータ検証**: パスパラメータ・クエリを Zod 境界検証（uuid 等）、`400 invalid_request`、DB のパース例外に依存しない（§3.1 / §4）
- [x] **`lastUsedAt` 追跡**: verify 毎 write を排除するため `lastRequest`/`lastUsedAt` 更新を無効化し DTO から外す（§3.0 / §5）
- [x] **外部DTO**: 最小セット。内部算出フィールド非露出、メンバー/支払者/分割は `memberNo`（trip 内通し番号）+ `displayName`、内部 user uuid / email を出さない（§4.1 / §4.2 / §4.3）
- [x] **v1初期エンドポイント本数**: 7本（trips 一覧 / trip 詳細 / expenses 一覧 / 記事一覧 / 記事詳細 / ブックマークリスト一覧 / リスト内ブックマーク）。記事・ブックマークは**自分が所有するもののみ**で開始（友達公開・trip 共有・他人 public は公開拡大時に後方互換追加）。スコープ `articles:read` / `bookmarks:read` を追加。owned 限定のため可視判定（`isArticleVisibleTo`/friends/trip context）は v1 では不要で `ownerId === userId` / `userId === userId` で境界完結（§2.2 / §4.4 / §4.5）
- [x] **docs/openapi.json の公開可否**: 無認証公開しない。`/api/v1` の外（内部 Cookie 名前空間 `/api/_docs`）に Cookie 認証 + noindex でマウントし、`/api/v1` = 100% Bearer を保つ（§6）
- [x] **認証方式**: **better-auth は 1.6.11 据え置き、新規依存なし**。API キー認証は self-hash で自前実装（`lib/external-api/api-key.ts`）。生キー SHA-256 ハッシュ保存・1 回表示・復元不能・verify 毎 write ゼロ（§0 / §2.1 / §8-1）
- [x] **消費者モデル**: v1 REST を下層基盤、LLM 連携は将来 MCP ラッパで補完。重装備は公開拡大時に段階格上げ（§0 / §1）

残課題:
- [ ] レート制限の具体値（IP 段の window/max）— 実装時に負荷見積りで確定。**IP 段 `max` は、主消費者が単一/少数 IP 集中（CLI・ローカル LLM エージェント）でかつ全リクエスト計上のため、オーナー単独 IP の平常バースト読み取りを十分上回る値に設定**し、正規バーストが 429 を踏まないようにする（§3.0）
- [ ] zod ⇄ `hono-openapi` アダプタ互換（噛み合わない場合は spec 別生成 + Scalar 配信のみにフォールバック）（§6）
