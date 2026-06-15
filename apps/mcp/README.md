# sugara MCP サーバ

sugara の外部 API v1 を MCP (Model Context Protocol) でラップする stdio サーバです。
Claude Desktop や Claude Code から自分の旅行データの読み取りと、作成・更新ができます。

## ツール一覧

### 読み取り

| ツール名 | 説明 |
|---|---|
| `list_trips` | 自分が参加している旅行の一覧を取得。`scope` (owned/shared)・limit・offset で絞り込み可 |
| `get_trip` | 旅行の詳細を UUID で取得。メンバー (memberNo 付き) と日程・スポット一覧を含む |
| `list_trip_expenses` | 旅行の費用一覧を取得。支払い者・分担は memberNo で参照 |
| `list_bookmark_lists` | ブックマークリストの一覧を取得 |
| `list_bookmarks` | 指定したブックマークリストの内容を取得 |
| `list_articles` | 自分の記事一覧を取得 (本文なし)。本文は `get_article` で取得 |
| `get_article` | 記事の全内容を UUID で取得 |
| `list_candidates` | 旅行の候補 (未割り当てのスポット) 一覧を取得 |
| `list_souvenirs` | 旅行のお土産一覧を取得 (自分のもの + 他メンバーの共有アイテム)。所有者は memberNo で参照 |

`list_articles` / `list_bookmarks` / `list_candidates` / `list_souvenirs` は `q` で名前の部分一致検索ができます (大文字小文字を区別しません)。

### 作成・更新・削除

対応する write スコープを持つ API キーが必要です。

| ツール名 | 説明 |
|---|---|
| `create_trip` | 旅行を作成 (作成者が owner になる) |
| `update_trip` | 旅行を部分更新 (editor 以上のロールが必要) |
| `create_schedule` | 指定した日 (dayNumber、1 始まり) に予定を追加 |
| `update_schedule` | 予定を更新 |
| `create_expense` | 費用を登録。支払い者・分担は memberNo で指定 |
| `update_expense` | 費用を更新 |
| `create_bookmark_list` | ブックマークリストを作成 |
| `update_bookmark_list` | ブックマークリストを更新 |
| `create_bookmark` | リストにブックマークを追加 |
| `update_bookmark` | ブックマークを更新 |
| `create_article` | 記事を作成 |
| `update_article` | 記事を更新 (自分の記事のみ) |
| `create_candidate` | 候補 (未割り当てのスポット) を追加 (`trips:write` が必要) |
| `update_candidate` | 候補を更新 (割り当て済みのスポットは 404) |
| `create_souvenir` | お土産を追加 (`souvenirs:write` が必要。viewer を含む任意のメンバーが自分のお土産を作成可) |
| `update_souvenir` | お土産を更新 (自分のお土産のみ) |
| `batch_create_candidates` | 候補を一括追加 (`trips:write` が必要。重複名は `onConflict: "skip"` でスキップ可) |
| `batch_create_souvenirs` | お土産を一括追加 (`souvenirs:write` が必要。重複名は `onConflict: "skip"` でスキップ可) |
| `delete_candidate` | 候補を削除 (`trips:write` が必要。割り当て済みのスポットは対象外。冪等) |
| `delete_souvenir` | お土産を削除 (`souvenirs:write` が必要。自分のお土産のみ。冪等) |

**memberNo について**: `get_trip` や `list_trip_expenses` に登場する `memberNo` は旅行内の連番です。データベースの内部 ID ではありません。メンバーの増減で振り直されるため、`create_expense` 等で指定する前に `get_trip` で最新の対応を確認してください。

## セットアップ

### 1. API キーの発行

sugara の設定画面からAPIキーを発行してください。

### 2. Claude Desktop への登録

`~/Library/Application Support/Claude/claude_desktop_config.json` に以下を追加します:

```json
{
  "mcpServers": {
    "sugara": {
      "command": "bun",
      "args": ["run", "/絶対パス/sugara/apps/mcp/src/index.ts"],
      "env": {
        "SUGARA_API_KEY": "sk_...",
        "SUGARA_API_URL": "https://sugara.vercel.app"
      }
    }
  }
}
```

### 3. Claude Code への登録

```json
{
  "mcpServers": {
    "sugara": {
      "command": "bun",
      "args": ["run", "/絶対パス/sugara/apps/mcp/src/index.ts"],
      "env": {
        "SUGARA_API_KEY": "sk_...",
        "SUGARA_API_URL": "https://sugara.vercel.app"
      }
    }
  }
}
```

### 環境変数

| 変数名 | 必須 | 説明 |
|---|---|---|
| `SUGARA_API_KEY` | ✓ | sugara の設定画面で発行した API キー (`sk_...`) |
| `SUGARA_API_URL` | ✓ | API の URL。`https://` 推奨。`http://` は `localhost` / `127.0.0.1` のみ許可 (例: `https://sugara.vercel.app`、ローカルは `http://localhost:3000`) |

## 注意事項

- 削除は候補・お土産のみ対応しています (`delete_candidate` / `delete_souvenir`)。それ以外のデータの削除は Web UI から行ってください
- 削除ツールは冪等です。すでに削除済み・存在しない ID を指定してもエラーにならず、`deleted: false` を返します
- 作成・更新・削除には write スコープ (`trips:write` 等) を持つ API キーが必要です。読み取り専用で使う場合は read スコープのみのキーを発行してください
- 共有されている旅行への書き込みには、その旅行での editor 以上のロールが必要です
- 通信方式は stdio です。ネットワークで公開されることはありません
- 操作できるデータは API キーの所有者自身がアクセスできるデータのみです
