// Shared formatting helpers for the weather tool (used by overview + detail).

export function formatTemp(value: number | null): string {
  return value == null ? "--" : `${value}°`;
}

// Parse "YYYY-MM-DD" as UTC midnight and format with timeZone UTC so the weekday
// reflects the calendar date regardless of the browser timezone.
export function formatDate(date: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    month: "numeric",
    day: "numeric",
    weekday: "short",
    timeZone: "UTC",
  }).format(new Date(date));
}

// Format a JMA issue timestamp in JST (the agency's reference timezone).
export function formatReportTime(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Tokyo",
  }).format(new Date(iso));
}
