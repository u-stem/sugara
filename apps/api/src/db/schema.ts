import { relations, sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const tripStatusEnum = pgEnum("trip_status", [
  "scheduling",
  "draft",
  "planned",
  "active",
  "completed",
]);
export const tripMemberRoleEnum = pgEnum("trip_member_role", ["owner", "editor", "viewer"]);
export const transportMethodEnum = pgEnum("transport_method", [
  "train",
  "shinkansen",
  "bus",
  "taxi",
  "walk",
  "car",
  "airplane",
  // Appended at the end so the migration is a plain ADD VALUE (Postgres cannot
  // reorder enum values). UI display order is controlled separately.
  "bicycle",
]);

export const friendStatusEnum = pgEnum("friend_status", ["pending", "accepted"]);

export const bookmarkListVisibilityEnum = pgEnum("bookmark_list_visibility", [
  "private",
  "friends_only",
  "public",
]);

export const scheduleCategoryEnum = pgEnum("schedule_category", [
  "sightseeing",
  "restaurant",
  "hotel",
  "transport",
  "activity",
  "other",
]);

export const scheduleColorEnum = pgEnum("schedule_color", [
  "blue",
  "red",
  "green",
  "yellow",
  "purple",
  "pink",
  "orange",
  "gray",
]);

export const expenseSplitTypeEnum = pgEnum("expense_split_type", ["equal", "custom", "itemized"]);

export const expenseCategoryEnum = pgEnum("expense_category", [
  "transportation",
  "accommodation",
  "meals",
  "communication",
  "supplies",
  "entertainment",
  "conference",
  "other",
]);

export const pollStatusEnum = pgEnum("poll_status", ["open", "confirmed", "closed"]);
export const pollResponseEnum = pgEnum("poll_response", ["ok", "maybe", "ng"]);

export const quickPollStatusEnum = pgEnum("quick_poll_status", ["open", "closed"]);

export const souvenirPriorityEnum = pgEnum("souvenir_priority", ["high", "medium"]);
export const souvenirShareStyleEnum = pgEnum("souvenir_share_style", ["recommend", "errand"]);

export const weatherTypeEnum = pgEnum("weather_type", [
  "sunny",
  "partly_cloudy",
  "cloudy",
  "mostly_cloudy",
  "light_rain",
  "rainy",
  "heavy_rain",
  "thunder",
  "snowy",
  "sleet",
  "foggy",
]);

// --- Tables ---

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 100 }).notNull(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: varchar("image", { length: 500 }),
  username: varchar("username", { length: 30 }).unique(),
  displayUsername: varchar("display_username", { length: 30 }),
  isAnonymous: boolean("is_anonymous").notNull().default(false),
  guestExpiresAt: timestamp("guest_expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  token: varchar("token", { length: 255 }).notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  ipAddress: varchar("ip_address", { length: 45 }),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

export const accounts = pgTable("accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  accountId: varchar("account_id", { length: 255 }).notNull(),
  providerId: varchar("provider_id", { length: 255 }).notNull(),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
  scope: varchar("scope", { length: 500 }),
  password: text("password"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

export const verifications = pgTable("verifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  identifier: varchar("identifier", { length: 255 }).notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

// External API keys (self-hash auth). The raw key is shown once at creation and
// only its SHA-256 hash is stored, so the key is unrecoverable from the DB.
export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 100 }).notNull(),
    // SHA-256 hex digest of the raw key. Unique so verification is a single-index lookup.
    keyHash: varchar("key_hash", { length: 64 }).notNull().unique(),
    // Leading characters of the raw key (e.g. "sk_a1b2c3d4") for list display only.
    start: varchar("start", { length: 16 }).notNull(),
    // Flat scope labels, e.g. ["trips:read", "expenses:read"]. Whitelisted at the route layer.
    scopes: text("scopes").array().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("api_keys_user_id_idx").on(table.userId)],
).enableRLS();

export const trips = pgTable(
  "trips",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 100 }).notNull(),
    destination: varchar("destination", { length: 100 }),
    startDate: date("start_date"),
    endDate: date("end_date"),
    status: tripStatusEnum("status").notNull().default("draft"),
    coverImageUrl: varchar("cover_image_url", { length: 500 }),
    coverImagePosition: smallint("cover_image_position").notNull().default(50),
    shareToken: varchar("share_token", { length: 64 }).unique(),
    shareTokenExpiresAt: timestamp("share_token_expires_at", { withTimezone: true }),
    mapsEnabled: boolean("maps_enabled").notNull().default(false),
    currency: text("currency").notNull().default("JPY"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "trips_date_range_check",
      sql`${table.startDate} IS NULL OR ${table.endDate} >= ${table.startDate}`,
    ),
  ],
).enableRLS();

export const tripMembers = pgTable(
  "trip_members",
  {
    tripId: uuid("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: tripMemberRoleEnum("role").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.tripId, table.userId] }),
    index("trip_members_user_id_idx").on(table.userId),
  ],
).enableRLS();

export const tripDays = pgTable(
  "trip_days",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tripId: uuid("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    dayNumber: integer("day_number").notNull(),
    memo: text("memo"),
    weatherType: weatherTypeEnum("weather_type"),
    weatherTypeSecondary: weatherTypeEnum("weather_type_secondary"),
    tempHigh: smallint("temp_high"),
    tempLow: smallint("temp_low"),
  },
  (table) => [uniqueIndex("trip_days_trip_date_unique").on(table.tripId, table.date)],
).enableRLS();

export const dayPatterns = pgTable(
  "day_patterns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tripDayId: uuid("trip_day_id")
      .notNull()
      .references(() => tripDays.id, { onDelete: "cascade" }),
    label: varchar("label", { length: 50 }).notNull(),
    isDefault: boolean("is_default").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("day_patterns_trip_day_id_idx").on(table.tripDayId)],
).enableRLS();

export const schedules = pgTable(
  "schedules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tripId: uuid("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    dayPatternId: uuid("day_pattern_id").references(() => dayPatterns.id, {
      onDelete: "cascade",
    }),
    name: varchar("name", { length: 200 }).notNull(),
    category: scheduleCategoryEnum("category").notNull(),
    address: varchar("address", { length: 500 }),
    startTime: time("start_time"),
    endTime: time("end_time"),
    sortOrder: integer("sort_order").notNull().default(0),
    memo: text("memo"),
    urls: text("urls").array().notNull().default([]),
    departurePlace: varchar("departure_place", { length: 200 }),
    arrivalPlace: varchar("arrival_place", { length: 200 }),
    transportMethod: transportMethodEnum("transport_method"),
    // Lightweight planning field for transport schedules: transit fare in the trip
    // currency's integer units. Not linked to expenses/settlement (no FK).
    cost: integer("cost"),
    color: scheduleColorEnum("color").notNull().default("blue"),
    endDayOffset: integer("end_day_offset"),
    crossDayAnchor: text("cross_day_anchor", { enum: ["before", "after"] }),
    crossDayAnchorSourceId: uuid("cross_day_anchor_source_id").references(
      (): AnyPgColumn => schedules.id,
      { onDelete: "set null" },
    ),
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),
    placeId: varchar("place_id", { length: 255 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("schedules_trip_id_idx").on(table.tripId),
    index("schedules_day_pattern_id_idx").on(table.dayPatternId),
    index("schedules_anchor_source_idx").on(table.crossDayAnchorSourceId),
    check(
      "schedules_anchor_consistency",
      sql`(${table.crossDayAnchor} is null) = (${table.crossDayAnchorSourceId} is null)`,
    ),
  ],
).enableRLS();

export const reactionTypeEnum = pgEnum("reaction_type", ["like", "hmm"]);

export const notificationTypeEnum = pgEnum("notification_type", [
  "member_added",
  "member_removed",
  "role_changed",
  "schedule_created",
  "schedule_updated",
  "schedule_deleted",
  "poll_started",
  "poll_closed",
  "expense_added",
  "settlement_checked",
  "candidate_created",
  "candidate_deleted",
  "candidate_reaction",
  "discord_webhook_disabled",
]);

export const scheduleReactions = pgTable(
  "schedule_reactions",
  {
    scheduleId: uuid("schedule_id")
      .notNull()
      .references(() => schedules.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: reactionTypeEnum("type").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.scheduleId, table.userId] })],
).enableRLS();

export const activityLogs = pgTable(
  "activity_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tripId: uuid("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    action: varchar("action", { length: 50 }).notNull(),
    entityType: varchar("entity_type", { length: 50 }).notNull(),
    entityName: varchar("entity_name", { length: 200 }),
    detail: varchar("detail", { length: 200 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("activity_logs_trip_id_created_at_idx").on(table.tripId, table.createdAt)],
).enableRLS();

export const friends = pgTable(
  "friends",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    requesterId: uuid("requester_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    addresseeId: uuid("addressee_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: friendStatusEnum("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("friends_pair_unique").on(
      sql`least(${table.requesterId}, ${table.addresseeId})`,
      sql`greatest(${table.requesterId}, ${table.addresseeId})`,
    ),
    check("friends_no_self_ref", sql`${table.requesterId} != ${table.addresseeId}`),
    index("friends_requester_id_idx").on(table.requesterId),
    index("friends_addressee_id_idx").on(table.addresseeId),
  ],
).enableRLS();

export const bookmarkLists = pgTable(
  "bookmark_lists",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 50 }).notNull(),
    visibility: bookmarkListVisibilityEnum("visibility").notNull().default("private"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("bookmark_lists_user_sort_idx").on(table.userId, table.sortOrder)],
).enableRLS();

export const bookmarks = pgTable(
  "bookmarks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    listId: uuid("list_id")
      .notNull()
      .references(() => bookmarkLists.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 200 }).notNull(),
    memo: text("memo"),
    urls: text("urls").array().notNull().default([]),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("bookmarks_list_sort_idx").on(table.listId, table.sortOrder)],
).enableRLS();

export const groups = pgTable(
  "groups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 50 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("groups_owner_id_idx").on(table.ownerId)],
).enableRLS();

export const groupMembers = pgTable(
  "group_members",
  {
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.groupId, table.userId] }),
    index("group_members_user_id_idx").on(table.userId),
  ],
).enableRLS();

export const schedulePolls = pgTable("schedule_polls", {
  id: uuid("id").primaryKey().defaultRandom(),
  note: text("note"),
  status: pollStatusEnum("status").notNull().default("open"),
  deadline: timestamp("deadline", { withTimezone: true }),
  shareToken: varchar("share_token", { length: 64 }).unique(),
  shareTokenExpiresAt: timestamp("share_token_expires_at", { withTimezone: true }),
  // FK to schedulePollOptions.id is defined via raw SQL in migration
  // to avoid circular type inference in Drizzle's TypeScript layer.
  confirmedOptionId: uuid("confirmed_option_id"),
  tripId: uuid("trip_id")
    .notNull()
    .references(() => trips.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

export const schedulePollOptions = pgTable(
  "schedule_poll_options",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pollId: uuid("poll_id")
      .notNull()
      .references(() => schedulePolls.id, { onDelete: "cascade" }),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (table) => [
    index("schedule_poll_options_poll_id_idx").on(table.pollId),
    check("poll_options_date_range_check", sql`${table.endDate} >= ${table.startDate}`),
  ],
).enableRLS();

export const schedulePollParticipants = pgTable(
  "schedule_poll_participants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pollId: uuid("poll_id")
      .notNull()
      .references(() => schedulePolls.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (table) => [
    index("schedule_poll_participants_poll_id_idx").on(table.pollId),
    uniqueIndex("schedule_poll_participants_poll_user_unique").on(table.pollId, table.userId),
  ],
).enableRLS();

export const schedulePollResponses = pgTable(
  "schedule_poll_responses",
  {
    participantId: uuid("participant_id")
      .notNull()
      .references(() => schedulePollParticipants.id, { onDelete: "cascade" }),
    optionId: uuid("option_id")
      .notNull()
      .references(() => schedulePollOptions.id, { onDelete: "cascade" }),
    response: pollResponseEnum("response").notNull(),
  },
  (table) => [primaryKey({ columns: [table.participantId, table.optionId] })],
).enableRLS();

export const expenses = pgTable(
  "expenses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tripId: uuid("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    paidByUserId: uuid("paid_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 200 }).notNull(),
    amount: integer("amount").notNull(),
    currency: text("currency").notNull().default("JPY"),
    exchangeRate: numeric("exchange_rate", { precision: 12, scale: 6 }),
    baseAmount: integer("base_amount"),
    splitType: expenseSplitTypeEnum("split_type").notNull(),
    category: expenseCategoryEnum("category"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("expenses_trip_id_idx").on(table.tripId)],
).enableRLS();

export const expenseSplits = pgTable(
  "expense_splits",
  {
    expenseId: uuid("expense_id")
      .notNull()
      .references(() => expenses.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    amount: integer("amount").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.expenseId, table.userId] }),
    // The primary key covers (expenseId, userId), so lookups by userId alone — used when
    // filtering or aggregating a single user's splits across expenses — would full-scan.
    index("expense_splits_user_id_idx").on(table.userId),
  ],
).enableRLS();

export const expenseLineItems = pgTable(
  "expense_line_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    expenseId: uuid("expense_id")
      .notNull()
      .references(() => expenses.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 200 }).notNull(),
    amount: integer("amount").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (table) => [index("expense_line_items_expense_id_idx").on(table.expenseId)],
).enableRLS();

export const expenseLineItemMembers = pgTable(
  "expense_line_item_members",
  {
    lineItemId: uuid("line_item_id")
      .notNull()
      .references(() => expenseLineItems.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.lineItemId, table.userId] })],
).enableRLS();

// --- Relations ---

export const usersRelations = relations(users, ({ many }) => ({
  trips: many(trips),
  tripMembers: many(tripMembers),
  sentFriendRequests: many(friends, { relationName: "friendRequester" }),
  receivedFriendRequests: many(friends, { relationName: "friendAddressee" }),
  bookmarkLists: many(bookmarkLists),
  ownedGroups: many(groups),
  groupMemberships: many(groupMembers),
  schedulePollParticipations: many(schedulePollParticipants),
  souvenirItems: many(souvenirItems),
}));

export const tripsRelations = relations(trips, ({ one, many }) => ({
  owner: one(users, { fields: [trips.ownerId], references: [users.id] }),
  members: many(tripMembers),
  days: many(tripDays),
  schedules: many(schedules),
  activityLogs: many(activityLogs),
  poll: one(schedulePolls, { fields: [trips.id], references: [schedulePolls.tripId] }),
  expenses: many(expenses),
  souvenirItems: many(souvenirItems),
  discordWebhook: one(discordWebhooks),
}));

export const tripMembersRelations = relations(tripMembers, ({ one }) => ({
  trip: one(trips, { fields: [tripMembers.tripId], references: [trips.id] }),
  user: one(users, { fields: [tripMembers.userId], references: [users.id] }),
}));

export const tripDaysRelations = relations(tripDays, ({ one, many }) => ({
  trip: one(trips, { fields: [tripDays.tripId], references: [trips.id] }),
  patterns: many(dayPatterns),
}));

export const dayPatternsRelations = relations(dayPatterns, ({ one, many }) => ({
  tripDay: one(tripDays, { fields: [dayPatterns.tripDayId], references: [tripDays.id] }),
  schedules: many(schedules),
}));

export const schedulesRelations = relations(schedules, ({ one, many }) => ({
  trip: one(trips, { fields: [schedules.tripId], references: [trips.id] }),
  dayPattern: one(dayPatterns, { fields: [schedules.dayPatternId], references: [dayPatterns.id] }),
  reactions: many(scheduleReactions),
}));

export const scheduleReactionsRelations = relations(scheduleReactions, ({ one }) => ({
  schedule: one(schedules, {
    fields: [scheduleReactions.scheduleId],
    references: [schedules.id],
  }),
  user: one(users, {
    fields: [scheduleReactions.userId],
    references: [users.id],
  }),
}));

export const activityLogsRelations = relations(activityLogs, ({ one }) => ({
  trip: one(trips, { fields: [activityLogs.tripId], references: [trips.id] }),
  user: one(users, { fields: [activityLogs.userId], references: [users.id] }),
}));

export const friendsRelations = relations(friends, ({ one }) => ({
  requester: one(users, {
    fields: [friends.requesterId],
    references: [users.id],
    relationName: "friendRequester",
  }),
  addressee: one(users, {
    fields: [friends.addresseeId],
    references: [users.id],
    relationName: "friendAddressee",
  }),
}));

export const groupsRelations = relations(groups, ({ one, many }) => ({
  owner: one(users, { fields: [groups.ownerId], references: [users.id] }),
  members: many(groupMembers),
}));

export const groupMembersRelations = relations(groupMembers, ({ one }) => ({
  group: one(groups, { fields: [groupMembers.groupId], references: [groups.id] }),
  user: one(users, { fields: [groupMembers.userId], references: [users.id] }),
}));

export const bookmarkListsRelations = relations(bookmarkLists, ({ one, many }) => ({
  user: one(users, { fields: [bookmarkLists.userId], references: [users.id] }),
  bookmarks: many(bookmarks),
}));

export const bookmarksRelations = relations(bookmarks, ({ one }) => ({
  list: one(bookmarkLists, { fields: [bookmarks.listId], references: [bookmarkLists.id] }),
}));

export const schedulePollsRelations = relations(schedulePolls, ({ one, many }) => ({
  trip: one(trips, { fields: [schedulePolls.tripId], references: [trips.id] }),
  options: many(schedulePollOptions),
  participants: many(schedulePollParticipants),
}));

export const schedulePollOptionsRelations = relations(schedulePollOptions, ({ one, many }) => ({
  poll: one(schedulePolls, {
    fields: [schedulePollOptions.pollId],
    references: [schedulePolls.id],
  }),
  responses: many(schedulePollResponses),
}));

export const schedulePollParticipantsRelations = relations(
  schedulePollParticipants,
  ({ one, many }) => ({
    poll: one(schedulePolls, {
      fields: [schedulePollParticipants.pollId],
      references: [schedulePolls.id],
    }),
    user: one(users, { fields: [schedulePollParticipants.userId], references: [users.id] }),
    responses: many(schedulePollResponses),
  }),
);

export const schedulePollResponsesRelations = relations(schedulePollResponses, ({ one }) => ({
  participant: one(schedulePollParticipants, {
    fields: [schedulePollResponses.participantId],
    references: [schedulePollParticipants.id],
  }),
  option: one(schedulePollOptions, {
    fields: [schedulePollResponses.optionId],
    references: [schedulePollOptions.id],
  }),
}));

export const expensesRelations = relations(expenses, ({ one, many }) => ({
  trip: one(trips, { fields: [expenses.tripId], references: [trips.id] }),
  paidByUser: one(users, { fields: [expenses.paidByUserId], references: [users.id] }),
  splits: many(expenseSplits),
  lineItems: many(expenseLineItems),
}));

export const expenseSplitsRelations = relations(expenseSplits, ({ one }) => ({
  expense: one(expenses, { fields: [expenseSplits.expenseId], references: [expenses.id] }),
  user: one(users, { fields: [expenseSplits.userId], references: [users.id] }),
}));

export const expenseLineItemsRelations = relations(expenseLineItems, ({ one, many }) => ({
  expense: one(expenses, { fields: [expenseLineItems.expenseId], references: [expenses.id] }),
  members: many(expenseLineItemMembers),
}));

export const expenseLineItemMembersRelations = relations(expenseLineItemMembers, ({ one }) => ({
  lineItem: one(expenseLineItems, {
    fields: [expenseLineItemMembers.lineItemId],
    references: [expenseLineItems.id],
  }),
  user: one(users, { fields: [expenseLineItemMembers.userId], references: [users.id] }),
}));

export const souvenirItems = pgTable(
  "souvenir_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tripId: uuid("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 200 }).notNull(),
    recipient: varchar("recipient", { length: 100 }),
    urls: text("urls").array().notNull().default([]),
    addresses: text("addresses").array().notNull().default([]),
    memo: text("memo"),
    priority: souvenirPriorityEnum("priority"),
    isPurchased: boolean("is_purchased").notNull().default(false),
    isShared: boolean("is_shared").notNull().default(false),
    shareStyle: souvenirShareStyleEnum("share_style"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("souvenir_items_trip_id_idx").on(table.tripId),
    index("souvenir_items_user_id_idx").on(table.userId),
  ],
).enableRLS();

export const souvenirItemsRelations = relations(souvenirItems, ({ one }) => ({
  trip: one(trips, { fields: [souvenirItems.tripId], references: [trips.id] }),
  user: one(users, { fields: [souvenirItems.userId], references: [users.id] }),
}));

// Single-row settings table. The CHECK constraint and default enforce id = 1 always.
export const appSettings = pgTable(
  "app_settings",
  {
    id: smallint("id").primaryKey().default(1),
    signupEnabled: boolean("signup_enabled").notNull().default(true),
    mapsMode: text("maps_mode").notNull().default("admin_only"),
  },
  (table) => [check("app_settings_single_row", sql`${table.id} = 1`)],
);

// Records which seed payload (hash of inserted rows) has been applied. Lets idempotent seed
// scripts skip their delete+insert churn when the content is unchanged — critical for seeds
// that run on every deploy (e.g. FAQ content) where the default behavior would overwrite any
// manual DB-side edits and waste DB operations.
export const seedState = pgTable("seed_state", {
  key: text("key").primaryKey(),
  hash: text("hash").notNull(),
  appliedAt: timestamp("applied_at", { withTimezone: true }).notNull().defaultNow(),
});

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tripId: uuid("trip_id").references(() => trips.id, { onDelete: "cascade" }),
    type: notificationTypeEnum("type").notNull(),
    payload: jsonb("payload").notNull().default({}),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("notifications_user_id_created_at_idx").on(table.userId, table.createdAt)],
).enableRLS();

export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    preferences: jsonb("preferences").$type<Record<string, boolean>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("push_subscriptions_user_id_idx").on(table.userId),
    uniqueIndex("push_subscriptions_user_endpoint_unique").on(table.userId, table.endpoint),
  ],
).enableRLS();

export const notificationPreferences = pgTable(
  "notification_preferences",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: notificationTypeEnum("type").notNull(),
    inApp: boolean("in_app").notNull().default(true),
  },
  (table) => [primaryKey({ columns: [table.userId, table.type] })],
).enableRLS();

export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(users, { fields: [notifications.userId], references: [users.id] }),
  trip: one(trips, { fields: [notifications.tripId], references: [trips.id] }),
}));

export const pushSubscriptionsRelations = relations(pushSubscriptions, ({ one }) => ({
  user: one(users, { fields: [pushSubscriptions.userId], references: [users.id] }),
}));

export const notificationPreferencesRelations = relations(notificationPreferences, ({ one }) => ({
  user: one(users, { fields: [notificationPreferences.userId], references: [users.id] }),
}));

export const routeCache = pgTable("route_cache", {
  id: uuid("id").primaryKey().defaultRandom(),
  cacheKey: text("cache_key").notNull().unique(),
  durationSeconds: integer("duration_seconds").notNull(),
  encodedPolyline: text("encoded_polyline"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const faqs = pgTable("faqs", {
  id: uuid("id").primaryKey().defaultRandom(),
  question: text("question").notNull(),
  answer: text("answer").notNull(),
  category: text("category").notNull().default("other"),
  locale: text("locale").notNull().default("ja"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const quickPolls = pgTable(
  "quick_polls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    creatorId: uuid("creator_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    shareToken: varchar("share_token", { length: 64 }).notNull().unique(),
    question: text("question").notNull(),
    allowMultiple: boolean("allow_multiple").notNull().default(false),
    showResultsBeforeVote: boolean("show_results_before_vote").notNull().default(true),
    status: quickPollStatusEnum("status").notNull().default("open"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("quick_polls_creator_id_idx").on(table.creatorId),
    index("quick_polls_expires_at_idx").on(table.expiresAt),
  ],
).enableRLS();

export const quickPollOptions = pgTable(
  "quick_poll_options",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pollId: uuid("poll_id")
      .notNull()
      .references(() => quickPolls.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (table) => [index("quick_poll_options_poll_id_idx").on(table.pollId)],
).enableRLS();

export const quickPollVotes = pgTable(
  "quick_poll_votes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pollId: uuid("poll_id")
      .notNull()
      .references(() => quickPolls.id, { onDelete: "cascade" }),
    optionId: uuid("option_id")
      .notNull()
      .references(() => quickPollOptions.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    anonymousId: text("anonymous_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("quick_poll_votes_poll_id_idx").on(table.pollId),
    uniqueIndex("quick_poll_votes_option_user_idx")
      .on(table.pollId, table.optionId, table.userId)
      .where(sql`user_id IS NOT NULL`),
    uniqueIndex("quick_poll_votes_option_anonymous_idx")
      .on(table.pollId, table.optionId, table.anonymousId)
      .where(sql`anonymous_id IS NOT NULL`),
    check(
      "quick_poll_votes_user_or_anonymous",
      sql`user_id IS NOT NULL OR anonymous_id IS NOT NULL`,
    ),
  ],
).enableRLS();

export const quickPollsRelations = relations(quickPolls, ({ one, many }) => ({
  creator: one(users, { fields: [quickPolls.creatorId], references: [users.id] }),
  options: many(quickPollOptions),
  votes: many(quickPollVotes),
}));

export const quickPollOptionsRelations = relations(quickPollOptions, ({ one, many }) => ({
  poll: one(quickPolls, { fields: [quickPollOptions.pollId], references: [quickPolls.id] }),
  votes: many(quickPollVotes),
}));

export const quickPollVotesRelations = relations(quickPollVotes, ({ one }) => ({
  poll: one(quickPolls, { fields: [quickPollVotes.pollId], references: [quickPolls.id] }),
  option: one(quickPollOptions, {
    fields: [quickPollVotes.optionId],
    references: [quickPollOptions.id],
  }),
  user: one(users, { fields: [quickPollVotes.userId], references: [users.id] }),
}));

// ─── Settlement Payments ────────────────────────────────────────────────────

export const settlementPayments = pgTable(
  "settlement_payments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tripId: uuid("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    fromUserId: uuid("from_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    toUserId: uuid("to_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    amount: integer("amount").notNull(),
    paidAt: timestamp("paid_at", { withTimezone: true }).defaultNow().notNull(),
    paidByUserId: uuid("paid_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("settlement_payments_trip_id_idx").on(table.tripId),
    uniqueIndex("settlement_payments_trip_from_to_amount_idx").on(
      table.tripId,
      table.fromUserId,
      table.toUserId,
      table.amount,
    ),
  ],
).enableRLS();

export const settlementPaymentsRelations = relations(settlementPayments, ({ one }) => ({
  trip: one(trips, { fields: [settlementPayments.tripId], references: [trips.id] }),
  fromUser: one(users, {
    fields: [settlementPayments.fromUserId],
    references: [users.id],
    relationName: "settlementPaymentFrom",
  }),
  toUser: one(users, {
    fields: [settlementPayments.toUserId],
    references: [users.id],
    relationName: "settlementPaymentTo",
  }),
  paidByUser: one(users, {
    fields: [settlementPayments.paidByUserId],
    references: [users.id],
    relationName: "settlementPaymentPaidBy",
  }),
}));

export const discordWebhooks = pgTable("discord_webhooks", {
  id: uuid().primaryKey().defaultRandom(),
  tripId: uuid("trip_id")
    .notNull()
    .references(() => trips.id, { onDelete: "cascade" })
    .unique(),
  webhookUrl: text("webhook_url").notNull(),
  enabledTypes: jsonb("enabled_types").$type<string[]>().notNull(),
  locale: text("locale").notNull().default("ja"),
  isActive: boolean("is_active").notNull().default(true),
  lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
  failureCount: integer("failure_count").notNull().default(0),
  createdBy: uuid("created_by")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

export const discordWebhooksRelations = relations(discordWebhooks, ({ one }) => ({
  trip: one(trips, { fields: [discordWebhooks.tripId], references: [trips.id] }),
  creator: one(users, { fields: [discordWebhooks.createdBy], references: [users.id] }),
}));
