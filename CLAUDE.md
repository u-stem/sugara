@~/ws/claude-system/adapters/claude-code/project-fragments/web-apps-common.md

# sugara - 旅行計画アプリ

## プロジェクト概要

旅行計画Webアプリ。Turborepo + bun workspaces によるモノレポ構成。

## 構成

```
apps/web/         Next.js 16 (App Router) + Tailwind CSS v4 + shadcn/ui + Hono API (Route Handler)
apps/api/         Hono API ルート・DB スキーマ・認証 (Next.js Route Handler として統合)
packages/shared/  共有 Zod スキーマ・型定義
```

## コマンド

プロジェクトルートから `bun run` で実行:

```bash
bun run build        # 全パッケージビルド
bun run test         # 全テスト実行 (vitest)
bun run lint         # 全パッケージ lint (Biome via turbo)
bun run format       # 全パッケージ format (Biome via turbo)
bun run check        # lint + format + import sort (Biome via turbo)
bun run check-types  # TypeScript 型チェック
bun run db:generate  # マイグレーション生成 (スキーマ変更後に実行)
bun run db:migrate   # マイグレーション実行 (ローカル。本番は Vercel デプロイ時に自動実行)
bun run db:studio    # Drizzle Studio 起動
bun run db:seed      # 開発用シードデータ投入
bun run db:seed-user # 本番用ユーザー作成 (環境変数で指定)
bun run db:seed-faqs # FAQ データ投入
bun run db:cleanup-guests  # 期限切れゲストユーザーを削除
bun run test:coverage      # カバレッジ付きテスト
bun run test:e2e           # E2E テスト (Playwright)
```

パッケージ単位の実行は `--filter` を使用:

```bash
bun run --filter @sugara/api test
bun run --filter @sugara/web lint
bun run --filter @sugara/shared check-types
```

**`cd <dir> && ...` パターンは絶対に使わない。常に `bun run` または `bun run --filter` を使う。**
**`bunx` は使わない。全ツールは package.json スクリプトで定義済み。**

## 技術スタック

- ランタイム: bun
- フロントエンド: Next.js 16, React 19, Tailwind CSS v4, shadcn/ui (New York, Zinc)
- API: Hono (Next.js Route Handler `apps/web/app/api/[[...route]]/route.ts` として統合)
- DB: Supabase PostgreSQL + Drizzle ORM
- リアルタイム同期: Supabase Realtime (Broadcast + Presence)
- 認証: Better Auth (メール/パスワード, 管理者が新規登録を制御, `advanced.database.generateId: "uuid"`)
- バリデーション: Zod (packages/shared で共有)
- リンター/フォーマッター: Biome (ルートに biome.json、各パッケージから turbo 経由で実行)
- i18n: next-intl (Cookie ベース、URL 変更なし)
- テスト: Vitest, Playwright (E2E)
- Git フック: lefthook (pre-commit: check + check-i18n / commit-msg: Conventional Commits / pre-push: check-types + audit)
- Claude Code フック: post-edit (biome check + type check、non-code ファイルはスキップ), post-stop (変更パッケージのみのテスト)
- デプロイ: Vercel (main 直 push 禁止、Branch Protection で PR + CI green を強制)

## 主要パターン

- 全 API ルートで `requireAuth` ミドルウェアが必要 (ヘルスチェックと共有旅行ビューを除く)
- Zod スキーマは `packages/shared/src/schemas/` に配置し、API とフロントエンドの両方で使用
- API クライアント `apps/web/lib/api.ts` が認証 Cookie を自動処理 (`ApiError` クラスでステータスコード管理)
- API は同一オリジン (相対パス `/api/...`) でアクセス
- DB スキーマ `apps/api/src/db/schema.ts` に Better Auth テーブルを含む
- スポットは trip_days に、trip_days は trips に所属
- 旅行作成時に日付範囲から trip_days を自動生成し、作成者を trip_member として追加
- 旅行/スポットの権限は trip_members テーブルで検証 (checkTripAccess -> canEdit/isOwner)
- メンバーロール: owner (全権限), editor (スポット/旅行の CRUD), viewer (閲覧のみ)
- API のログは pino (`apps/api/src/lib/logger.ts`) を使う。`console.*` は禁止
  - `logger.error({ err, key: val }, "message")` — 第1引数に構造化データ、第2引数にメッセージ
  - エラーオブジェクトは `{ err }` キーで渡す (pino がスタックトレースをシリアライズする)
  - `requestLogger` middleware が requestId/method/path/status/duration を自動記録

## 開発環境

- 初回セットアップ: `bun install && supabase start && bun run db:migrate && bun run db:seed`
- ローカル Supabase 起動: `supabase start`
- Web + API: `bun run --filter @sugara/web dev` (localhost:3000)
- API エンドポイント: http://localhost:3000/api
- Supabase Studio: http://127.0.0.1:55323 (sugara 専用ポート。他プロジェクトの 54323 と衝突しない)
- ローカル Postgres: 127.0.0.1:55322 (sugara 専用)
- DB リセット: `supabase db reset && bun run db:migrate && bun run db:seed`
- 結合テスト: `bun run --filter @sugara/api test:integration` (PostgreSQL の `sugara_test` DB が必要)

## リリースフロー

詳細は [docs/development/release-flow.md](docs/development/release-flow.md) を参照。要点:

- `main` は Branch Protection で保護 → 直 push 不可、PR + CI green で squash merge
- feature branch: `<type>/<topic>` (例: `fix/cover-upload`, `feat/expense-category`)
- PR merge → Vercel が自動デプロイ（`turbo-ignore` で web 非依存の変更はスキップ）
- DB migration は独立した `.github/workflows/db-migrate.yml` で実行（`[skip deploy]` でも migration は走る）

コミットメッセージでのスキップ:

- `[skip ci]`: Vercel **と** GitHub Actions の両方をスキップ（ドキュメントのみの変更に使う）
- `[skip deploy]`: Vercel のみスキップ、GitHub Actions は動く（デスクトップリリース時に使う）
- 例: `docs: CLAUDE.mdを更新 [skip ci]`
- 例: `chore: デスクトップアプリ v0.2.0 にバージョンアップ [skip deploy]`

## デスクトップアプリのリリース

`apps/desktop/src-tauri/tauri.conf.json` の `version` を変更して PR merge するとリリースされる。

```
1. feature branch を切る (例: `chore/desktop-v0.2.0`)
2. apps/desktop/src-tauri/tauri.conf.json の version を更新 (例: "0.1.0" → "0.2.0")
3. コミット & push → PR 作成 → CI green → squash merge [skip deploy]
4. desktop-tag.yml が自動で desktop-v<version> タグを作成
5. desktop-build.yml がタグをトリガーにビルド・リリース
6. バイナリが u-stem/sugara-releases に公開される
```

- **version の単一ソースは `tauri.conf.json` の `version` の 1 箇所だけ**。Tauri はこれを優先してバイナリ/インストーラに焼き、`tauri-action` の `__VERSION__` も同じ値を使う
  - `Cargo.toml` / `Cargo.lock` の `sugara-desktop` version は `0.0.0` 固定（cargo build ログにしか出ず、アプリ版とは無関係）。リリース時に触らない
  - `userAgent` は version を含まない固定値 `sugara-desktop`（デスクトップ判定は接頭辞一致のみ。`apps/web/lib/hooks/use-desktop-download.ts`）。version 同期は不要
- バージョンが既にタグ済みの場合は何もしない（冪等）
- `apps/desktop/` のみの変更は Vercel の `turbo-ignore` がスキップするため Web ビルドは不要
- バージョン方針: patch（0.1.x）= バグ修正・軽微な改善、minor（0.x.0）= 新機能、major（x.0.0）= 破壊的変更
- 必要な GitHub Secrets:
  - `GH_RELEASES_TOKEN`: `u-stem/sugara-releases` repo への write 権限を持つ PAT (公開リポジトリへのリリース転送用)
  - `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: 自動更新用の署名鍵

## 規約

- Conventional Commits: `<type>: <日本語の説明>`
- TDD: Red -> Green -> Refactor
- コード内の言語: 英語 (コメントは What でなく Why を書く)
- デッドコード禁止、TODO は Issue 化する
- `biome-ignore` による lint 抑制禁止。根本的に修正する
- Git フック (lefthook): `bun install` で自動セットアップ。`--no-verify` でのスキップ禁止
- 依存バージョンは **exact pin**(`^` / `~` 禁止)。サプライチェーン対策で、lockfile 再生成・非 frozen install でも patch を勝手に引かないようにする。`bunfig.toml` の `[install] exact = true` で新規 `bun add` も自動 pin。`overrides` も直接依存と spec を一致させる(npm の EOVERRIDE 回避)

## Supabase Realtime

- チャンネルの一時利用（subscribe → send → removeChannel）では、`cleaned` フラグで `removeChannel` の二重呼び出しを防ぐ。SDK の `removeChannel` は `CLOSED` コールバックを再発火するため、ガードなしでは無限再帰になる
- Realtime チャンネルのテストモックでは `removeChannel` 呼び出し時に `_emitStatus("CLOSED")` を発火させ、SDK の実際の副作用を再現する（`use-trip-sync.test.ts`, `use-friends-sync.test.ts` 参照）

## FAQ メンテナンス

機能を追加・変更したときは、そのユーザーが持ちそうな疑問を考え、`apps/api/src/db/seed-faqs.ts` を同じコミットで更新する。
`JA_FAQS` と `EN_FAQS` の両方にエントリを追加し、適切な `sortOrder` を設定する（`resolveCategory` でカテゴリが自動付与される）。
更新後は `bun run --filter @sugara/api db:seed-faqs` を実行してローカル DB に反映する。

- 新機能の追加 → ja と en の両方に新しい FAQ エントリを追加
- 機能の仕様変更 → 既存エントリの answer を ja/en 両方で更新
- 機能の削除 → 該当エントリを ja/en 両方で削除
- カテゴリの追加 → `resolveCategory` の sortOrder マッピングと `messages/{ja,en}.json` の `faq.category` を更新

## お知らせ (News) メンテナンス

機能を追加・変更したときは `apps/web/content/news/ja/YYYY-MM-DD-<topic>.md` と `apps/web/content/news/en/YYYY-MM-DD-<topic>.md` にお知らせ記事を追加する。
既存の記事で記述が古くなったもの（機能の場所が変わった等）も同じコミットで ja/en 両方を修正する。

- 新機能の追加 → ja と en の両方に新しい記事を作成
- 既存機能の変更 → 影響する過去の記事を ja/en 両方で修正

## README バッジメンテナンス

README の静的バッジ (Next.js, Hono, Tauri 等) はメジャーバージョン更新時に手動で更新する。
動的バッジ (CI, Vercel, Commit Activity 等) は自動更新されるため対応不要。

- 依存パッケージのメジャーバージョンアップ → README のバッジのバージョン番号を更新

## DB スキーマ変更

スキーマ変更は必ず migration 経由で行う。`db:push` は削除済み (migration 追跡が壊れるため)。

```bash
# 1. schema.ts を変更する
# 2. migration ファイルを生成
bun run db:generate

# 3. ローカル DB に適用
bun run db:migrate
```

本番 DB への適用は Vercel `buildCommand` が `next build` の前に `bun run db:migrate` を実行する。drizzle の migration は `__drizzle_migrations` テーブルで追跡される冪等な DDL で、build 失敗時は migration も未適用のまま (= 次回 deploy で自然復旧)。`MIGRATION_URL` は Vercel env にのみ設定 (Supabase Session Pooler URL)。

## ドキュメント構成

```
docs/
  architecture/
    overview.md            全体像・インフラ構成図・技術スタック・デプロイ
    db-backup-recovery.md  DB バックアップ・リカバリ手順
  development/
    release-flow.md        ブランチ戦略・PR 運用・リリース手順・secret 管理
```

- 設計ドキュメントは「現在の状態」を反映する。古い計画書は git 履歴に残し、docs/ には置かない
- コード変更時にドキュメントが乖離したら同じコミットで更新する

## 計画ドキュメントの運用

大きな機能開発や設計変更を行う場合、計画ドキュメントを作成して実装する。

1. **計画を作成** → `docs/plans/<topic>.md` に保存
2. **計画に沿って実装** → タスクごとにチェックボックスを更新
3. **実装完了後に計画を削除** → 完了した計画は git 履歴に残る
4. **必要に応じて設計ドキュメントを更新** → `docs/architecture/` を最新に保つ

計画ファイルは一時的な作業用ドキュメントであり、リポジトリに残すべき永続的な資料ではない。
