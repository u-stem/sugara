# sugara MCP サーバ

sugara の外部 API v1 を MCP (Model Context Protocol) でラップする stdio サーバです。
Claude Desktop や Claude Code から自分の旅行データを読み取ることができます。

## ツール一覧

| ツール名 | 説明 |
|---|---|
| `list_trips` | 自分が参加している旅行の一覧を取得。`scope` (owned/shared)・limit・offset で絞り込み可 |
| `get_trip` | 旅行の詳細を UUID で取得。メンバー (memberNo 付き) と日程・スポット一覧を含む |
| `list_trip_expenses` | 旅行の費用一覧を取得。支払い者・分担は memberNo で参照 |
| `list_bookmark_lists` | ブックマークリストの一覧を取得 |
| `list_bookmarks` | 指定したブックマークリストの内容を取得 |
| `list_articles` | 自分の記事一覧を取得 (本文なし)。本文は `get_article` で取得 |
| `get_article` | 記事の全内容を UUID で取得 |

**memberNo について**: `get_trip` や `list_trip_expenses` に登場する `memberNo` は旅行内の連番です。データベースの内部 ID ではありません。

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
        "SUGARA_API_URL": "https://sugara.app"
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
        "SUGARA_API_URL": "https://sugara.app"
      }
    }
  }
}
```

### 環境変数

| 変数名 | 必須 | 説明 |
|---|---|---|
| `SUGARA_API_KEY` | ✓ | sugara の設定画面で発行した API キー (`sk_...`) |
| `SUGARA_API_URL` | ✓ | API の URL (例: `https://sugara.app`、ローカルは `http://localhost:3000`) |

## 注意事項

- 読み取り専用です。データの作成・更新・削除はできません
- 通信方式は stdio です。ネットワークで公開されることはありません
- 取得できるデータは API キーの所有者自身のデータのみです
