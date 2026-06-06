import { MAX_TRIPS_PER_USER } from "@sugara/shared";
import type { useSession } from "@/lib/auth-client";

type SessionData = ReturnType<typeof useSession>["data"];

type SessionUserWithGuest = {
  isAnonymous?: boolean;
  guestExpiresAt?: string;
  tripLimit?: number;
};

function getGuestFields(session: SessionData): SessionUserWithGuest | null {
  if (!session?.user) return null;
  return session.user as SessionUserWithGuest;
}

export function isGuestUser(session: SessionData): boolean {
  return !!getGuestFields(session)?.isAnonymous;
}

export function getGuestDaysRemaining(session: SessionData): number {
  const guestExpiresAt = getGuestFields(session)?.guestExpiresAt;
  if (!guestExpiresAt) return 0;
  const expiresAt = new Date(guestExpiresAt);
  return Math.max(0, Math.ceil((expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000)));
}

// Effective trip creation cap for the current user: the per-user override or the global default.
export function getUserTripLimit(session: SessionData): number {
  return getGuestFields(session)?.tripLimit ?? MAX_TRIPS_PER_USER;
}
