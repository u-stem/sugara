import type { CurrencyCode } from "./currency";
import type { ArticleVisibility } from "./schemas/article";
import type { BookmarkListVisibility } from "./schemas/bookmark";
import type { ExpenseCategory, ExpenseSplitType } from "./schemas/expense";
import type { MemberRole } from "./schemas/member";
import type { PollResponseValue, PollStatus } from "./schemas/poll";
import type { ReactionType, ScheduleCategory, ScheduleColor } from "./schemas/schedule";
import type { TripStatus } from "./schemas/trip";
import type { WeatherType } from "./schemas/trip-day";

export type ScheduleResponse = {
  id: string;
  name: string;
  category: ScheduleCategory;
  address?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  sortOrder: number;
  memo?: string | null;
  urls: string[];
  departurePlace?: string | null;
  arrivalPlace?: string | null;
  transportMethod?: string | null;
  cost?: number | null;
  color: ScheduleColor;
  endDayOffset?: number | null;
  crossDayAnchor?: "before" | "after" | null;
  crossDayAnchorSourceId?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  placeId?: string | null;
  updatedAt: string;
};

export type CandidateResponse = ScheduleResponse & {
  likeCount: number;
  hmmCount: number;
  myReaction: ReactionType | null;
};

export type DayPatternResponse = {
  id: string;
  label: string;
  isDefault: boolean;
  sortOrder: number;
  schedules: ScheduleResponse[];
};

export type DayResponse = {
  id: string;
  dayNumber: number;
  date: string;
  memo?: string | null;
  weatherType?: WeatherType | null;
  weatherTypeSecondary?: WeatherType | null;
  tempHigh?: number | null;
  tempLow?: number | null;
  patterns: DayPatternResponse[];
};

export type TripPollSummary = {
  id: string;
  status: PollStatus;
  participantCount: number;
  respondedCount: number;
};

export type TripResponse = {
  id: string;
  title: string;
  destination: string | null;
  startDate: string | null;
  endDate: string | null;
  status: TripStatus;
  coverImageUrl: string | null;
  coverImagePosition: number;
  shareToken: string | null;
  currency: string;
  role: MemberRole;
  days: DayResponse[];
  candidates: CandidateResponse[];
  scheduleCount: number;
  expenseCount: number;
  memberCount: number;
  poll: TripPollSummary | null;
  mapsEnabled: boolean;
};

export type TripListItem = {
  id: string;
  title: string;
  destination: string | null;
  startDate: string | null;
  endDate: string | null;
  status: TripStatus;
  coverImageUrl: string | null;
  coverImagePosition: number;
  currency: string;
  role: MemberRole;
  totalSchedules: number;
  updatedAt: string;
};

export type CrossDayEntry = {
  schedule: ScheduleResponse;
  sourceDayId: string;
  sourcePatternId: string;
  sourceDayNumber: number;
  crossDayPosition: "intermediate" | "final";
};

export type MemberResponse = {
  userId: string;
  role: MemberRole;
  name: string;
  image?: string | null;
  hasExpenses?: boolean;
};

export type ActivityLogResponse = {
  id: string;
  userId: string;
  userName: string;
  action: string;
  entityType: string;
  entityName?: string | null;
  detail?: string | null;
  createdAt: string;
};

export type FriendResponse = {
  friendId: string;
  userId: string;
  name: string;
  image?: string | null;
};

export type FriendRequestResponse = {
  id: string;
  requesterId: string;
  name: string;
  image?: string | null;
  createdAt: string;
};

export type SentFriendRequestResponse = {
  id: string;
  addresseeId: string;
  name: string;
  image?: string | null;
  createdAt: string;
};

export type BookmarkListResponse = {
  id: string;
  name: string;
  visibility: BookmarkListVisibility;
  sortOrder: number;
  bookmarkCount: number;
  createdAt: string;
  updatedAt: string;
};

export type BookmarkResponse = {
  id: string;
  name: string;
  memo?: string | null;
  urls: string[];
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type BookmarkListDetailResponse = BookmarkListResponse & {
  bookmarks: BookmarkResponse[];
};

export type ArticleResponse = {
  id: string;
  ownerId: string;
  title: string;
  content: string;
  tags: string[];
  visibility: ArticleVisibility;
  sortOrder: number;
  likeCount: number;
  likedByMe: boolean;
  tripIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type ArticleListItem = {
  id: string;
  ownerId: string;
  title: string;
  tags: string[];
  visibility: ArticleVisibility;
  sortOrder: number;
  likeCount: number;
  likedByMe: boolean;
  createdAt: string;
  updatedAt: string;
};

export type GroupResponse = {
  id: string;
  name: string;
  memberCount: number;
  createdAt: string;
  updatedAt: string;
};

export type GroupMemberResponse = {
  userId: string;
  name: string;
  image?: string | null;
  addedAt: string;
};

export type BulkAddMembersResponse = {
  added: number;
  failed: number;
};

export type PublicProfileResponse = {
  id: string;
  name: string;
  image?: string | null;
  bookmarkLists: BookmarkListResponse[];
};

export type PollOptionResponse = {
  id: string;
  startDate: string;
  endDate: string;
  sortOrder: number;
};

export type PollParticipantResponse = {
  id: string;
  userId: string;
  name: string;
  image?: string | null;
  responses: { optionId: string; response: PollResponseValue }[];
};

export type PollListItem = {
  id: string;
  title: string;
  destination: string | null;
  status: PollStatus;
  deadline: string | null;
  participantCount: number;
  respondedCount: number;
  createdAt: string;
  updatedAt: string;
};

export type PollDetailResponse = {
  id: string;
  ownerId: string;
  title: string;
  destination: string | null;
  note: string | null;
  status: PollStatus;
  deadline: string | null;
  confirmedOptionId: string | null;
  tripId: string;
  options: PollOptionResponse[];
  participants: PollParticipantResponse[];
  isOwner: boolean;
  myParticipantId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SharedPollResponse = Omit<
  PollDetailResponse,
  "isOwner" | "myParticipantId" | "tripId" | "ownerId"
> & {
  shareExpiresAt: string | null;
};

// Expense API response types

export type ExpenseSplit = {
  userId: string;
  amount: number;
  user: { id: string; name: string };
};

export type ExpenseLineItemResponse = {
  id: string;
  name: string;
  amount: number;
  sortOrder: number;
  members: { userId: string }[];
};

export type ExpenseItem = {
  id: string;
  title: string;
  amount: number;
  currency: CurrencyCode;
  exchangeRate: string | null;
  baseAmount: number | null;
  splitType: ExpenseSplitType;
  category: ExpenseCategory | null;
  paidByUserId: string;
  paidByUser: { id: string; name: string };
  splits: ExpenseSplit[];
  lineItems: ExpenseLineItemResponse[];
  createdAt: string;
};

export type Transfer = {
  from: { id: string; name: string };
  to: { id: string; name: string };
  amount: number;
};

export type Settlement = {
  totalAmount: number;
  balances: { userId: string; name: string; net: number }[];
  /** Minimal-transfer settlement: fewest payments to settle all balances. */
  transfers: Transfer[];
  /** Advance-based settlement: repay each expense's payer directly (pairs netted). */
  directTransfers: Transfer[];
};

export type CategoryTotal = {
  category: ExpenseCategory;
  label: string;
  total: number;
  count: number;
};

export type ExpensesResponse = {
  tripCurrency: CurrencyCode;
  expenses: ExpenseItem[];
  settlement: Settlement;
  settlementPayments: SettlementPayment[];
  categoryTotals: CategoryTotal[];
};

export type SettlementPayment = {
  id: string;
  tripId: string;
  fromUserId: string;
  toUserId: string;
  amount: number;
  paidAt: string;
  paidByUserId: string;
};

export type UnsettledTransfer = {
  fromUser: { id: string; name: string };
  toUser: { id: string; name: string };
  amount: number;
};

export type UnsettledTrip = {
  tripId: string;
  tripTitle: string;
  tripCurrency: CurrencyCode;
  transfers: UnsettledTransfer[];
};

export type UnsettledSummary = {
  totalOwed: number;
  totalOwedTo: number;
  trips: UnsettledTrip[];
};

// Notification API response types

export type Notification = {
  id: string;
  type: string;
  payload: Record<string, string>;
  readAt: string | null;
  createdAt: string;
  tripId: string | null;
};

export type NotificationsResponse = {
  notifications: Notification[];
  unreadCount: number;
};

// Shared trip view types

export type SharedTripResponse = {
  title: string;
  destination: string | null;
  startDate: string | null;
  endDate: string | null;
  status: TripStatus;
  days: DayResponse[];
  candidates: ScheduleResponse[];
  shareExpiresAt: string | null;
};

// Activity log paginated response

export type LogsResponse = {
  items: ActivityLogResponse[];
  nextCursor: string | null;
};

// Admin /api/admin/stats response — summary counters for the admin dashboard.

export type AdminStatsResponse = {
  users: {
    total: number;
    guest: number;
    newLast7Days: number;
    newLast30Days: number;
  };
  trips: {
    total: number;
    byStatus: Record<TripStatus, number>;
    newLast7Days: number;
  };
  content: {
    schedules: number;
    souvenirs: number;
  };
  supabase: {
    mau: number;
    dbSizeBytes: number;
  };
};
