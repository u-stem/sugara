# sugara

旅行計画Webアプリケーション。Turborepo + bun workspaces によるモノレポ構成。

[![CI](https://img.shields.io/github/actions/workflow/status/u-stem/sugara/ci.yml?label=CI&logo=github)](https://github.com/u-stem/sugara/actions/workflows/ci.yml)
[![Vercel](https://img.shields.io/github/deployments/u-stem/sugara/Production?label=Vercel&logo=vercel&logoColor=white)](https://sugara.vercel.app)
[![Desktop Build](https://img.shields.io/github/actions/workflow/status/u-stem/sugara/desktop-build.yml?label=Desktop%20Build&logo=github)](https://github.com/u-stem/sugara/actions/workflows/desktop-build.yml)
[![Desktop Tag](https://img.shields.io/github/actions/workflow/status/u-stem/sugara/desktop-tag.yml?label=Desktop%20Tag&logo=github)](https://github.com/u-stem/sugara/actions/workflows/desktop-tag.yml)

[![Commit Activity](https://img.shields.io/github/commit-activity/m/u-stem/sugara)](https://github.com/u-stem/sugara/graphs/commit-activity)
[![Last Commit](https://img.shields.io/github/last-commit/u-stem/sugara)](https://github.com/u-stem/sugara/commits/main)

[![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org)
[![Hono](https://img.shields.io/badge/Hono-4-E36002?logo=hono&logoColor=white)](https://hono.dev)
[![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL-3FCF8E?logo=supabase&logoColor=white)](https://supabase.com)
[![Tauri](https://img.shields.io/badge/Tauri-2-24C8D8?logo=tauri&logoColor=white)](https://v2.tauri.app)
[![Turborepo](https://img.shields.io/badge/Turborepo-EF4444?logo=turborepo&logoColor=white)](https://turbo.build)
[![Bun](https://img.shields.io/badge/Bun-1.3-FBF0DF?logo=bun&logoColor=black)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Biome](https://img.shields.io/badge/Biome-60A5FA?logo=biome&logoColor=white)](https://biomejs.dev)

---

## 主な機能

| 機能 | 説明 |
|------|------|
| 旅行計画 | 日程・スケジュール管理、メンバー招待、ロールベースの権限制御 (owner / editor / viewer) |
| リアルタイム共同編集 | メンバー間でスケジュールの変更がリアルタイムに同期 |
| 費用管理 | 費用の記録・カテゴリ分類・割り勘計算・精算チェック |
| 投票 | 旅行内のスケジュール投票、独立したかんたん投票 (リンク共有対応) |
| ブックマーク | 行き先のブックマークリスト管理 |
| お土産管理 | 贈り先ごとの購入リスト・優先度設定 |
| ルーレット | 行き先をランダムに決定 |
| 通知 | アプリ内通知・Web Push 通知 |
| 共有 | トークンベースの旅行共有 (未登録ユーザーにも閲覧可) |
| デスクトップアプリ | Tauri 製ネイティブアプリ (macOS / Windows)、自動更新対応 |
| モバイル対応 | SP 専用レイアウトによるモバイルフレンドリーな UI |
| 外部 API (v1) | API キー (Bearer トークン) + スコープ認証の REST API。旅行・費用・候補・お土産・ブックマーク・記事の取得/作成/更新 |
| MCP サーバー | 外部 API v1 を stdio でラップする Model Context Protocol サーバー。Claude Desktop / Claude Code から旅行データを操作 |

## アーキテクチャ

```
sugara/
├── apps/
│   ├── web/          # Next.js フロントエンド + API Route Handler
│   ├── api/          # Hono API ルート・DB スキーマ・認証 (外部 API v1 を含む)
│   ├── desktop/      # Tauri デスクトップアプリ (macOS / Windows)
│   └── mcp/          # MCP (Model Context Protocol) サーバー (外部 API v1 を stdio でラップ)
├── packages/
│   └── shared/       # 共有 Zod スキーマ・型定義
├── supabase/         # Supabase CLI 設定・マイグレーション
├── biome.json        # Biome 設定 (lint / format)
├── lefthook.yml      # Git フック設定
└── turbo.json        # Turborepo 設定
```

## 技術スタック

| レイヤー | 技術 |
|----------|------|
| モノレポ | Turborepo + bun workspaces |
| フロントエンド | Next.js 16 (App Router) + Tailwind CSS v4 + shadcn/ui |
| API | Hono (Next.js Route Handler 統合) |
| データベース | Supabase PostgreSQL + Drizzle ORM |
| リアルタイム同期 | Supabase Realtime (Broadcast + Presence) |
| 認証 | Better Auth (メール/パスワード) |
| バリデーション | Zod (共有スキーマ) |
| デスクトップ | Tauri v2 (macOS / Windows、自動更新) |
| テスト | Vitest (ユニット / 統合) + Playwright (E2E) |
| リンター / フォーマッター | Biome |
| Git フック | lefthook (pre-commit / commit-msg / pre-push) |
| デプロイ | Vercel (Web) + GitHub Actions (Desktop) |

## セットアップ

### 前提条件

- [bun](https://bun.sh/) >= 1.3.2 (`packageManager` で固定)
- [Supabase CLI](https://supabase.com/docs/guides/cli)
- [Docker](https://www.docker.com/) (Supabase CLI が内部で使用)

### 初回セットアップ

```bash
bun install
supabase start
bun run db:migrate
bun run db:seed
```

1. `bun install` で依存関係をインストール (lefthook も自動セットアップ)
2. `supabase start` でローカル Supabase を起動 (PostgreSQL, Realtime など)
3. `bun run db:migrate` でマイグレーションを実行
4. `bun run db:seed` で開発用シードデータを投入

### 環境変数

`apps/web/.env.example` をコピーして `.env.local` を作成:

```bash
cp apps/web/.env.example apps/web/.env.local
```

`supabase status` で取得した値を設定する。

### 開発

```bash
supabase start                        # ローカル Supabase を起動
bun run --filter @sugara/web dev      # Next.js 開発サーバーを起動
```

- Web: http://localhost:3000
- API: http://localhost:3000/api
- Supabase Studio: http://127.0.0.1:55323 (sugara 専用。Postgres は 55322)

### データベースリセット

```bash
supabase db reset
bun run db:migrate
bun run db:seed
```

## スクリプト

プロジェクトルートから実行:

| コマンド | 説明 |
|----------|------|
| `bun run build` | 全パッケージビルド |
| `bun run test` | 全テスト実行 (Vitest) |
| `bun run lint` | 全パッケージ lint (Biome) |
| `bun run format` | 全パッケージ format (Biome) |
| `bun run check` | lint + format + import sort (Biome) |
| `bun run check-types` | TypeScript 型チェック |
| `bun run db:generate` | マイグレーション生成 (スキーマ変更後) |
| `bun run db:migrate` | マイグレーション実行 |
| `bun run db:studio` | Drizzle Studio 起動 |
| `bun run db:seed` | 開発用シードデータ投入 |
| `bun run db:seed-faqs` | FAQ データ投入 |
| `bun run test:coverage` | カバレッジ付きテスト実行 |
| `bun run test:e2e` | E2E テスト実行 (Playwright) |

パッケージ単位の実行:

```bash
bun run --filter @sugara/api test
bun run --filter @sugara/web lint
bun run --filter @sugara/shared check-types
```

## 開発ルール

### ブランチ戦略

`main` は Branch Protection で保護されており **直 push 不可**。変更は feature branch → PR → CI green → squash merge の流れ。

- `main` = Production (Vercel が自動デプロイ)
- feature branch: `<type>/<topic>` (例: `fix/trip-cover-upload`, `feat/expense-itemize`)
- PR merge は **squash** のみ (linear history を維持)
- Vercel が PR ごとに preview deploy を生成 (Vercel Authentication で team member 限定)

詳細: [docs/development/release-flow.md](docs/development/release-flow.md)

### Git フック (lefthook)

`bun install` で自動セットアップされる。CI で走るものはローカルで重複実行しない階層設計。

| フック | 内容 | 目的 |
|--------|------|------|
| pre-commit | `branch-guard` (main/master への直接コミット禁止) + `bun run check` (Biome) + `check-i18n` (messages 変更時のみ) | 1 秒以内に終わる軽いチェック |
| commit-msg | Conventional Commits 形式を強制 | 履歴の一貫性 |
| pre-push | `bun run check-types` + `bun audit` | push 前に型エラーを検出 |

テスト実行は **CI 側に集約** (ローカルの pre-push には含めない)。ローカルで走らせるなら `bun run test`。

### コミットメッセージ

```
<type>: <日本語の説明>
```

| type | 用途 |
|------|------|
| feat | 新機能 |
| fix | バグ修正 |
| docs | ドキュメント |
| refactor | リファクタリング |
| test | テスト |
| chore | ビルド、CI |
| perf | パフォーマンス改善 |

### CI / デプロイのスキップ

ドキュメント (Markdown) のみの変更では、CI の重いジョブ (`check` / `test` / `test-integration`) が path フィルタで自動スキップされる。スキップされた必須チェックは Branch Protection 上「成功」扱いになるため、PR はそのままマージできる。**タグを付ける必要はない**。

コミットメッセージのタグでスキップを制御することもできる。

| タグ | 効果 | 用途 |
|------|------|------|
| `[skip deploy]` | Vercel デプロイをスキップ (GitHub Actions は動く) | デスクトップのみのリリース時 |
| `[skip ci]` | Vercel + GitHub Actions を**両方**スキップ | PR では使わない (下記) |

- `[skip ci]` を PR コミットに付けると、必須チェック (`check` / `test`) のワークフロー自体が起動せず、チェックが永久に「待ち」のままマージ不能になる。`main` は Branch Protection で直 push 不可なので `[skip ci]` は実質使い道がない。ドキュメントのみの変更は上記の自動スキップに任せる。
- DB migration は Vercel の本番ビルド (`apps/web/vercel.json` の `buildCommand` が `next build` の前に `bun run db:migrate` を実行) の一部として走る。独立した migration 用 workflow はない。そのため `[skip deploy]` で Vercel をスキップすると migration も走らない (デスクトップのみのリリースは DB に影響しないため問題ない)。

## リンク

- デスクトップアプリ: [sugara-releases](https://github.com/u-stem/sugara-releases/releases/latest)
