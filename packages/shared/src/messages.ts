import {
  MAX_BOOKMARK_LISTS_PER_USER,
  MAX_BOOKMARKS_PER_LIST,
  MAX_FRIENDS_PER_USER,
  MAX_GROUPS_PER_USER,
  MAX_MEMBERS_PER_GROUP,
  MAX_MEMBERS_PER_TRIP,
  MAX_OPTIONS_PER_POLL,
  MAX_PARTICIPANTS_PER_POLL,
  MAX_PATTERNS_PER_DAY,
  MAX_QUICK_POLLS_PER_USER,
  MAX_SCHEDULES_PER_TRIP,
  MAX_TRIPS_PER_USER,
} from "./limits";
import type { ExpenseCategory, ExpenseSplitType } from "./schemas/expense";
import type { MemberRole } from "./schemas/member";
import type { ScheduleCategory, ScheduleColor, TransportMethod } from "./schemas/schedule";
import type { TripStatus } from "./schemas/trip";

// ─── API error messages (English, used in HTTP responses) ─────────────────────

export const ERROR_MSG = {
  TRIP_NOT_FOUND: "Trip not found",
  SCHEDULE_NOT_FOUND: "Schedule not found",
  PATTERN_NOT_FOUND: "Pattern not found",
  CANNOT_DELETE_DEFAULT: "Cannot delete default pattern",
  INVALID_JSON: "Invalid JSON",
  INTERNAL_ERROR: "Internal server error",
  INVALID_ID_FORMAT: "Invalid ID format",
  DATE_ORDER: "End date must be on or after start date",
  SHARED_NOT_FOUND: "Shared trip not found",
  CANDIDATE_NOT_FOUND: "Candidate not found",
  CONFLICT: "Resource was modified by another user",
  USER_NOT_FOUND: "User not found",
  ALREADY_MEMBER: "Already a member",
  CANNOT_CHANGE_OWN_ROLE: "Cannot change own role",
  MEMBER_NOT_FOUND: "Member not found",
  CANNOT_REMOVE_SELF: "Cannot remove yourself",
  INVALID_REORDER: "Some schedules do not belong to this pattern",
  INVALID_CANDIDATE_REORDER: "Some schedules are not candidates of this trip",
  DAY_NOT_FOUND: "Day not found",
  GITHUB_API_FAILED: "Failed to create feedback issue",
  GITHUB_NOT_CONFIGURED: "Feedback is not configured",
  LIMIT_TRIPS: "Trip limit reached",
  LIMIT_SCHEDULES: "Schedule limit reached",
  LIMIT_PATTERNS: "Pattern limit reached",
  LIMIT_MEMBERS: "Member limit reached",
  CANNOT_FRIEND_SELF: "Cannot send friend request to yourself",
  ALREADY_FRIENDS: "Already friends or request pending",
  FRIEND_REQUEST_NOT_FOUND: "Friend request not found",
  FRIEND_NOT_FOUND: "Friend not found",
  LIMIT_FRIENDS: "Friend limit reached",
  INVALID_PASSWORD: "Invalid password",
  ACCOUNT_NOT_FOUND: "Account not found",
  UNAUTHORIZED: "Unauthorized",
  TOO_MANY_REQUESTS: "Too many requests",
  BOOKMARK_LIST_NOT_FOUND: "Bookmark list not found",
  BOOKMARK_NOT_FOUND: "Bookmark not found",
  LIMIT_BOOKMARK_LISTS: "Bookmark list limit reached",
  LIMIT_BOOKMARKS: "Bookmark limit reached",
  BOOKMARK_OWNER_MISMATCH: "Some bookmarks do not belong to user",
  SCHEDULE_TRIP_MISMATCH: "Some schedules do not belong to trip",
  GROUP_NOT_FOUND: "Group not found",
  LIMIT_GROUPS: "Group limit reached",
  LIMIT_GROUP_MEMBERS: "Group member limit reached",
  ALREADY_GROUP_MEMBER: "Already a group member",
  GROUP_MEMBER_NOT_FOUND: "Group member not found",
  POLL_NOT_FOUND: "Poll not found",
  POLL_NOT_OPEN: "Poll is not open",
  POLL_OPTION_NOT_FOUND: "Poll option not found",
  POLL_PARTICIPANT_NOT_FOUND: "Participant not found",
  POLL_ALREADY_PARTICIPANT: "Already a participant",
  POLL_DEADLINE_PASSED: "Poll deadline has passed",
  POLL_SHARED_NOT_FOUND: "Shared poll not found",
  LIMIT_POLL_OPTIONS: "Poll option limit reached",
  LIMIT_POLL_PARTICIPANTS: "Poll participant limit reached",
  POLL_CANNOT_REMOVE_OWNER: "Cannot remove poll owner from participants",
  POLL_INVALID_OPTION: "Some responses reference options not in this poll",
  POLL_OPTION_DUPLICATE: "Duplicate poll option",
  TRIP_DAYS_REDUCED: "Cannot reduce the number of trip days",
  TRIP_HAS_EXPENSES: "Cannot change currency when trip has expenses",
  EXPENSE_NOT_FOUND: "Expense not found",
  LIMIT_EXPENSES: "Expense limit reached",
  EXPENSE_SPLIT_MISMATCH: "Split amounts must equal total amount",
  EXPENSE_SPLIT_AMOUNT_MISMATCH: "Split amounts do not match the new total",
  EXPENSE_PAYER_NOT_MEMBER: "Payer must be a trip member",
  EXPENSE_SPLIT_USER_NOT_MEMBER: "Split users must be trip members",
  NOTIFICATION_NOT_FOUND: "Notification not found",
  SOUVENIR_NOT_FOUND: "Souvenir not found",
  LIMIT_SOUVENIRS: "Souvenir limit reached",
  MEMBER_HAS_EXPENSES: "Cannot remove member who has expenses",
  FILE_REQUIRED: "File is required",
  FILE_TYPE_NOT_ALLOWED: "JPEG, PNG, WebP only",
  FILE_TOO_LARGE: "File size must be 3MB or less",
  GUEST_NOT_ALLOWED: "This feature is not available for guest accounts",
  GUEST_TRIP_LIMIT: "Guest accounts can only create 1 trip",
  GUEST_EXPIRED: "Guest account has expired",
  QUICK_POLL_NOT_FOUND: "Quick poll not found",
  QUICK_POLL_NOT_OPEN: "Quick poll is not open",
  QUICK_POLL_ALREADY_VOTED: "Already voted",
  QUICK_POLL_SINGLE_VOTE_ONLY: "Only one option allowed",
  QUICK_POLL_INVALID_OPTION: "Some options do not belong to this poll",
  LIMIT_QUICK_POLLS: "Quick poll limit reached",
  FORBIDDEN: "Forbidden",
  NOT_FOUND: "Not found",
  SIGNUP_DISABLED: "新規利用の受付を停止しています",
  INVALID_INPUT: "Invalid input",
  VOTER_ID_REQUIRED: "userId or anonymousId required",
  SETTLEMENT_PAYMENT_NOT_FOUND: "Settlement payment not found",
  SETTLEMENT_ALREADY_CHECKED: "Settlement already checked",
  SETTLEMENT_TRANSFER_NOT_FOUND: "Transfer not found in current settlement",
  WEBHOOK_ALREADY_EXISTS: "Webhook already exists for this trip",
  WEBHOOK_NOT_FOUND: "Webhook not found",
  WEBHOOK_UNREACHABLE: "Webhook URL is unreachable",
  WEBHOOK_TEST_FAILED: "Failed to send test notification",
} as const;

// ─── UI messages (Japanese, used in toasts and UI feedback) ───────────────────

export const MSG = {
  // Schedule
  SCHEDULE_ADDED: "予定を追加しました",
  SCHEDULE_ADD_FAILED: "予定の追加に失敗しました",
  SCHEDULE_UPDATED: "予定を更新しました",
  SCHEDULE_UPDATE_FAILED: "予定の更新に失敗しました",
  SCHEDULE_DELETED: "予定を削除しました",
  SCHEDULE_DELETE_FAILED: "予定の削除に失敗しました",
  SCHEDULE_MOVED_TO_CANDIDATE: "候補に戻しました",
  SCHEDULE_MOVE_FAILED: "候補への移動に失敗しました",
  SCHEDULE_REORDER_FAILED: "並び替えに失敗しました",

  // Candidate
  CANDIDATE_ASSIGNED: "予定に追加しました",
  CANDIDATE_ASSIGN_FAILED: "予定への追加に失敗しました",
  CANDIDATE_ADDED: "候補を追加しました",
  CANDIDATE_ADD_FAILED: "候補の追加に失敗しました",
  CANDIDATE_DELETED: "候補を削除しました",
  CANDIDATE_DELETE_FAILED: "候補の削除に失敗しました",
  CANDIDATE_UPDATED: "候補を更新しました",
  CANDIDATE_UPDATE_FAILED: "候補の更新に失敗しました",

  // Trip
  TRIP_UPDATED: "旅行を更新しました",
  TRIP_UPDATE_FAILED: "旅行の更新に失敗しました",
  TRIP_DELETED: "旅行を削除しました",
  TRIP_DELETE_FAILED: "旅行の削除に失敗しました",
  TRIP_STATUS_CHANGED: "ステータスを変更しました",
  TRIP_STATUS_CHANGE_FAILED: "ステータスの変更に失敗しました",
  TRIP_CREATED: "旅行を作成しました",
  TRIP_CREATE_FAILED: "旅行の作成に失敗しました",
  TRIP_FETCH_FAILED: "旅行の取得に失敗しました",
  TRIP_NOT_FOUND: "旅行が見つかりません",
  TRIP_DATE_REQUIRED: "日付を選択してください",
  TRIP_BULK_DELETED: (n: number) => `${n}件の旅行を削除しました`,
  TRIP_BULK_DELETE_FAILED: (n: number) => `${n}件の削除に失敗しました`,
  TRIP_DAYS_REDUCED: "日数を減らすことはできません",
  TRIP_BULK_DUPLICATED: (n: number) => `${n}件の旅行を複製しました`,
  TRIP_BULK_DUPLICATE_FAILED: (n: number) => `${n}件の複製に失敗しました`,

  // Share
  SHARE_LINK_COPIED: "共有リンクをコピーしました",
  SHARE_LINK_CREATED: "共有リンクを生成しました（手動でコピーしてください）",
  SHARE_LINK_FAILED: "共有リンクの生成に失敗しました",
  SHARE_LINK_REGENERATED: "共有リンクを再生成してコピーしました",
  SHARE_LINK_REGENERATED_NO_COPY: "共有リンクを再生成しました（手動でコピーしてください）",
  SHARE_LINK_REGENERATE_FAILED: "共有リンクの再生成に失敗しました",
  COPY_FAILED: "コピーに失敗しました",

  // Member
  MEMBER_ADDED: "メンバーを追加しました",
  MEMBER_ADD_FAILED: "メンバーの追加に失敗しました",
  MEMBER_ALREADY: "すでに旅行のメンバーです",
  MEMBER_LIST_FAILED: "メンバー一覧の取得に失敗しました",
  MEMBER_ROLE_CHANGED: "ロールを変更しました",
  MEMBER_ROLE_CHANGE_FAILED: "ロールの変更に失敗しました",
  MEMBER_REMOVED: "メンバーを削除しました",
  MEMBER_REMOVE_FAILED: "メンバーの削除に失敗しました",

  // Pattern
  PATTERN_ADDED: "パターンを追加しました",
  PATTERN_ADD_FAILED: "パターンの追加に失敗しました",
  PATTERN_DUPLICATED: "パターンを複製しました",
  PATTERN_DUPLICATE_FAILED: "パターンの複製に失敗しました",
  PATTERN_DELETED: "パターンを削除しました",
  PATTERN_DELETE_FAILED: "パターンの削除に失敗しました",
  PATTERN_RENAMED: "名前を変更しました",
  PATTERN_RENAME_FAILED: "名前の変更に失敗しました",
  PATTERN_OVERWRITTEN: "パターンを上書きしました",
  PATTERN_OVERWRITE_FAILED: "パターンの上書きに失敗しました",

  // Settings
  SETTINGS_PROFILE_UPDATED: "プロフィールを更新しました",
  SETTINGS_PROFILE_UPDATE_FAILED: "プロフィールの更新に失敗しました",
  SETTINGS_USERNAME_UPDATED: "ユーザー名を更新しました",
  SETTINGS_USERNAME_UPDATE_FAILED: "ユーザー名の更新に失敗しました",
  SETTINGS_PASSWORD_CHANGED: "パスワードを変更しました",
  SETTINGS_PASSWORD_CHANGE_FAILED: "パスワードの変更に失敗しました",
  SETTINGS_USER_ID_COPIED: "ユーザーIDをコピーしました",
  SETTINGS_AVATAR_UPDATED: "アバターを設定しました",
  SETTINGS_AVATAR_UPDATE_FAILED: "アバターの設定に失敗しました",
  SETTINGS_AVATAR_RESET: "アバターをリセットしました",

  // Auth
  AUTH_SIGNUP_DISABLED: "現在、新規利用の受付を停止しています",
  AUTH_SIGNUP_DISABLED_DETAIL:
    "現在、新規アカウントの作成を受け付けていません。ゲストとして引き続きご利用いただけます。",
  AUTH_LOGIN_FAILED: "ログインに失敗しました",
  AUTH_LOGIN_SUCCESS: "ログインしました",
  AUTH_LOGOUT_FAILED: "ログアウトに失敗しました",
  AUTH_SIGNUP_SUCCESS: "アカウントを作成しました",
  AUTH_SIGNUP_FAILED: "アカウントの作成に失敗しました",
  AUTH_SIGNUP_PASSWORD_MISMATCH: "パスワードが一致しません",
  AUTH_SIGNUP_TERMS_REQUIRED: "利用規約とプライバシーポリシーへの同意が必要です",
  AUTH_PASSWORD_TOO_WEAK: "パスワードの要件を満たしていません",
  AUTH_GUEST_STARTED: "ゲストモードで開始しました",
  AUTH_GUEST_FAILED: "ゲストアカウントの作成に失敗しました",
  AUTH_GUEST_UPGRADE_SUCCESS: "アカウント登録が完了しました",
  AUTH_GUEST_UPGRADE_FAILED: "アカウント登録に失敗しました",
  AUTH_GUEST_FEATURE_UNAVAILABLE: "この機能を使うにはアカウント登録が必要です",
  AUTH_PASSWORD_MISMATCH: "新しいパスワードが一致しません",
  AUTH_GUEST_TRIP_LIMIT: "ゲストモードでは旅行を1件まで作成できます",

  // Friend
  FRIEND_REQUEST_SENT: "フレンド申請を送信しました",
  FRIEND_REQUEST_SEND_FAILED: "フレンド申請の送信に失敗しました",
  FRIEND_REQUEST_ACCEPTED: "フレンド申請を承認しました",
  FRIEND_REQUEST_ACCEPT_FAILED: "フレンド申請の承認に失敗しました",
  FRIEND_REQUEST_REJECTED: "フレンド申請を拒否しました",
  FRIEND_REQUEST_REJECT_FAILED: "フレンド申請の拒否に失敗しました",
  FRIEND_REQUEST_CANCELLED: "フレンド申請を取り消しました",
  FRIEND_REQUEST_CANCEL_FAILED: "フレンド申請の取り消しに失敗しました",
  FRIEND_REMOVED: "フレンドを解除しました",
  FRIEND_REMOVE_FAILED: "フレンドの解除に失敗しました",
  FRIEND_LIST_FAILED: "フレンド一覧の取得に失敗しました",
  FRIEND_REQUESTS_FAILED: "フレンド申請一覧の取得に失敗しました",

  // Group
  GROUP_CREATED: "グループを作成しました",
  GROUP_CREATE_FAILED: "グループの作成に失敗しました",
  GROUP_UPDATED: "グループ名を変更しました",
  GROUP_UPDATE_FAILED: "グループ名の変更に失敗しました",
  GROUP_DELETED: "グループを削除しました",
  GROUP_DELETE_FAILED: "グループの削除に失敗しました",
  GROUP_MEMBER_ADDED: "メンバーを追加しました",
  GROUP_MEMBER_ADD_FAILED: "メンバーの追加に失敗しました",
  GROUP_MEMBER_ALREADY: "すでにグループのメンバーです",
  GROUP_MEMBER_REMOVED: "メンバーを削除しました",
  GROUP_MEMBER_REMOVE_FAILED: "メンバーの削除に失敗しました",
  GROUP_BULK_ADDED: (n: number) => `${n}人をメンバーに追加しました`,
  GROUP_BULK_ADD_PARTIAL: (added: number, failed: number) =>
    `${added}人を追加しました（${failed}人は失敗）`,

  // Reaction
  REACTION_FAILED: "リアクションに失敗しました",
  REACTION_REMOVE_FAILED: "リアクションの取り消しに失敗しました",

  // Batch operations
  BATCH_ASSIGNED: (n: number) => `${n}件を予定に追加しました`,
  BATCH_ASSIGN_FAILED: "予定への追加に失敗しました",
  BATCH_UNASSIGNED: (n: number) => `${n}件を候補に戻しました`,
  BATCH_UNASSIGN_FAILED: "候補への移動に失敗しました",
  BATCH_DELETED: (n: number) => `${n}件を削除しました`,
  BATCH_DELETE_FAILED: "削除に失敗しました",
  BATCH_DUPLICATED: (n: number) => `${n}件を複製しました`,
  BATCH_DUPLICATE_FAILED: "複製に失敗しました",
  BATCH_SHIFT_SUCCESS: (n: number) => `${n}件の予定の時間を更新しました`,
  BATCH_SHIFT_PARTIAL: (updated: number, skipped: number) =>
    `${updated}件の時間を更新しました（${skipped}件はスキップ）`,
  BATCH_SHIFT_FAILED: "時間の一括更新に失敗しました",

  // Day memo
  DAY_MEMO_UPDATED: "メモを更新しました",
  DAY_MEMO_UPDATE_FAILED: "メモの更新に失敗しました",

  // Day weather
  DAY_WEATHER_UPDATED: "天気を更新しました",
  DAY_WEATHER_UPDATE_FAILED: "天気の更新に失敗しました",

  // Poll note
  POLL_NOTE_UPDATED: "メモを更新しました",
  POLL_NOTE_UPDATE_FAILED: "メモの更新に失敗しました",

  // Expense
  EXPENSE_SAVE_FAILED: "費用の保存に失敗しました",
  EXPENSE_DELETE_FAILED: "費用の削除に失敗しました",
  SETTLEMENT_CHECK_FAILED: "精算チェックに失敗しました",
  SETTLEMENT_UNCHECK_FAILED: "精算チェックの解除に失敗しました",
  SETTLEMENT_ALREADY_CHECKED: "この精算は既にチェック済みです",

  // Notification
  NOTIFICATION_MARK_READ_FAILED: "既読の更新に失敗しました",
  NOTIFICATION_MARK_ALL_READ_FAILED: "全て既読の更新に失敗しました",
  NOTIFICATION_PREF_UPDATE_FAILED: "通知設定の更新に失敗しました",

  // Account
  ACCOUNT_DELETED: "アカウントを削除しました",
  ACCOUNT_DELETE_FAILED: "アカウントの削除に失敗しました",

  // Feedback
  FEEDBACK_SENT: "フィードバックを送信しました",
  FEEDBACK_SEND_FAILED: "フィードバックの送信に失敗しました",

  // Activity log
  ACTIVITY_LOG_FETCH_FAILED: "履歴の取得に失敗しました",
  ACTIVITY_LOG_EMPTY: "まだ履歴がありません",

  // Conflict
  CONFLICT: "他のユーザーが先に更新しました。画面を更新してください。",
  CONFLICT_STALE: "他のユーザーが変更を行いました。最新のデータを読み込みます。",
  CONFLICT_DELETED: "対象が他のユーザーにより削除されました。",

  // Time validation
  TIME_START_REQUIRED: "開始時間を入力してください",
  TIME_END_BEFORE_START: "終了時間は開始時間より後にしてください",
  TIME_HOTEL_CHECKIN_REQUIRED: "チェックイン時間を入力してください",
  TIME_HOTEL_CHECKOUT_AFTER: "チェックアウト時間はチェックイン時間より後にしてください",
  TIME_TRANSPORT_DEPARTURE_REQUIRED: "出発時間を入力してください",
  TIME_TRANSPORT_ARRIVAL_AFTER: "到着時間は出発時間より後にしてください",

  // Bookmark
  BOOKMARK_LIST_FETCH_FAILED: "ブックマークリストの取得に失敗しました",
  BOOKMARK_LIST_CREATED: "リストを作成しました",
  BOOKMARK_LIST_CREATE_FAILED: "リストの作成に失敗しました",
  BOOKMARK_LIST_UPDATED: "リストを更新しました",
  BOOKMARK_LIST_UPDATE_FAILED: "リストの更新に失敗しました",
  BOOKMARK_LIST_DELETED: "リストを削除しました",
  BOOKMARK_LIST_DELETE_FAILED: "リストの削除に失敗しました",
  BOOKMARK_LIST_BULK_DELETED: (n: number) => `${n}件のリストを削除しました`,
  BOOKMARK_LIST_BULK_DELETE_FAILED: (n: number) => `${n}件の削除に失敗しました`,
  BOOKMARK_LIST_BULK_DUPLICATED: (n: number) => `${n}件のリストを複製しました`,
  BOOKMARK_LIST_BULK_DUPLICATE_FAILED: (n: number) => `${n}件の複製に失敗しました`,
  BOOKMARK_ADDED: "ブックマークを追加しました",
  BOOKMARK_ADD_FAILED: "ブックマークの追加に失敗しました",
  BOOKMARK_UPDATED: "ブックマークを更新しました",
  BOOKMARK_UPDATE_FAILED: "ブックマークの更新に失敗しました",
  BOOKMARK_DELETED: "ブックマークを削除しました",
  BOOKMARK_DELETE_FAILED: "ブックマークの削除に失敗しました",
  BOOKMARK_REORDER_FAILED: "並び替えに失敗しました",
  PROFILE_FETCH_FAILED: "プロフィールの取得に失敗しました",
  BOOKMARK_SAVED_TO_CANDIDATES: (n: number) => `${n}件を候補に追加しました`,
  BOOKMARK_SAVE_TO_CANDIDATES_FAILED: "候補への追加に失敗しました",
  SCHEDULE_SAVED_TO_BOOKMARKS: (n: number) => `${n}件をブックマークに保存しました`,
  SCHEDULE_SAVE_TO_BOOKMARKS_FAILED: "ブックマークへの保存に失敗しました",

  // Poll
  POLL_CONFIRMED: "日程を確定しました",
  POLL_CONFIRM_FAILED: "日程の確定に失敗しました",
  POLL_OPTION_ADDED: "日程案を追加しました",
  POLL_OPTION_ADD_FAILED: "日程案の追加に失敗しました",
  POLL_OPTION_DUPLICATE: "同じ日程の案がすでに存在します",
  POLL_OPTION_DELETED: "日程案を削除しました",
  POLL_OPTION_DELETE_FAILED: "日程案の削除に失敗しました",
  POLL_PARTICIPANT_ADDED: "参加者を追加しました",
  POLL_PARTICIPANT_ADD_FAILED: "参加者の追加に失敗しました",
  POLL_PARTICIPANT_REMOVED: "参加者を削除しました",
  POLL_PARTICIPANT_REMOVE_FAILED: "参加者の削除に失敗しました",
  POLL_RESPONSE_SUBMIT_FAILED: "回答の送信に失敗しました",
  POLL_SHARE_LINK_COPIED: "共有リンクをコピーしました",
  POLL_SHARE_LINK_FAILED: "共有リンクの生成に失敗しました",
  POLL_CANDIDATE_REQUIRED: "日程案を1つ以上選択してください",
  POLL_SHARED_NOT_FOUND: "この共有リンクは無効か、有効期限が切れています",

  // Scheduling status
  SCHEDULING_STATUS_TITLE: "日程調整中",
  SCHEDULING_STATUS_DESCRIPTION: "日程が確定するとスケジュールを作成できます",

  // Limits
  LIMIT_BOOKMARK_LISTS: `リストは最大${MAX_BOOKMARK_LISTS_PER_USER}件まで作成できます`,
  LIMIT_BOOKMARKS: `ブックマークは1リストあたり最大${MAX_BOOKMARKS_PER_LIST}件まで追加できます`,
  LIMIT_TRIPS: `旅行は最大${MAX_TRIPS_PER_USER}件まで作成できます`,
  LIMIT_SCHEDULES: `予定と候補は1旅行あたり合計${MAX_SCHEDULES_PER_TRIP}件まで追加できます`,
  LIMIT_PATTERNS: `パターンは各日程に最大${MAX_PATTERNS_PER_DAY}件まで追加できます`,
  LIMIT_MEMBERS: `メンバーは1旅行あたり最大${MAX_MEMBERS_PER_TRIP}名まで招待できます`,
  LIMIT_FRIENDS: `フレンドは最大${MAX_FRIENDS_PER_USER}人まで登録できます`,
  LIMIT_GROUPS: `グループは最大${MAX_GROUPS_PER_USER}件まで作成できます`,
  LIMIT_GROUP_MEMBERS: `グループメンバーは最大${MAX_MEMBERS_PER_GROUP}人まで追加できます`,
  LIMIT_POLL_OPTIONS: `日程案は最大${MAX_OPTIONS_PER_POLL}件まで追加できます`,
  LIMIT_POLL_PARTICIPANTS: `参加者は最大${MAX_PARTICIPANTS_PER_POLL}人まで追加できます`,

  // Export
  EXPORT_SUCCESS: "エクスポートしました",
  EXPORT_FAILED: "エクスポートに失敗しました",

  // Shared view
  SHARED_LINK_INVALID: "このリンクは無効か、有効期限が切れています",
  SHARED_TRIP_FETCH_FAILED: "旅行の取得に失敗しました",
  SHARED_TRIP_NOT_FOUND: "旅行が見つかりません",

  // Quick Poll
  QUICK_POLL_CREATED: "投票を作成しました",
  QUICK_POLL_CREATE_FAILED: "投票の作成に失敗しました",
  QUICK_POLL_CLOSED: "投票を終了しました",
  QUICK_POLL_CLOSE_FAILED: "投票の終了に失敗しました",
  QUICK_POLL_DELETED: "投票を削除しました",
  QUICK_POLL_DELETE_FAILED: "投票の削除に失敗しました",
  QUICK_POLL_VOTED: "投票しました",
  QUICK_POLL_VOTE_FAILED: "投票に失敗しました",
  QUICK_POLL_VOTE_CANCELLED: "投票を取り消しました",
  QUICK_POLL_VOTE_CANCEL_FAILED: "投票の取り消しに失敗しました",
  QUICK_POLL_LINK_COPIED: "投票リンクをコピーしました",
  QUICK_POLL_NOT_FOUND: "この投票は存在しないか、有効期限が切れています",
  QUICK_POLL_FETCH_FAILED: "投票の取得に失敗しました",
  EMPTY_QUICK_POLL: "投票がありません",
  LIMIT_QUICK_POLLS: `投票は最大${MAX_QUICK_POLLS_PER_USER}件まで作成できます`,

  // Empty states
  EMPTY_TRIP: "まだ旅行がありません",
  EMPTY_TRIP_SHARED: "共有された旅行はありません",
  EMPTY_TRIP_FILTER: "条件に一致する旅行がありません",
  EMPTY_SCHEDULE: "まだ予定がありません",
  EMPTY_CANDIDATE: "候補がありません",
  EMPTY_BOOKMARK_LIST: "リストがありません",
  EMPTY_BOOKMARK_LIST_FILTER: "条件に一致するリストがありません",
  EMPTY_BOOKMARK: "ブックマークがありません",
  EMPTY_FRIEND: "フレンドがいません",
  EMPTY_MEMBER: "まだメンバーがいません",
  EMPTY_GROUP: "グループがありません",
  EMPTY_NOTIFICATION: "通知はありません",
  EMPTY_EXPENSE: "費用はまだ記録されていません",
  SOUVENIR_SAVE_FAILED: "お土産の保存に失敗しました",
  SOUVENIR_DELETE_FAILED: "お土産の削除に失敗しました",
  EMPTY_SOUVENIR: "お土産リストはまだありません",
  EMPTY_NEWS: "お知らせはまだありません",
  EMPTY_EXPORT_SHEET: "このシートにデータがありません",

  // UI status
  MEMBER_ALL_ADDED: "全員追加済みです",
  NO_CHANGES: "変更がありません",
  VALIDATION_ERROR: "入力内容を確認してください",

  // Common errors
  USER_NOT_FOUND: "ユーザーが見つかりません",
  INVALID_USER_ID: "正しいユーザーIDを入力してください",
} as const;

// ─── Auth error translations (Better Auth code → Japanese) ───────────────────

const AUTH_ERROR_MAP: Record<string, string> = {
  // Login
  INVALID_USERNAME_OR_PASSWORD: "ユーザー名またはパスワードが正しくありません",
  INVALID_EMAIL_OR_PASSWORD: "ユーザー名またはパスワードが正しくありません",
  CREDENTIAL_ACCOUNT_NOT_FOUND: "アカウントが見つかりません",
  USER_NOT_FOUND: "ユーザーが見つかりません",

  // Signup
  USER_ALREADY_EXISTS: "このユーザーは既に登録されています",
  USERNAME_IS_ALREADY_TAKEN: "このユーザー名は既に使用されています",
  USERNAME_TOO_SHORT: "ユーザー名が短すぎます",
  USERNAME_TOO_LONG: "ユーザー名が長すぎます",
  INVALID_USERNAME: "ユーザー名が無効です",
  INVALID_DISPLAY_USERNAME: "表示用ユーザー名が無効です",
  PASSWORD_TOO_SHORT: "パスワードが短すぎます",
  PASSWORD_TOO_LONG: "パスワードが長すぎます",

  // Password change
  INVALID_PASSWORD: "現在のパスワードが正しくありません",
  SESSION_EXPIRED: "セッションが期限切れです。再度ログインしてください",

  // Profile update
  FAILED_TO_UPDATE_USER: "ユーザー情報の更新に失敗しました",
  FAILED_TO_CREATE_USER: "ユーザーの作成に失敗しました",
};

export function translateAuthError(
  error: { code?: string; message?: string } | undefined,
  fallback: string,
): string {
  if (!error) return fallback;
  if (error.code && error.code in AUTH_ERROR_MAP) {
    return AUTH_ERROR_MAP[error.code];
  }
  return fallback;
}

// ─── Push notification body text (Japanese) ──────────────────────────────────
// Used by buildPushMessage() in apps/api/src/lib/notifications.ts.
// Title is always the trip name; only the body text is parameterized here.

export const PUSH_MSG: Record<string, (payload: Record<string, string | undefined>) => string> = {
  member_added: (p) => `${p.actorName}さんがあなたを招待しました`,
  member_removed: () => "旅行メンバーから削除されました",
  role_changed: (p) => `あなたのロールが「${p.newRole}」に変更されました`,
  schedule_created: (p) => `${p.actorName}さんが予定「${p.entityName}」を追加しました`,
  schedule_updated: (p) => `${p.actorName}さんが予定「${p.entityName}」を更新しました`,
  schedule_deleted: (p) => `${p.actorName}さんが予定を削除しました`,
  poll_started: () => "日程投票が開始されました",
  poll_closed: () => "日程投票が終了しました",
  expense_added: (p) => `${p.actorName}さんが費用「${p.entityName}」を追加しました`,
  settlement_checked: (p) => `${p.actorName}さんが精算をチェックしました`,
  candidate_created: (p) => `${p.actorName}さんが候補「${p.entityName}」を追加しました`,
  candidate_deleted: (p) => `${p.actorName}さんが候補を削除しました`,
  candidate_reaction: (p) => `${p.actorName}さんが候補「${p.entityName}」にリアクションしました`,
  discord_webhook_disabled: (p) =>
    `「${p.tripName}」のDiscord通知が無効化されました。設定を確認してください`,
};

// ─── UI labels (Japanese, used in dropdowns and badges) ───────────────────────

export const CATEGORY_LABELS: Record<ScheduleCategory, string> = {
  sightseeing: "観光",
  restaurant: "飲食",
  hotel: "宿泊",
  transport: "移動",
  activity: "アクティビティ",
  other: "その他",
};

export const TRANSPORT_METHOD_LABELS: Record<TransportMethod, string> = {
  train: "電車",
  shinkansen: "新幹線",
  bus: "バス",
  taxi: "タクシー",
  walk: "徒歩",
  car: "車",
  airplane: "飛行機",
  bicycle: "自転車",
};

export const STATUS_LABELS: Record<TripStatus, string> = {
  scheduling: "日程調整中",
  draft: "下書き",
  planned: "計画済み",
  active: "進行中",
  completed: "完了",
};

export const ROLE_LABELS: Record<MemberRole, string> = {
  owner: "オーナー",
  editor: "編集者",
  viewer: "閲覧者",
};

export const SCHEDULE_COLOR_LABELS: Record<ScheduleColor, string> = {
  blue: "青",
  red: "赤",
  green: "緑",
  yellow: "黄",
  purple: "紫",
  pink: "ピンク",
  orange: "オレンジ",
  gray: "グレー",
};

export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  transportation: "交通費",
  accommodation: "宿泊費",
  meals: "食費",
  communication: "通信費",
  supplies: "消耗品費",
  entertainment: "交際費",
  conference: "会議費",
  other: "その他",
};

export const SPLIT_TYPE_LABELS: Record<ExpenseSplitType, string> = {
  equal: "均等",
  custom: "カスタム",
  itemized: "アイテム別",
};

export const VISIBILITY_LABELS = {
  private: "非公開",
  friends_only: "フレンド限定",
  public: "全体公開",
} as const;
