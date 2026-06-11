// Shared serializers for v1 external API DTOs.
//
// All functions here are pure transformations from internal row/data shapes to
// the public v1 JSON format. No DB calls, no side effects.
//
// Structural (minimal) types are used for rows that may come from either a full
// `$inferSelect` (write paths) or a column-selected query result (read paths).
// Full-row types are used only where the serializer is write-side exclusive.

import type { schedules, trips } from "../../db/schema";
import { resolveMemberRef } from "../../lib/external-api/member-no";

// ---------------------------------------------------------------------------
// Trip
// ---------------------------------------------------------------------------

type TripRow = typeof trips.$inferSelect;

export function serializeTripDto(trip: TripRow) {
  return {
    id: trip.id,
    title: trip.title,
    destination: trip.destination ?? null,
    startDate: trip.startDate ?? null,
    endDate: trip.endDate ?? null,
    currency: trip.currency,
    status: trip.status,
    createdAt: trip.createdAt.toISOString(),
    updatedAt: trip.updatedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Schedule
// ---------------------------------------------------------------------------

type ScheduleRow = typeof schedules.$inferSelect;

export function serializeScheduleDto(s: ScheduleRow) {
  return {
    id: s.id,
    name: s.name,
    category: s.category,
    startTime: s.startTime ?? null,
    endTime: s.endTime ?? null,
    address: s.address ?? null,
    memo: s.memo ?? null,
    urls: s.urls,
    departurePlace: s.departurePlace ?? null,
    arrivalPlace: s.arrivalPlace ?? null,
    transportMethod: s.transportMethod ?? null,
    cost: s.cost ?? null,
    color: s.color,
    endDayOffset: s.endDayOffset ?? null,
    sortOrder: s.sortOrder,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Bookmark list
//
// Accepts a structural type so that both full-row (write) and column-selected
// (read) query results are assignable without extra casts.
// ---------------------------------------------------------------------------

type BookmarkListInput = {
  id: string;
  name: string;
  visibility: string;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
};

export function serializeListDto(list: BookmarkListInput, bookmarkCount: number) {
  return {
    id: list.id,
    name: list.name,
    visibility: list.visibility,
    sortOrder: list.sortOrder,
    bookmarkCount,
    createdAt: list.createdAt.toISOString(),
    updatedAt: list.updatedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Bookmark
// ---------------------------------------------------------------------------

type BookmarkInput = {
  id: string;
  name: string;
  memo: string | null;
  urls: string[];
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
};

export function serializeBookmarkDto(b: BookmarkInput) {
  return {
    id: b.id,
    name: b.name,
    memo: b.memo ?? null,
    urls: b.urls,
    sortOrder: b.sortOrder,
    createdAt: b.createdAt.toISOString(),
    updatedAt: b.updatedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Article
//
// `content` and `tags` are included even though the list endpoint omits them;
// the read-list path never calls this function (the list endpoint intentionally
// excludes the body). Only the write (POST/PATCH) and read-detail (GET /:id)
// paths call serializeArticleDto.
// ---------------------------------------------------------------------------

type ArticleInput = {
  id: string;
  title: string;
  content: string;
  tags: string[];
  visibility: string;
  createdAt: Date;
  updatedAt: Date;
};

export function serializeArticleDto(article: ArticleInput, tripIds: string[]) {
  return {
    id: article.id,
    title: article.title,
    content: article.content,
    tags: article.tags,
    visibility: article.visibility,
    tripIds,
    createdAt: article.createdAt.toISOString(),
    updatedAt: article.updatedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Expense
//
// Converts internal userId references to memberNo-based MemberRef objects
// for the v1 external format. `splits` must already be computed (minor units).
// ---------------------------------------------------------------------------

type ExpenseSplitInput = { userId: string; amount: number };

type ExpenseInput = {
  id: string;
  title: string;
  amount: number;
  currency: string;
  category: string | null;
  createdAt: Date;
  paidByUserId: string;
  splits: ReadonlyArray<ExpenseSplitInput>;
};

export function serializeExpenseDto(
  expense: ExpenseInput,
  memberNoMap: Map<string, number>,
  nameMap: Map<string, string>,
) {
  return {
    id: expense.id,
    title: expense.title,
    amount: expense.amount,
    currency: expense.currency,
    category: expense.category,
    date: expense.createdAt.toISOString(),
    paidBy: resolveMemberRef(memberNoMap, nameMap, expense.paidByUserId),
    splits: expense.splits.map((s) => ({
      ...resolveMemberRef(memberNoMap, nameMap, s.userId),
      amount: s.amount,
    })),
  };
}
