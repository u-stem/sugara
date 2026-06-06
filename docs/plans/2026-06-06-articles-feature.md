# 記事(article)機能

ユーザーが Markdown で「記事」を書き、タグ付け・公開範囲設定・いいね・旅行への紐づけができる機能。ブックマークリストと**同格の独立エンティティ**として実装する。

> 用語: ユーザー向け表示は「記事」。コード上のエンティティ・テーブル・型・ルートは英語 `article`(`articles` / `article_trips` / `article_likes`)。「Tip / Tips」という語は使わない。

## 確定した要件

- **本文**: Markdown(ソース編集 + プレビュー、WYSIWYG ではない)
- **分類**: 自由入力タグ(複数)。固定カテゴリは持たない
- **操作**: 作成 / 編集 / 削除 / いいね
- **旅行との関係**: 多対多(1 記事を複数旅行に、1 旅行に複数記事)で紐づけて参照
- **公開範囲**: 3 段階(非公開 / フレンドのみ / 公開)+ コンテキスト共有(後述)
- **位置づけ**: 旅行に依存しない独立リソース。発見導線はプロフィール従属のみ(探索トップは作らない)

## 可視性モデル(確定)

記事が**閲覧可能**な条件(いずれか 1 つでも満たせば可視):

1. 閲覧者が作者本人
2. `visibility == public`
3. `visibility == friends_only` かつ 閲覧者が作者とフレンド(`areFriends()`)
4. 閲覧者が「記事に紐づくいずれかの旅行」のメンバー ← **コンテキスト共有(採用確定)**

→ 条項 4 により、**`private` でも紐づけた旅行のメンバーには見える**。
- 完全に自分だけのメモにしたい場合は「どの旅行にも紐づけず private」にする
- 旅行に紐づける = その旅行メンバーへの共有意思、と定義する
- UI で「この旅行のメンバーに共有されます」と明示し、意図しない共有を防ぐ

`visibility`(プロフィール等での一般露出)と「旅行紐づけ(その旅行内での共有)」は**直交する 2 軸**。

## データモデル(`apps/api/src/db/schema.ts`)

### enum
- 新規 `articleVisibilityEnum`(`private` / `friends_only` / `public`)。ブックマークと同値だが独立させる

### `articles` テーブル
| カラム | 型 | 備考 |
|---|---|---|
| id | uuid PK | |
| ownerId | uuid FK → user, cascade | 作者 |
| title | text | 上限 `MAX_ARTICLE_TITLE_LENGTH` |
| content | text | Markdown 本文。上限 `MAX_ARTICLE_CONTENT_LENGTH` |
| tags | text[] | 上限 `MAX_TAGS_PER_ARTICLE`、各タグ `MAX_TAG_LENGTH` |
| visibility | articleVisibilityEnum | default `private` |
| sortOrder | integer | 手動並べ替え用 |
| createdAt / updatedAt | timestamp | |

index: `(ownerId, sortOrder)`

### `article_trips` join テーブル(多対多)
`tripMembers` の複合主キー + cascade を踏襲。
- `articleId` uuid FK → articles, **ON DELETE CASCADE**
- `tripId` uuid FK → trips, **ON DELETE CASCADE**
- `createdAt` timestamp
- 複合主キー `(articleId, tripId)`

### `article_likes` テーブル(いいね)
- `articleId` uuid FK → articles, **ON DELETE CASCADE**
- `userId` uuid FK → user, **ON DELETE CASCADE**
- `createdAt` timestamp
- 複合主キー `(articleId, userId)`
- いいね数は count で算出(列を持たず、将来必要なら非正規化)

### タグの持ち方
MVP は `tags text[]`(ブックマークの `urls text[]` と同じ最小構成)。正規化テーブルは横断検索が本格化したら検討。

## 削除時の整合性(確定)

全ての参照は **FK ON DELETE CASCADE**:
- 記事削除 → `article_trips` / `article_likes` の該当行が自動削除
- 旅行詳細の「関連記事」は join 経由で取得するため、**削除済み記事は自動的にリストから消える**(dangling reference なし)
- 旅行削除 → その旅行の `article_trips` 行のみ消え、記事本体は残る(他の紐づけ・プロフィール公開は維持)

→ 旅行側では壊れたリンクや 404 カードを出さず、一覧から消えるだけ。本文中に記事 URL を手書きした場合のみ dangling になりうるが、正式な紐づけ(`article_trips`)は cascade で常に整合する。

## API(`apps/api/src/routes/articles.ts` 新規)

- `GET /articles` — 自分の記事一覧(requireAuth)
- `POST /articles` — 作成(requireAuth + requireNonGuest)。`MAX_ARTICLES_PER_USER` enforce
- `GET /articles/:id` — 詳細(optionalAuth、可視性モデルで制御)
- `PATCH /articles/:id` — 更新(作者のみ)
- `DELETE /articles/:id` — 削除(作者のみ)
- `PUT /articles/:id/trips` — 紐づけ旅行の一括設定(作者のみ、`MAX_TRIPS_PER_ARTICLE` enforce)
- `POST /articles/:id/like` / `DELETE /articles/:id/like` — いいね(requireAuth、可視記事のみ)
- `profile.ts` に `GET /:userId/articles` 追加(公開/フレンド可視のみ)
- `GET /trips/:id/articles` — その旅行に紐づく**閲覧可能な**記事一覧(可視性モデル + 旅行メンバー判定)

## Markdown レンダリング

依存追加(exact pin、サプライチェーン確認済み): `react-markdown@10.1.0`(既存) に加え `remark-gfm@4.0.1` / `rehype-sanitize@6.0.0` / `rehype-external-links@3.0.0` を追加。
- `@tailwindcss/typography` は**不採用**(安全性に寄与せず prose の広域スタイルが波及するため)。スタイルは既存 news と同様 Tailwind ユーティリティで対応
- `rehype-sanitize` の `defaultSchema` は `img` を許可するため、カスタムスキーマで `img`/`picture`/`source`/`input` を除外

`apps/web/lib/markdown.tsx`:
- `MarkdownRenderer`(Server Component 可)
- allowlist: 見出し / 太字 / リスト / リンク / コード / 引用 / hr / br。`img` は MVP 不許可
- `protocols.href = ["http","https","mailto"]`(`javascript:`/`data:` は列挙せず除去)
- `rehype-external-links` で `target=_blank` `rel=noopener noreferrer nofollow`
- `rehype-raw` を入れない(raw HTML 非解釈)= 二重防衛
- 入力 UI は `useState<"write"|"preview">` の Write/Preview タブ(ライブラリ不要)

## フロント構成

- `apps/web/app/(authenticated)/articles/` と `apps/web/app/(sp)/sp/articles/`(PC/SP 二系統)
  - 一覧 / 作成 / 編集 / 詳細
  - タグ入力 UI、いいねボタン + 件数、公開範囲セレクタ(`create-bookmark-list-dialog` の Select 流用)
  - 旅行紐づけ UI(自分の旅行を複数選択、「メンバーに共有されます」明示)
- プロフィール(`app/users/[userId]/page.tsx`)に公開記事セクション追加
- 旅行詳細に「関連記事」セクション追加

## 上限(`packages/shared/src/limits.ts`)

- `MAX_ARTICLES_PER_USER`: 20
- `MAX_TRIPS_PER_ARTICLE`: 10
- `MAX_ARTICLE_TITLE_LENGTH`: 100
- `MAX_ARTICLE_CONTENT_LENGTH`: 20000
- `MAX_TAGS_PER_ARTICLE`: 5
- `MAX_TAG_LENGTH`: 20

## 段階実装フェーズ(フェーズ分割 PR を推奨)

1. [x] スキーマ(articles / article_trips / article_likes / enum)+ migration + 型 + Zod(`schemas/article.ts`)+ 上限定数
2. [x] API(CRUD + タグ + いいね + 旅行紐づけ + プロフィール公開取得 + 旅行別取得)+ 可視性ロジック
3. [x] Markdown レンダラ + 依存追加(dependency-review)
4. フロント(一覧 / 作成 / 編集 / 詳細、PC/SP、タグ・いいね・紐づけ UI)
5. プロフィール公開表示 + 旅行詳細の関連記事
6. FAQ + お知らせ(ja/en)+ ドキュメント追従

## 対象外(MVP)

- 画像埋め込み(`img`)/ シンタックスハイライト / 目次自動生成
- 共有リンク(閲覧専用トークン)
- コメント機能(いいねのみ)
- タグ横断の探索トップ / 全文検索
- デスクトップ固有対応
