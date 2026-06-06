import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { faqs, seedState } from "./schema";

// Prefer MIGRATION_URL (direct connection) for DDL operations during build.
// Falls back to DATABASE_URL for local development.
const url =
  process.env.MIGRATION_URL ||
  process.env.DATABASE_URL ||
  "postgresql://postgres:postgres@127.0.0.1:55322/postgres";

const isLocalhost = url.includes("localhost") || url.includes("127.0.0.1");
const client = postgres(url, { ssl: isLocalhost ? false : "require", max: 1 });
const db = drizzle(client);

const JA_FAQS = [
  // ---- Overview ----
  {
    question: "sugaraで何ができますか？",
    answer:
      "旅行計画を作成し、メンバーと共同編集できるWebアプリです。日程・行き先の管理、日程調整の投票、費用管理、お土産リスト、ブックマークの保存、Excel/CSV出力、印刷に対応しています。スマートフォンからのアクセスにも対応しています。",
    sortOrder: 0,
  },
  // ---- Account ----
  {
    question: "アカウントを作成するにはどうすればよいですか？",
    answer:
      "ユーザー名・表示名・パスワードを入力して登録できます。メールアドレスは不要です。ただし、管理者の設定により新規登録を停止している場合があります。その場合はゲストとして引き続き利用できます。",
    sortOrder: 10,
  },
  {
    question: "ログインにはどの情報が必要ですか？",
    answer:
      "ユーザー名とパスワードでログインします。メールアドレスは使用しません。ユーザー名は3〜20文字の英数字とアンダースコアのみ使用できます。",
    sortOrder: 11,
  },
  {
    question: "ゲストとして試すことはできますか？",
    answer:
      "はい。ログイン画面から「ゲストとして試す」を選ぶと、アカウント登録なしでアプリを体験できます。ゲストアカウントは一時的なもので、一部機能（設定変更など）は利用できません。",
    sortOrder: 12,
  },
  {
    question: "ユーザー名を変更できますか？",
    answer:
      "はい。設定画面の「アカウント」タブからユーザー名を変更できます。3〜20文字の英数字とアンダースコアのみ使用できます。変更後はログイン時に新しいユーザー名を使用します。",
    sortOrder: 13,
  },
  {
    question: "パスワードを変更するにはどうすればよいですか？",
    answer:
      "設定画面の「アカウント」タブから変更できます。現在のパスワードと新しいパスワードを入力して保存します。パスワードを変更すると、他のデバイスのセッションは自動的にログアウトされます。",
    sortOrder: 14,
  },
  {
    question: "パスワードを忘れた場合はどうすればいいですか？",
    answer:
      "ログイン画面の「パスワードを忘れた方」リンクからパスワードリセットを申請できます。登録済みのメールアドレスを入力するとリセット用のリンクを送信します。メールアドレスを設定していない場合は、管理者に一時パスワードの発行を依頼してください。",
    sortOrder: 15,
  },
  {
    question: "メールアドレスを設定するにはどうすればよいですか？",
    answer:
      "設定画面の「アカウント」タブから登録できます。メールアドレスを入力して保存すると確認メールが届きます。メール内のリンクをクリックすると設定が完了します。メールアドレスを設定しておくと、パスワードを忘れた際に自分でリセットできます。",
    sortOrder: 16,
  },
  {
    question: "確認メールが届きません",
    answer:
      "迷惑メールフォルダを確認してください。それでも届かない場合は、設定画面から再送信できます。しばらく待っても届かない場合は管理者にお問い合わせください。",
    sortOrder: 17,
  },
  {
    question: "アカウントを削除するにはどうすればよいですか？",
    answer:
      "設定画面の「アカウント」タブの「アカウント削除」から削除できます。確認としてパスワードの入力が必要です。削除すると全ての旅行・メンバーシップ・フレンド情報が完全に消去され、元に戻せません。",
    sortOrder: 18,
  },
  // ---- Profile ----
  {
    question: "アバターや表示名を変更するにはどうすればよいですか？",
    answer:
      "設定画面の「プロフィール」タブから変更できます。アバターはDiceBearのイラストスタイルの中から選んで設定します。スタイル（Glass・Pixel Artなど12種類）を選びシャッフルで候補を切り替えながら好みのものを選択できます。表示名は自由に設定できます。",
    sortOrder: 19,
  },
  {
    question: "ユーザーIDとは何ですか？",
    answer:
      "他のユーザーがメンバー追加やフレンド申請に使う識別子（UUID形式）です。フレンドページの「あなたのユーザーID」セクションで確認・コピーできます。ユーザー名とは異なります。",
    sortOrder: 20,
  },
  // ---- Trips ----
  {
    question: "旅行のステータスが自動で変わるのはなぜですか？",
    answer:
      "旅行の開始日・終了日に基づいて、ステータスが自動的に「計画済み → 進行中 → 完了」と遷移します。手動で変更することもできます。",
    sortOrder: 21,
  },
  {
    question: "「パターン」とは何ですか？",
    answer:
      "1日の行程に対して最大3つの代替プランを作成できる機能です。「晴れの日プラン」「雨の日プラン」のように、状況に応じた候補を並行して管理できます。",
    sortOrder: 22,
  },
  {
    question: "「候補」と「予定」は何が違いますか？",
    answer:
      "「候補」はまだ日程に割り当てていない行き先のストックです。気になる場所をとりあえず追加しておき、後からドラッグ&ドロップで日程に配置すると「予定」になります。",
    sortOrder: 23,
  },
  {
    question: "旅行の計画を書き出せますか？",
    answer:
      "Excel (.xlsx)、CSV、または iCal (.ics) 形式でエクスポートできます。Excelではパターンごとにシートが分かれて出力されます。CSVは区切り文字や改行コードをカスタマイズ可能です。iCal は各日のメインプランの予定を Google カレンダーや Apple カレンダーに取り込める形式で書き出します。また、印刷用レイアウトでブラウザから印刷・PDF保存もできます。",
    sortOrder: 24,
  },
  {
    question: "スマホのブラウザからURLを旅行に追加できますか？",
    answer:
      "はい。sugaraをPWAとしてインストールした状態で、ブラウザの共有メニューからsugaraを選択すると、候補として追加できます。また、候補追加フォームでURLを入力すると、ページタイトルが自動で名前欄に入力されます。",
    sortOrder: 25,
  },
  {
    question: "オフラインでも旅行を確認できますか？",
    answer:
      "はい。一度表示した旅行データはブラウザに保存され、オフラインでも閲覧できます。PWAとしてインストールしている場合に最適です。データは最大7日間保持されます。",
    sortOrder: 26,
  },
  {
    question: "日をまたぐ予定（ホテルのチェックアウトなど）の前後に予定を入れるには？",
    answer:
      "チェックアウトのカード上半分にドロップすると予定を「チェックアウトの前」に、下半分にドロップすると「チェックアウトの後」に固定できます。一度配置した位置は、後から予定の時刻を変更しても保持されます。解除したい場合は「時刻順」ボタンで手動配置をまとめてクリアできます。",
    sortOrder: 27,
  },
  {
    question: "「時刻順」ボタンを押すと何が起きますか？",
    answer:
      "予定を開始時刻の昇順に並べ替えます。日をまたぐ予定（チェックアウトなど）の前後にドラッグで固定した予定があれば、その手動配置もまとめて解除されます。手動配置がある間は、時刻が既に昇順でも時刻順ボタンは有効のままなので、いつでもリセットできます。",
    sortOrder: 28,
  },
  {
    question: "移動の予定に交通費を記録できますか？",
    answer:
      "はい。カテゴリが「移動」の予定で、出発地・到着地・交通手段と一緒に交通費を入力できます。金額は旅行の通貨建ての整数で、タイムラインの移動カードに表示されます。これは計画用の軽量な項目で、費用タブの精算とは連携しません（精算に含めたい場合は費用タブで別途登録してください）。交通手段には電車・新幹線・バス・タクシー・徒歩・車・自転車・飛行機を選べます。",
    sortOrder: 29,
  },
  // ---- Scheduling ----
  {
    question: "「日程調整」とは何ですか？",
    answer:
      "旅行の日程をメンバーと投票で決められる機能です。複数の日程案を提示し、参加者が「OK / たぶん / NG」で回答します。結果を見てオーナーが日程を確定すると、旅行の日付が自動設定されます。",
    sortOrder: 30,
  },
  {
    question: "日程調整に参加者を招待するにはどうすればよいですか？",
    answer:
      "通常の旅行と同じように、メンバー管理からユーザーを追加します。旅行のメンバーは日程調整にアクセスすると自動的に回答できるようになります。共有リンクを発行すると回答状況を外部に公開できますが、リンク経由では投票できません（閲覧専用）。日程確定後、投票参加者は自動的に旅行のメンバー（編集者）に追加されます。",
    sortOrder: 31,
  },
  // ---- Members ----
  {
    question: "メンバーを追加するにはどうすればよいですか？",
    answer:
      "旅行の詳細画面からメンバー管理を開き、相手の「ユーザーID」を入力して追加します。ユーザーIDは相手のフレンドページで確認できます。フレンド登録済みの相手は、フレンドリストやグループからまとめて追加できます。",
    sortOrder: 40,
  },
  {
    question: "メンバーの「編集者」と「閲覧者」は何が違いますか？",
    answer:
      "「編集者」は予定の追加・編集・削除ができます。「閲覧者」は旅行の内容を見ることだけできます。メンバーの管理（追加・削除・ロール変更）はオーナーのみ行えます。",
    sortOrder: 41,
  },
  {
    question: "共有リンクとメンバー招待はどう使い分けますか？",
    answer:
      "共有リンクは、リンクを知っている人なら誰でも旅行の内容を閲覧できます（読み取り専用）。メンバー招待は、特定のユーザーに編集権限を含むロールを付与できます。一緒に計画を作るならメンバー招待、完成した計画を見せるだけなら共有リンクが便利です。",
    sortOrder: 42,
  },
  {
    question: "複数人で同時に編集できますか？",
    answer:
      "はい。メンバーが同時にアクセスしている場合、他のメンバーの変更がリアルタイムで反映されます。誰がどの日程を閲覧中かも表示されます。",
    sortOrder: 43,
  },
  // ---- Friends / Groups ----
  {
    question: "「フレンド」とは何ですか？",
    answer:
      "よく一緒に旅行する相手をフレンド登録しておける機能です。フレンドリストから旅行へ直接メンバーを追加できます。追加するには相手の「ユーザーID」を入力してリクエストを送り、承認されるとフレンドになります。ユーザーIDは相手のフレンドページで確認できます。申請・承認・拒否・取り消し・解除の操作は相手の画面にリアルタイムで反映されます。",
    sortOrder: 50,
  },
  {
    question: "送信済みのフレンド申請を取り消せますか？",
    answer:
      "はい。フレンドページの「送信済み申請」セクションから取り消しできます。取り消すと相手の受信リクエストからも即座に削除されます。",
    sortOrder: 52,
  },
  {
    question: "QRコードでフレンド申請するにはどうすればよいですか？",
    answer:
      "プロフィールページの「QRコード」ボタンをタップするとQRコードが表示されます。相手にスキャンしてもらうと、フレンド申請の確認ページが開き、申請を送ることができます。「読み取り」ボタンからは、カメラでのリアルタイムスキャンや、スクリーンショットなどの画像からQRコードを読み取ることもできます。",
    sortOrder: 51,
  },
  {
    question: "「グループ」は何に使いますか？",
    answer:
      "よく一緒に旅行するメンバーをグループにまとめておくと、旅行にメンバーを追加する際にグループから一括追加できます。",
    sortOrder: 51,
  },
  // ---- Bookmarks ----
  {
    question: "「ブックマーク」とは何ですか？",
    answer:
      "行き先をリストにまとめて保存・共有できる機能です。気になる場所をブックマークに保存しておき、旅行の候補として一括追加できます。リストの公開範囲は「非公開」「フレンドのみ」「公開」から選べます。",
    sortOrder: 60,
  },
  // ---- Articles ----
  {
    question: "「記事」とは何ですか？",
    answer:
      "旅行のメモやおすすめ情報を Markdown で書き残せる機能です。タグ付け・いいね・旅行への紐づけができます。公開範囲は「非公開」「フレンドのみ」「公開」から選べ、画像の挿入には対応していません。記事一覧はヘッダー（スマホはマイページ）からアクセスできます。",
    sortOrder: 62,
  },
  {
    question: "記事を旅行のメンバーに見せるには？",
    answer:
      "記事を旅行に紐づけると、その旅行のメンバーには「非公開」の記事でも表示されます。旅行に紐づけない「非公開」の記事は自分だけのメモになります。旅行詳細の「記事」（スマホは3点メニューの「関連記事」）から、紐づいた記事をその場で読めます。",
    sortOrder: 63,
  },
  // ---- Reactions ----
  {
    question: "旅行ページでリアクションを送るにはどうすればよいですか？",
    answer:
      "他のメンバーと同時に旅行ページを開いているとき、ヘッダーにリアクションボタン（スマイルアイコン）が表示されます。タップすると絵文字ピッカーが開き、選んだ絵文字が全メンバーの画面に浮かび上がります。連続送信は1秒間のクールダウンで制限されます。",
    sortOrder: 65,
  },
  // ---- Expenses ----
  {
    question: "「費用」タブとは何ですか？",
    answer:
      "旅行中の支出を記録し、メンバー間の精算を自動計算する機能です。誰がいくら支払ったかを入力すると、誰が誰にいくら返せばよいかが一覧で表示されます。費用は旅行のメンバー全員に共有されます。",
    sortOrder: 70,
  },
  {
    question: "居酒屋などで品目ごとに割り勘するにはどうすればいいですか？",
    answer:
      "費用追加時に分担方法で「アイテム別」を選択してください。品目ごとに金額と対象メンバーを設定できます。個別の飲み物だけ入力して「残りを均等割り」ボタンで共有料理分を自動配分することもできます。",
    sortOrder: 71,
  },
  {
    question: "費用にカテゴリを設定できますか？",
    answer:
      "はい。費用を追加・編集する際に、交通費・宿泊費・食費・通信費・消耗品費・交際費・会議費・その他のカテゴリを設定できます。カテゴリは任意で、設定しなくても費用を記録できます。カテゴリ別の集計は精算サマリーに表示され、エクスポートにも含まれます。",
    sortOrder: 72,
  },
  {
    question: "精算チェックとは何ですか？",
    answer:
      "費用タブの精算一覧にあるチェックボックスで、実際にお金のやり取りが完了したことを記録できる機能です。チェックを入れると取り消し線が表示され、進捗状況（例: 1/3 完了）が確認できます。チェックは送金者・受取人のみが操作できます。",
    sortOrder: 73,
  },
  {
    question: "費用を追加・変更すると精算チェックはどうなりますか？",
    answer:
      "費用の追加・更新・削除を行うと、精算金額が変わるため、すべての精算チェックが自動的にリセットされます。精算が完了している場合は、費用の変更前にご注意ください。",
    sortOrder: 74,
  },
  {
    question: "未精算の旅行はどこで確認できますか？",
    answer:
      "自分のプロフィールページに「未精算サマリー」が表示されます。支払い残・受取り残の合計と、旅行ごとの内訳が確認できます。また、ホーム画面の旅行カードに「未精算」バッジが表示されます。",
    sortOrder: 75,
  },
  {
    question: "異なる通貨を使うには？",
    answer:
      "旅行の作成時に基準通貨を選択し、費用の登録時に通貨を変更できます。為替レートは自動取得され、手動で修正することもできます。",
    sortOrder: 76,
  },
  {
    question: "為替レートはどう決まる？",
    answer:
      "費用の登録時にECB（欧州中央銀行）のデータを基にしたレートが自動入力されます。実際の両替レートに合わせて手動で変更できます。",
    sortOrder: 77,
  },
  {
    question: "精算の「立替ごと」と「最小送金」の違いは何ですか？",
    answer:
      "精算一覧は2つの表示方式を切り替えられます。「最小送金」は送金回数が最小になるよう計算した金額で、実際に振り込む手間が最も少なくなります。「立替ごと」は各支出を立て替えた人へ、その負担者が直接返す金額で、同じ相手との貸し借りは相殺されます。どちらの方式でも各メンバーの最終的な収支は同じです。精算チェック（完了記録）は「最小送金」でのみ行えます。",
    sortOrder: 78,
  },
  // ---- Souvenirs ----
  {
    question: "「お土産」リストとは何ですか？",
    answer:
      "旅行ごとに購入したいお土産を管理できる機能です。品名・対象・購入場所・URLなどを記録し、チェックボックスで購入済みにマークできます。アイテムごとに「メンバーに公開」をONにすると、同じ旅行のメンバーにも表示されます。公開しない限りは自分だけに表示されます。",
    sortOrder: 80,
  },
  {
    question: "お土産の共有スタイル「おすすめ」と「おつかい」の違いは何ですか？",
    answer:
      "共有をONにすると、デフォルトでは購入状態もメンバーに表示されます。「おすすめ」を選ぶと情報共有のみとなり、購入状態はメンバーに見えません。「おつかい」はデフォルトと同じく購入状態も表示されます。",
    sortOrder: 81,
  },
  // ---- Feedback ----
  {
    question: "ご意見やバグ報告はどこからできますか？",
    answer:
      "設定画面の下部にある「フィードバック」から送信できます。内容はGitHubのIssueとして登録されます。機能の要望や不具合の報告など、お気軽にお送りください。",
    sortOrder: 85,
  },
  // ---- UX ----
  {
    question: "スマートフォンでも使えますか？",
    answer:
      "はい。スマートフォンのブラウザからアクセスすると、タッチ操作に最適化された専用画面に自動で切り替わります。ボトムナビゲーションで主要ページにすばやくアクセスでき、旅行詳細ではスワイプでタブを切り替えられます。ヘッダーのメニューから「PC版で表示」を選ぶと、いつでもデスクトップ向け画面に切り替えられます。",
    sortOrder: 90,
  },
  {
    question: "キーボードショートカットはありますか？",
    answer:
      "はい。「?」キーでショートカット一覧を表示できます。日程の切り替え（数字キー・[ ]キー）、予定の追加（aキー）、候補の追加（cキー）などが使えます。",
    sortOrder: 91,
  },
  // ---- Language ----
  {
    question: "表示言語を変更するにはどうすればよいですか？",
    answer:
      "ヘッダーのメニューにある言語切り替えボタンをタップすると、日本語と英語を切り替えられます。選択した言語はブラウザに保存され、次回以降も同じ言語で表示されます。言語を設定していない場合は、ブラウザの言語設定に応じて自動で選択されます。",
    sortOrder: 92,
  },
  // ---- Maps ----
  {
    question: "地図タブが表示されません",
    answer:
      "地図タブは管理者が作成した旅行のみ利用できます。一般ユーザーが作成した旅行では表示されません。",
    sortOrder: 93,
  },
  {
    question: "地図にスポットが表示されません",
    answer:
      "スポット追加・編集ダイアログの住所フィールドで候補から場所を選択すると、座標情報が保存されて地図上にピンが表示されます。手入力した住所やフリーテキストの場合はピンが表示されません。",
    sortOrder: 94,
  },
  {
    question: "タイムラインにスポット間の移動時間が表示されません",
    answer:
      "移動時間は、連続する2つのスポットが両方とも地図座標を持ち、かつカテゴリが「移動」でない場合に表示されます。いずれかのスポットの住所を検索候補から選び直すと表示されるようになります。",
    sortOrder: 95,
  },
  {
    question: "地図タブはどう使いますか？",
    answer:
      "右パネルの「地図」タブ（またはキーボードショートカット g → m）で開きます。「当日」ボタンで当日のスポットのみ、「全期間」ボタンで旅行全体のスポットを表示します。ピンをタップするとスポット名が表示されます。",
    sortOrder: 96,
  },
  // ---- Quick Poll ----
  {
    question: "「かんたん投票」とは何ですか？",
    answer:
      "旅行に紐づかない独立した投票機能です。質問と選択肢を設定して共有リンクを発行すると、リンクを知っている人が誰でも投票できます。ログイン不要で、複数選択の許可や投票前の結果表示の設定も可能です。1ユーザーあたり20件まで作成できます。",
    sortOrder: 97,
  },
  {
    question: "かんたん投票のリンクを共有するにはどうすればよいですか？",
    answer:
      "投票作成後に表示されるリンクをコピーして共有します。投票一覧ページからもリンクのコピーが可能です。リンクを受け取った人はログインなしで投票できます。",
    sortOrder: 98,
  },
  // ---- Tools ----
  {
    question: "ルーレット機能とは？",
    answer:
      "旅行先やアクティビティをランダムに決めるツールです。プロフィールページの「ツール」セクションからアクセスできます。都道府県モード（地域フィルタ付き）、カスタムモード（自分で選択肢を入力）、ブックマークモード（ブックマークリストからランダム選択）の3つのモードがあります。",
    sortOrder: 99,
  },
  // ---- Limits ----
  {
    question: "旅行や予定に上限はありますか？",
    answer:
      "旅行は1ユーザーあたり10件（ご要望に応じて個別に引き上げ可能です）、予定は1旅行あたり300件、メンバーは1旅行あたり20人、パターンは1日あたり3つ、ブックマークリストは5件、フレンドは100人、グループは10件、お土産は1旅行あたり100件、かんたん投票は1ユーザーあたり20件までです。",
    sortOrder: 100,
  },
  // ---- Desktop App ----
  {
    question: "デスクトップアプリはありますか？",
    answer:
      "macOS と Windows 向けのデスクトップアプリを提供しています。設定画面の「その他」タブにある「デスクトップアプリをダウンロード」からインストーラーをダウンロードできます。インストール後は自動でアップデートされます。",
    sortOrder: 101,
  },
  {
    question: "デスクトップアプリのインストール時に警告が出ます",
    answer:
      "現在コード署名に対応していないため、macOS では「開発元を確認できません」、Windows では SmartScreen の警告が表示されることがあります。macOS の場合は右クリック（または Control キー+クリック）から「開く」を選択してください。Windows の場合は「詳細情報」→「実行」を選択してください。",
    sortOrder: 102,
  },
  // ---- Notifications ----
  {
    question: "旅行のイベントをDiscordに通知するには？",
    answer:
      "旅行のメニューから「Discord通知」を選び、DiscordのWebhook URLを設定してください。通知するイベントの種類も選択できます。",
    sortOrder: 105,
  },
  {
    question: "Discord通知が届かなくなった場合は？",
    answer:
      "Webhook URLが無効になると自動的に通知が停止します。旅行のメニューからDiscord通知の状態を確認し、必要に応じてURLを再設定してください。",
    sortOrder: 106,
  },
];

const EN_FAQS = [
  // ---- Overview ----
  {
    question: "What can I do with sugara?",
    answer:
      "sugara is a web app for creating travel plans and collaborating with members. It supports schedule and destination management, schedule voting, expense management, souvenir lists, bookmarks, Excel/CSV export, and printing. It also works on smartphones.",
    sortOrder: 0,
  },
  // ---- Account ----
  {
    question: "How do I create an account?",
    answer:
      "Register by entering a username, display name, and password. No email address is required. However, an administrator may have disabled new registrations. In that case, you can still use the app as a guest.",
    sortOrder: 10,
  },
  {
    question: "What information do I need to log in?",
    answer:
      "Log in with your username and password. Email addresses are not used for login. Usernames must be 3-20 characters using only alphanumeric characters and underscores.",
    sortOrder: 11,
  },
  {
    question: "Can I try the app as a guest?",
    answer:
      "Yes. Select 'Try as Guest' on the login screen to experience the app without creating an account. Guest accounts are temporary and some features (like settings) are not available.",
    sortOrder: 12,
  },
  {
    question: "Can I change my username?",
    answer:
      "Yes. You can change your username from the 'Account' tab in Settings. It must be 3-20 characters using only alphanumeric characters and underscores. After changing, use the new username to log in.",
    sortOrder: 13,
  },
  {
    question: "How do I change my password?",
    answer:
      "Go to the 'Account' tab in Settings. Enter your current password and new password, then save. Changing your password will automatically log out sessions on other devices.",
    sortOrder: 14,
  },
  {
    question: "What if I forget my password?",
    answer:
      "Use the 'Forgot Password' link on the login screen to request a reset. Enter your registered email address to receive a reset link. If you haven't set an email address, contact the administrator for a temporary password.",
    sortOrder: 15,
  },
  {
    question: "How do I set up my email address?",
    answer:
      "Register from the 'Account' tab in Settings. Enter your email address and save — a confirmation email will be sent. Click the link in the email to complete setup. Having an email address allows you to reset your password yourself.",
    sortOrder: 16,
  },
  {
    question: "I didn't receive the confirmation email",
    answer:
      "Check your spam folder. If it's not there, you can resend from the Settings page. If it still doesn't arrive after waiting, contact the administrator.",
    sortOrder: 17,
  },
  {
    question: "How do I delete my account?",
    answer:
      "Go to 'Delete Account' in the 'Account' tab in Settings. You'll need to enter your password for confirmation. Deletion permanently removes all trips, memberships, and friend data and cannot be undone.",
    sortOrder: 18,
  },
  // ---- Profile ----
  {
    question: "How do I change my avatar or display name?",
    answer:
      "Go to the 'Profile' tab in Settings. Choose an avatar from DiceBear illustration styles. Select a style (Glass, Pixel Art, etc. — 12 types) and shuffle through candidates to find your favorite. Display names can be set freely.",
    sortOrder: 19,
  },
  {
    question: "What is a User ID?",
    answer:
      "A UUID identifier used by other users to add you as a member or send friend requests. You can view and copy it from the 'Your User ID' section on the Friends page. It is different from your username.",
    sortOrder: 20,
  },
  // ---- Trips ----
  {
    question: "Why does my trip status change automatically?",
    answer:
      "Based on the trip's start and end dates, the status automatically transitions from 'Planned' to 'In Progress' to 'Completed.' You can also change it manually.",
    sortOrder: 21,
  },
  {
    question: "What are 'Patterns'?",
    answer:
      "A feature that lets you create up to 3 alternative plans for each day. For example, you can manage a 'Sunny day plan' and a 'Rainy day plan' side by side.",
    sortOrder: 22,
  },
  {
    question: "What's the difference between 'Candidates' and 'Schedules'?",
    answer:
      "'Candidates' are destinations you haven't assigned to a day yet — a holding area for places you're considering. Drag and drop a candidate onto a day to turn it into a 'Schedule.'",
    sortOrder: 23,
  },
  {
    question: "Can I export my travel plan?",
    answer:
      "Yes, export in Excel (.xlsx), CSV, or iCal (.ics) format. Excel exports create separate sheets per pattern. CSV supports customizable delimiters and line endings. iCal exports each day's main-plan schedules so you can import them into Google Calendar or Apple Calendar. You can also print or save as PDF using the print layout.",
    sortOrder: 24,
  },
  {
    question: "Can I add a URL to a trip from my phone's browser?",
    answer:
      "Yes. With sugara installed as a PWA, select sugara from your browser's share menu to add it as a candidate. You can also paste a URL in the candidate form, and the page title will be automatically filled in.",
    sortOrder: 25,
  },
  {
    question: "Can I view trips offline?",
    answer:
      "Yes. Trip data you've viewed is saved in the browser and can be accessed offline. It works best when sugara is installed as a PWA. Data is kept for up to 7 days.",
    sortOrder: 26,
  },
  {
    question:
      "How do I place a schedule before or after a multi-day entry, such as a hotel checkout?",
    answer:
      "Drop the schedule onto the upper half of the checkout card to pin it before the checkout, or onto the lower half to pin it after. The pinned position is kept even if you later change the schedule's start time. The 'Sort by time' button clears all manual pins at once.",
    sortOrder: 27,
  },
  {
    question: "What does the 'Sort by time' button do?",
    answer:
      "It reorders schedules by start time ascending. Any schedules you manually pinned around a multi-day entry (such as a checkout) are unpinned at the same time. The button stays active while any manual pin exists, so you can reset at any time.",
    sortOrder: 28,
  },
  {
    question: "Can I record the transit fare for a transport schedule?",
    answer:
      "Yes. On a schedule with the 'Transport' category, you can enter a transit fare alongside the departure, arrival, and transport method. The amount is an integer in the trip's currency and appears on the transport card in the timeline. It is a lightweight planning field and is not linked to the settlement on the Expenses tab (add it as an expense separately if you want it settled). Transport methods include train, shinkansen, bus, taxi, walk, car, bicycle, and airplane.",
    sortOrder: 29,
  },
  // ---- Scheduling ----
  {
    question: "What is 'Schedule Coordination'?",
    answer:
      "A feature for deciding trip dates through member voting. Propose multiple date options and members respond with 'OK / Maybe / NG.' When the owner finalizes a date, the trip dates are set automatically.",
    sortOrder: 30,
  },
  {
    question: "How do I invite participants to schedule coordination?",
    answer:
      "Add users through member management, just like a regular trip. Trip members can respond when they access the schedule coordination. You can share a link to show response status externally, but the link is view-only (no voting). After finalizing, voting participants are automatically added as trip members (editors).",
    sortOrder: 31,
  },
  // ---- Members ----
  {
    question: "How do I add members?",
    answer:
      "Open member management from the trip detail page and enter the other person's 'User ID.' User IDs can be found on their Friends page. Friends can be added in bulk from your friend list or groups.",
    sortOrder: 40,
  },
  {
    question: "What's the difference between 'Editor' and 'Viewer' roles?",
    answer:
      "'Editors' can add, edit, and delete schedules. 'Viewers' can only view trip content. Only the owner can manage members (add, remove, change roles).",
    sortOrder: 41,
  },
  {
    question: "When should I use a share link vs. member invitation?",
    answer:
      "Share links let anyone with the link view the trip (read-only). Member invitations assign roles including edit permissions to specific users. Use member invitations for collaborative planning, and share links for showing a finished plan.",
    sortOrder: 42,
  },
  {
    question: "Can multiple people edit at the same time?",
    answer:
      "Yes. When members access the trip simultaneously, changes from other members are reflected in real time. You can also see who is viewing which day.",
    sortOrder: 43,
  },
  // ---- Friends / Groups ----
  {
    question: "What are 'Friends'?",
    answer:
      "A feature for registering people you frequently travel with. You can add friends directly to trips from your friend list. Send a request using the other person's 'User ID' — once approved, you become friends. User IDs can be found on the Friends page. All friend actions (request, accept, decline, cancel, remove) are reflected in real time on the other person's screen.",
    sortOrder: 50,
  },
  {
    question: "Can I cancel a sent friend request?",
    answer:
      "Yes. Cancel from the 'Sent Requests' section on the Friends page. Canceling immediately removes the request from the recipient's list.",
    sortOrder: 52,
  },
  {
    question: "How do I send a friend request via QR code?",
    answer:
      "Tap the 'QR Code' button on the profile page to display your QR code. When someone scans it, a friend request confirmation page opens where they can send a request. You can also use the 'Scan' button to scan QR codes with the camera or read them from screenshots and images.",
    sortOrder: 51,
  },
  {
    question: "What are 'Groups' for?",
    answer:
      "Group your frequent travel companions so you can bulk-add them to trips when adding members.",
    sortOrder: 51,
  },
  // ---- Bookmarks ----
  {
    question: "What are 'Bookmarks'?",
    answer:
      "A feature for saving and sharing destinations in lists. Save places you're interested in and bulk-add them as trip candidates. List visibility can be set to 'Private,' 'Friends Only,' or 'Public.'",
    sortOrder: 60,
  },
  // ---- Articles ----
  {
    question: "What are 'Articles'?",
    answer:
      "A feature for writing travel notes and tips in Markdown. You can add tags, likes, and link articles to trips. Visibility can be set to 'Private,' 'Friends Only,' or 'Public.' Images aren't supported. Access your articles from the header (or My Page on mobile).",
    sortOrder: 62,
  },
  {
    question: "How do I share an article with trip members?",
    answer:
      "Link the article to a trip, and its members can see it even when it's set to 'Private.' A 'Private' article not linked to any trip stays a personal note. Members read linked articles in place from the trip's 'Articles' tab (or 'Related articles' in the three-dot menu on mobile).",
    sortOrder: 63,
  },
  // ---- Reactions ----
  {
    question: "How do I send reactions on a trip page?",
    answer:
      "When viewing a trip page at the same time as other members, a reaction button (smiley icon) appears in the header. Tap it to open the emoji picker — the selected emoji floats up on all members' screens. Consecutive sends are limited by a 1-second cooldown.",
    sortOrder: 65,
  },
  // ---- Expenses ----
  {
    question: "What is the 'Expenses' tab?",
    answer:
      "A feature for recording trip expenses and automatically calculating settlements between members. Enter who paid how much, and it shows who owes whom. Expenses are shared with all trip members.",
    sortOrder: 70,
  },
  {
    question: "How do I split a bill by item (e.g., at a restaurant)?",
    answer:
      "Select 'Per Item' as the split method when adding an expense. Set the amount and target members for each item. You can enter only individual items and use the 'Split remaining equally' button to distribute shared costs automatically.",
    sortOrder: 71,
  },
  {
    question: "Can I set categories on expenses?",
    answer:
      "Yes. When adding or editing expenses, you can set categories: Transportation, Accommodation, Food & Drink, Communication, Consumables, Entertainment, Meetings, or Other. Categories are optional. Category totals appear in the settlement summary and are included in exports.",
    sortOrder: 72,
  },
  {
    question: "What is the settlement check?",
    answer:
      "Checkboxes in the settlement list that let you record when a payment has been completed. Checking shows a strikethrough and progress (e.g., 1/3 completed). Only the payer and recipient can toggle checks.",
    sortOrder: 73,
  },
  {
    question: "What happens to settlement checks when expenses change?",
    answer:
      "When expenses are added, updated, or deleted, settlement amounts change, so all settlement checks are automatically reset. Please be aware of this before modifying expenses if settlements have been completed.",
    sortOrder: 74,
  },
  {
    question: "Where can I see unsettled trips?",
    answer:
      "An 'Unsettled Summary' is shown on your profile page with totals for amounts owed and receivable, broken down by trip. The home screen also shows an 'Unsettled' badge on trip cards.",
    sortOrder: 75,
  },
  {
    question: "How do I use different currencies?",
    answer:
      "Select a base currency when creating a trip, then choose a different currency when adding an expense. Exchange rates are auto-fetched and can be manually adjusted.",
    sortOrder: 76,
  },
  {
    question: "How are exchange rates determined?",
    answer:
      "Rates are auto-filled based on ECB (European Central Bank) data when adding an expense. You can manually adjust them to match your actual exchange rate.",
    sortOrder: 77,
  },
  {
    question: 'What is the difference between "By payer" and "Minimal" settlement?',
    answer:
      'The settlement list can be switched between two display modes. "Minimal" shows amounts calculated to minimize the number of transfers, so you make the fewest payments. "By payer" shows amounts repaid directly to whoever paid for each expense, with debts between the same pair offset against each other. Both modes produce the exact same net balance for every member. Settlement checks (completion records) can only be made in "Minimal" mode.',
    sortOrder: 78,
  },
  // ---- Souvenirs ----
  {
    question: "What is the 'Souvenirs' list?",
    answer:
      "A feature for managing souvenirs you want to buy for each trip. Record item name, recipient, shop location, URL, and more. Mark items as purchased with checkboxes. Turn on 'Share with members' per item to make it visible to trip members. Items remain private unless explicitly shared.",
    sortOrder: 80,
  },
  {
    question: "What's the difference between 'Recommendation' and 'Errand' sharing styles?",
    answer:
      "When sharing is on, purchase status is visible to members by default. Selecting 'Recommendation' shares information only — purchase status is hidden from members. 'Errand' shows purchase status to members (same as default).",
    sortOrder: 81,
  },
  // ---- Feedback ----
  {
    question: "Where can I send feedback or report bugs?",
    answer:
      "Use 'Feedback' at the bottom of the Settings page. Your feedback is submitted as a GitHub Issue. Feel free to send feature requests or bug reports.",
    sortOrder: 85,
  },
  // ---- UX ----
  {
    question: "Does it work on smartphones?",
    answer:
      "Yes. When accessed from a smartphone browser, the app automatically switches to a touch-optimized interface. Use the bottom navigation for quick access to main pages, and swipe to switch tabs on trip details. Select 'Desktop View' from the header menu to switch to the desktop interface at any time.",
    sortOrder: 90,
  },
  {
    question: "Are there keyboard shortcuts?",
    answer:
      "Yes. Press '?' to display the shortcut list. Available shortcuts include switching days (number keys, [ ] keys), adding a schedule (a key), adding a candidate (c key), and more.",
    sortOrder: 91,
  },
  // ---- Language ----
  {
    question: "How do I change the display language?",
    answer:
      "Tap the language toggle button in the header menu to switch between Japanese and English. Your choice is saved in the browser and used for future visits. If no preference is set, the language is automatically selected based on your browser settings.",
    sortOrder: 92,
  },
  // ---- Maps ----
  {
    question: "The map tab is not showing",
    answer:
      "The map tab is only available for trips created by administrators. It does not appear for trips created by regular users.",
    sortOrder: 93,
  },
  {
    question: "Spots are not showing on the map",
    answer:
      "Select a place from the suggestions in the address field when adding or editing a spot. This saves coordinates and displays a pin on the map. Manually entered addresses or free text will not show pins.",
    sortOrder: 94,
  },
  {
    question: "Travel time between spots is not showing on the timeline",
    answer:
      "Travel time is displayed when two consecutive spots both have map coordinates and neither has a 'Transit' category. Re-select the address from search suggestions for either spot to fix this.",
    sortOrder: 95,
  },
  {
    question: "How do I use the map tab?",
    answer:
      "Open it from the 'Map' tab in the right panel (or keyboard shortcut g then m). Use the 'Today' button to show only today's spots, or the 'All Days' button to show all trip spots. Tap a pin to see the spot name.",
    sortOrder: 96,
  },
  // ---- Quick Poll ----
  {
    question: "What is 'Quick Poll'?",
    answer:
      "A standalone voting feature not tied to any trip. Set a question and options, then share a link — anyone with the link can vote without logging in. You can allow multiple selections and control whether results are visible before voting. Each user can create up to 20 polls.",
    sortOrder: 97,
  },
  {
    question: "How do I share a Quick Poll link?",
    answer:
      "Copy the link shown after creating a poll. You can also copy the link from the poll list page. Anyone who receives the link can vote without logging in.",
    sortOrder: 98,
  },
  // ---- Tools ----
  {
    question: "What is the Roulette feature?",
    answer:
      "A tool for randomly selecting a destination or activity. Access it from the 'Tools' section on your profile page. Three modes are available: Prefecture (with region filter), Custom (enter your own options), and Bookmark (random selection from a bookmark list).",
    sortOrder: 99,
  },
  // ---- Limits ----
  {
    question: "Are there limits on trips and schedules?",
    answer:
      "Trips: 10 per user (can be raised individually on request), Schedules: 300 per trip, Members: 20 per trip, Patterns: 3 per day, Bookmark lists: 5, Friends: 100, Groups: 10, Souvenirs: 100 per trip, Quick Polls: 20 per user.",
    sortOrder: 100,
  },
  // ---- Desktop App ----
  {
    question: "Is there a desktop app?",
    answer:
      "Desktop apps for macOS and Windows are available. Download the installer from 'Download Desktop App' in the 'Other' tab of Settings. After installation, the app updates automatically.",
    sortOrder: 101,
  },
  {
    question: "I see a warning when installing the desktop app",
    answer:
      "The app is not currently code-signed, so macOS may show 'Cannot verify developer' and Windows may show a SmartScreen warning. On macOS, right-click (or Control+click) and select 'Open.' On Windows, click 'More info' then 'Run anyway.'",
    sortOrder: 102,
  },
  // ---- Notifications ----
  {
    question: "How do I send trip events to Discord?",
    answer:
      "Open the trip menu, select 'Discord Notifications', and configure a Discord Webhook URL. You can also select which event types to send.",
    sortOrder: 105,
  },
  {
    question: "What if Discord notifications stop working?",
    answer:
      "If the Webhook URL becomes invalid, notifications are automatically paused. Check the Discord notification settings from the trip menu and reconfigure the URL if needed.",
    sortOrder: 106,
  },
];

// Map sortOrder ranges to categories
function resolveCategory(sortOrder: number): string {
  if (sortOrder === 0) return "overview";
  if (sortOrder >= 10 && sortOrder <= 18) return "account";
  if (sortOrder >= 19 && sortOrder <= 20) return "profile";
  if (sortOrder >= 21 && sortOrder <= 29) return "trips";
  if (sortOrder >= 30 && sortOrder <= 31) return "scheduling";
  if (sortOrder >= 40 && sortOrder <= 43) return "members";
  if (sortOrder >= 50 && sortOrder <= 52) return "friends";
  if (sortOrder === 60) return "bookmarks";
  if (sortOrder >= 62 && sortOrder <= 63) return "articles";
  if (sortOrder === 65) return "reactions";
  if (sortOrder >= 70 && sortOrder <= 77) return "expenses";
  if (sortOrder >= 80 && sortOrder <= 81) return "souvenirs";
  if (sortOrder === 85) return "feedback";
  if (sortOrder >= 90 && sortOrder <= 92) return "ux";
  if (sortOrder >= 93 && sortOrder <= 96) return "maps";
  if (sortOrder >= 97 && sortOrder <= 98) return "quickpoll";
  if (sortOrder === 99) return "tools";
  if (sortOrder === 100) return "limits";
  if (sortOrder >= 101 && sortOrder <= 102) return "desktop";
  if (sortOrder >= 105 && sortOrder <= 106) return "notifications";
  return "other";
}

const FAQ_ITEMS = [
  ...JA_FAQS.map((item) => ({ ...item, locale: "ja", category: resolveCategory(item.sortOrder) })),
  ...EN_FAQS.map((item) => ({ ...item, locale: "en", category: resolveCategory(item.sortOrder) })),
];

const SEED_KEY = "faqs";
const contentHash = createHash("sha256").update(JSON.stringify(FAQ_ITEMS)).digest("hex");

async function main() {
  // `drizzle(client)` is created without a schema, so `db.query.*` isn't available here.
  // The plain `select().from().where()` builder works regardless.
  const existing = await db.select().from(seedState).where(eq(seedState.key, SEED_KEY)).limit(1);
  if (existing[0]?.hash === contentHash) {
    console.log(`FAQ content unchanged (hash=${contentHash.slice(0, 8)}…). Skipping seed.`);
    await client.end();
    process.exit(0);
  }

  console.log("Seeding FAQs...");

  // Wrap delete+insert+hash update in a transaction so readers never see an empty FAQ table
  // and so the hash only lands if the rewrite succeeds.
  await db.transaction(async (tx) => {
    await tx.delete(faqs);
    await tx.insert(faqs).values(FAQ_ITEMS);
    await tx
      .insert(seedState)
      .values({ key: SEED_KEY, hash: contentHash })
      .onConflictDoUpdate({
        target: seedState.key,
        set: { hash: contentHash, appliedAt: new Date() },
      });
  });

  console.log(`Inserted ${FAQ_ITEMS.length} FAQ items (hash=${contentHash.slice(0, 8)}…).`);
  await client.end();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
