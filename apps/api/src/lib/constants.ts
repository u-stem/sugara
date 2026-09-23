import { MAX_LOGS_PER_TRIP } from "@sugara/shared";

export { ERROR_MSG } from "@sugara/shared";
export { MAX_LOGS_PER_TRIP };
export const DEFAULT_PATTERN_LABEL = "デフォルト";

// 7-day TTL in milliseconds — shared by guest accounts and share links
export const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

// Guest account config
export const GUEST_EMAIL_DOMAIN = "guest.sugara.local";

// Username constraints (must match DB schema)
export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 20;

// Notification list page size
export const NOTIFICATIONS_LIST_LIMIT = 20;

// Rate limit configs
export const RATE_LIMIT_PUBLIC_RESOURCE = { window: 60, max: 30 } as const;
export const RATE_LIMIT_ACCOUNT_MUTATION = { window: 300, max: 5 } as const;
export const RATE_LIMIT_FEEDBACK = { window: 60, max: 5 } as const;
export const MAX_TRIP_DAYS = 365;

export const PG_UNIQUE_VIOLATION = "23505";
