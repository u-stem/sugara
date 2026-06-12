# リリースフロー / ブランチ戦略

sugara のコード変更から本番反映までのフローと、関連する運用ルールを記述する。

## 全体像

```
feature branch ── push ──▶ PR 作成
                             │
                             ├── CI 実行 (check / test / test-integration / test-e2e / CodeQL / cargo-audit)
                             │
                             └── CI green ─ 手動 squash merge ─▶ main
                                                                   │
                                                                   ├── Vercel 自動デプロイ (web)
                                                                   ├── db-migrate.yml (migration 変更時のみ)
                                                                   ├── desktop-tag.yml (tauri.conf.json 変更時)
                                                                   └── smoke-test.yml (deploy 成功後)
```

## ブランチ

- `main` — 本番。Branch Protection で保護。
- feature branch — `<type>/<topic>` 命名 (例: `fix/cover-upload`, `feat/expense-category`, `docs/release-flow`)。
- `type` は Conventional Commits のタイプと同じ: feat / fix / docs / refactor / test / chore / perf / style / ci / revert

## Branch Protection の内容

GitHub `Settings → Branches` で `main` に対して以下を設定:

| 項目 | 値 |
|------|-----|
| Require a pull request before merging | ON |
| Require approvals | OFF（ソロ運用のため 0） |
| Require status checks to pass before merging | ON (`check`, `test`, `test-integration`, `CodeQL`) |
| Require branches to be up to date before merging | ON |
| Require conversation resolution before merging | ON |
| Require linear history | ON (merge commit 不可、squash/rebase のみ) |
| Do not allow bypassing the above settings | ON (admin 含む) |
| Allow force pushes | OFF |
| Allow deletions | OFF |

## PR ワークフロー

### 1. 変更を feature branch で実装

```bash
git switch main
git pull
git switch -c <type>/<topic>
# 実装 / コミット
git push -u origin <type>/<topic>
```

### 2. PR 作成

```bash
gh pr create --title "<type>: <日本語タイトル>" --body "<本文>"
```

### 3. CI と preview 確認

- CI 全 green を待つ (check / test / test-integration / test-e2e / CodeQL / cargo-audit)
  - `test-e2e` は Playwright e2e をローカル同等の Supabase スタック + production build に対して実行する。required check には未登録（実行時間・flakiness の計測中。#149）
- Vercel が生成した preview URL で動作確認
- preview は Vercel Authentication で保護されているため、ログイン済みの team member のみアクセス可能

### 4. Squash merge

- GitHub UI で **Squash and merge** をクリック
- merge commit メッセージは Conventional Commits 形式で
- ブランチを削除

### 5. main への反映を確認

- Vercel の Production 環境に自動デプロイされる
- `smoke-test.yml` が `/api/health` に probe を投げて成功を確認
- 失敗した場合は GitHub Actions タブに検知ログが残る

## 自動化されている処理

### Vercel 自動デプロイ

- `main` への merge をトリガーに Vercel が web アプリをデプロイ
- Vercel native skipping (Settings → Build and Deployment → Skip deployment) で `@sugara/web` / `@sugara/api` / `@sugara/shared` に変更がない場合はスキップ (workspace 依存グラフを Vercel が解析)
- `apps/web/vercel.json` の `ignoreCommand` は `[skip ci]` / `[skip deploy]` コミットと `dependabot/*` ブランチのスキップを担う (native skipping では代替されない独自ガード)
- `[skip ci]` `[skip deploy]` コミットメッセージでスキップ可能 (本番 deploy を意図的に止めたい場合のみ)

### DB migration

Vercel `buildCommand` が `next build` の前に `bun run db:migrate` を実行する (Pattern A)。

- drizzle の migration は `__drizzle_migrations` テーブルで追跡される冪等な DDL
- build 失敗時は migration も未適用のままなので、自然に整合性が保たれる (build 成功 = migration + code 同期)
- `[skip deploy]` は desktop リリース専用で migration を含まない前提
- 将来的に staging → production の段階適用や複数人開発への拡張を要するようになった場合、GitHub Actions 側の専用ワークフローへの移行を検討する (Pattern B)
- `MIGRATION_URL` シークレットは **Vercel env にのみ** 設定 (Supabase Session Pooler URL、ポート 5432、`postgres.<project_ref>` ユーザ)

### デスクトップアプリのリリース

- `apps/desktop/src-tauri/tauri.conf.json` の `version` 変更を `desktop-tag.yml` が検知
- 自動で `desktop-v<version>` タグを作成
- タグ push を `desktop-build.yml` が検知してビルド → `sugara-releases` repo に公開
- **バージョンの単一ソースは `apps/desktop/src-tauri/tauri.conf.json` の `version` 1 箇所のみ** (Tauri がバイナリ/インストーラに焼き、`tauri-action` の `__VERSION__` も同じ値を使う)。`Cargo.toml` / `Cargo.lock` の version は `0.0.0` 固定でリリース時に触らない。`userAgent` は version を含まない固定値 `sugara-desktop` で同期不要 (詳細は CLAUDE.md「デスクトップアプリのリリース」)
- 必要な GitHub Secrets:
  - `GH_RELEASES_TOKEN` — `u-stem/sugara-releases` 公開 repo への write 権限を持つ PAT
  - `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — Tauri 自動更新の署名鍵

### Dependabot

- minor / patch の更新は `dependabot-auto-merge.yml` で auto-merge
- Branch Protection の required CI が green になった時点で自動的に squash merge される
- major は人手でレビューして merge

## Secret 管理

### Vercel (本番 env)

Vercel `Settings → Environment Variables` で設定、**全て "Sensitive" フラグ ON**:

| 変数 | 用途 |
|------|------|
| `DATABASE_URL` | Transaction Pooler (:6543) |
| `MIGRATION_URL` | Session Pooler (:5432) (advisory lock 必須) |
| `BETTER_AUTH_SECRET` | セッション署名鍵 |
| `SUPABASE_SERVICE_ROLE_KEY` | RLS バイパス (Storage Admin 用) |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase API URL (公開) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Publishable key (公開前提だが定期ローテ) |
| `GOOGLE_MAPS_API_KEY` | Routes API (サーバ側) |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | Maps JS API (クライアント、リファラ制限必須) |
| `GMAIL_USER` / `GMAIL_APP_PASSWORD` | メール送信 |
| `VAPID_PUBLIC_KEY` / `NEXT_PUBLIC_VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Web Push |
| `VAPID_SUBJECT` | Web Push mailto: URL |
| `GITHUB_TOKEN` | フィードバック / Sentry issue 作成 |
| `GITHUB_FEEDBACK_REPO` | 送信先 repo |
| `GITHUB_SENTRY_REPO` | Sentry issue の送信先 repo (未設定なら `GITHUB_FEEDBACK_REPO` を流用) |
| `SENTRY_WEBHOOK_SECRET` | Sentry Internal Integration の client secret (`/api/sentry-webhook` の署名検証用)。詳細は [sentry-github-issues.md](sentry-github-issues.md) |
| `VERCEL_API_TOKEN` | Edge Config 更新 (admin announcement 機能) |
| `EDGE_CONFIG_ID` / `EDGE_CONFIG` | 管理者告知用 Edge Config |
| `ADMIN_USER_ID` | 本番の管理者 user ID (ADMIN_USERNAME は非推奨) |
| `FRONTEND_URL` / `BETTER_AUTH_BASE_URL` | CORS / redirect 設定用 |
| `UPSTASH_REDIS_KV_REST_API_URL` / `UPSTASH_REDIS_KV_REST_API_TOKEN` | rate limit の共有ストア (Vercel Marketplace の Upstash integration が `UPSTASH_REDIS` prefix で自動 inject。READ_ONLY ではなく read-write token を使用)。未設定時は per-instance memory にフォールバック |
| `NEXT_PUBLIC_SENTRY_DSN` / `SENTRY_DSN` | Sentry エラー監視の DSN (Web/Server 共通。未設定なら init スキップ) |
| `SENTRY_ORG` / `SENTRY_PROJECT` / `SENTRY_AUTH_TOKEN` | Sentry source map アップロード用 (ビルド時のみ。`SENTRY_AUTH_TOKEN` 未設定時はアップロード no-op) |
| `SENTRY_ENVIRONMENT` / `NEXT_PUBLIC_SENTRY_ENVIRONMENT` | Sentry の環境名 (Server は `SENTRY_ENVIRONMENT`→`VERCEL_ENV`→`NODE_ENV`、Client は `NEXT_PUBLIC_SENTRY_ENVIRONMENT`→`NODE_ENV` をフォールバック) |
| `NODE_ENV` | production |

### GitHub Actions (production environment)

`Settings → Environments → production` で:

- `MIGRATION_URL` — db-migrate.yml が使用
- 本番環境の secret rotation は Vercel 側の env と同じタイミングで更新

### ローテーション方針

- 原則 90 日ごとにローテ
- 漏洩懸念があれば即座にローテ
- ローテ手順:
  1. 発行側サービス (Supabase / Google / Gmail) で新値を生成
  2. Vercel env を "Sensitive" フラグ保ったまま上書き
  3. Redeploy (Ignore Build Step チェック OFF で必ず build を走らせる)
  4. 新値で動作確認
  5. 旧値を revoke / disable

## トラブル時の対応

### 本番障害

1. Vercel `Deployments` で直近の production を確認
2. 怪しい commit があれば Vercel UI の `Instant Rollback` で前の deployment に即戻す
3. 原因調査は revert PR で行う (force push ではなく PR で)

### CI が通らない

- 個別ジョブの失敗ログを確認
- `check` 失敗: biome の lint / format エラー、ローカルで `bun run check` 実行
- `test` 失敗: vitest のエラー、ローカルで `bun run test` 実行
- `test-integration` 失敗: postgres service との接続か RLS 設定の問題
- `CodeQL` 失敗: 新規の SAST 警告、SECURITY.md のガイドに従い対応
- 通らない場合は PR 作成者が修正。ソロなのでセルフ対応
