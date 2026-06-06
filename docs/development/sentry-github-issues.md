# Sentry エラーの GitHub Issue 化

本番で発生した Sentry のエラーを、webhook 経由で private repo (`GITHUB_SENTRY_REPO`、
未設定時は `GITHUB_FEEDBACK_REPO`) に自動で Issue 化する仕組み。

## 仕組み

```
Sentry (Internal Integration / Alert Rule action)
   │  POST  sentry-hook-signature: HMAC-SHA256(body, clientSecret)
   ▼
POST /api/sentry-webhook   (apps/api/src/routes/sentry-webhook.ts)
   │  1. raw body で署名検証 (verifySentrySignature)
   │  2. payload から issue 情報抽出 (parseSentryPayload)
   │  3. body の隠しマーカーで重複チェック (findGithubIssueByMarker)
   ▼
GitHub Issues API   labels: ["sentry"]
```

- エンドポイントは認証なし。Sentry の HMAC 署名 (`SENTRY_WEBHOOK_SECRET`) がゲート
- 同じ Sentry issue に対する再アラートは、body に埋めた `<!-- sentry-issue:{id} -->`
  マーカーを GitHub Search で照合して skip する (重複起票しない)

## Sentry 側のセットアップ (手作業)

1. Sentry: **Settings → Developer Settings → New Internal Integration** を作成
   - Webhook URL: `https://<本番ドメイン>/api/sentry-webhook`
   - **Alert Rule Action** を有効化 (alert の action として選べるようにする)
   - **Issue & Event** の webhook を有効化
2. 発行された **Client Secret** を Vercel env `SENTRY_WEBHOOK_SECRET` に設定
3. **Alerts → Create Alert → Issue Alert** で
   「新規 issue 発生時 → 当該 Internal Integration に通知」を作成
   (environment=production / 初回発生のみ等で絞ると良い)

## 必要な環境変数 (Vercel)

| 変数 | 用途 |
|------|------|
| `SENTRY_WEBHOOK_SECRET` | Internal Integration の client secret (署名検証) |
| `GITHUB_TOKEN` | Issue 作成用 (feedback 機能と共用。送信先 repo への issues:write 権限が必要) |
| `GITHUB_SENTRY_REPO` | 任意。未設定なら `GITHUB_FEEDBACK_REPO` に起票 |

## ローカル動作確認

```bash
# 正しい署名を付けてサンプル payload を送る
BODY='{"data":{"event":{"issue_id":1,"title":"Test","web_url":"https://sentry.io/x"}}}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SENTRY_WEBHOOK_SECRET" | awk '{print $2}')
curl -X POST http://localhost:3000/api/sentry-webhook \
  -H "Content-Type: application/json" \
  -H "sentry-hook-signature: $SIG" \
  -d "$BODY"
```

同じ payload を再送すると 2 通目は `{ "skipped": true }` になる (重複防止)。
