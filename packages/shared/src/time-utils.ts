/**
 * Today as a JST "YYYY-MM-DD" calendar date, independent of the host timezone
 * (servers run in UTC). Weather forecast dates are stored as JST calendar dates.
 */
export function jstToday(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** "HH:MM" or "HH:MM:SS" -> total minutes from 00:00 */
export function timeToMinutes(time: string): number {
  const parts = time.split(":");
  if (parts.length < 2) {
    throw new Error(`Invalid time format: ${time}`);
  }
  const [h, m] = parts.map(Number);
  // Range check, not just NaN: "24:00" or "12:99" would otherwise produce a
  // minute value that minutesToTime and delta math silently mishandle.
  if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || h > 23 || m < 0 || m > 59) {
    throw new Error(`Invalid time format: ${time}`);
  }
  return h * 60 + m;
}

/** total minutes -> "HH:MM" (0-1439 range) */
export function minutesToTime(mins: number): string {
  if (mins < 0 || mins > 1439) {
    throw new Error(`Minutes out of range (0-1439): ${mins}`);
  }
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Add deltaMinutes to a time string.
 * Returns null if result is outside 00:00-23:59.
 */
export function shiftTime(time: string, deltaMinutes: number): string | null {
  const mins = timeToMinutes(time) + deltaMinutes;
  if (mins < 0 || mins > 1439) return null;
  return minutesToTime(mins);
}

export type TimeDelta = { delta: number; source: "start" | "end" };

type TimeFields = {
  startTime?: string | null;
  endTime?: string | null;
  endDayOffset?: number | null;
};

/**
 * Compare original and updated time fields to compute the delta in minutes.
 * Returns null if no meaningful time change occurred.
 * Prioritizes end time change over start time change.
 */
export function computeTimeDelta(original: TimeFields, updated: TimeFields): TimeDelta | null {
  const oldEndOffset = original.endDayOffset ?? 0;
  const newEndOffset = updated.endDayOffset ?? 0;

  // End time changed (same endDayOffset)
  if (
    original.endTime &&
    updated.endTime &&
    oldEndOffset === newEndOffset &&
    original.endTime !== updated.endTime
  ) {
    // The string differs but the minute value can be identical (e.g. "12:00:00"
    // vs "12:00"). A zero delta is not a meaningful change, so fall through.
    const delta = timeToMinutes(updated.endTime) - timeToMinutes(original.endTime);
    if (delta !== 0) {
      return { delta, source: "end" };
    }
  }
  // Start time changed
  if (original.startTime && updated.startTime && original.startTime !== updated.startTime) {
    const delta = timeToMinutes(updated.startTime) - timeToMinutes(original.startTime);
    if (delta !== 0) {
      return { delta, source: "start" };
    }
  }
  return null;
}
