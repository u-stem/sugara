"use client";

import type { TripResponse } from "@sugara/shared";
import { MAX_MEMBERS_PER_TRIP } from "@sugara/shared";
import Image from "next/image";
import { useLocale, useTranslations } from "next-intl";

import { PresenceAvatars } from "@/components/presence-avatars";
import { ReactionButton } from "@/components/reaction-button";
import { TripActions } from "@/components/trip-actions";
import { formatDateRange, getDayCount } from "@/lib/format";
import type { PresenceUser } from "@/lib/hooks/use-trip-sync";

export function TripHeader({
  trip,
  tripId,
  otherPresence,
  isConnected,
  online,
  canEdit,
  onCacheWritten,
  onEditOpen,
  onOpenBookmarks,
  onOpenActivity,
  onOpenArticles,
  onOpenMap,
  onReaction,
  cooldown,
}: {
  trip: TripResponse;
  tripId: string;
  otherPresence: PresenceUser[];
  isConnected: boolean;
  online: boolean;
  canEdit: boolean;
  onCacheWritten: () => void;
  onEditOpen: () => void;
  onOpenBookmarks?: () => void;
  onOpenActivity?: () => void;
  onOpenArticles?: () => void;
  onOpenMap?: () => void;
  onReaction?: (emoji: string) => void;
  cooldown?: boolean;
}) {
  const tripActionsProps = {
    tripId,
    tripTitle: trip.title,
    status: trip.status,
    role: trip.role,
    pollId: trip.poll?.id,
    // Status change writes the complete new status into the cache itself, so
    // skip the refetch (#155).
    onStatusChange: onCacheWritten,
    onEdit: canEdit ? onEditOpen : undefined,
    disabled: !online,
    memberLimitReached: trip.memberCount >= MAX_MEMBERS_PER_TRIP,
    onOpenBookmarks,
    onOpenActivity,
    onOpenArticles,
    onOpenMap,
  } as const;

  // Show reaction button only when co-editing (other members are present)
  const locale = useLocale();
  const tdf = useTranslations("dateFormat");
  const showReaction = onReaction && otherPresence.length > 0;

  return (
    <div className="mb-3 lg:mb-6">
      {trip.coverImageUrl && (
        <div className="-mx-4 relative mb-3 aspect-[3/1] overflow-hidden lg:mx-0 lg:rounded-xl">
          <Image
            src={trip.coverImageUrl}
            alt=""
            fill
            className="object-cover"
            style={{ objectPosition: `center ${trip.coverImagePosition}%` }}
            sizes="100vw"
            priority
          />
        </div>
      )}

      {/* Mobile compact header */}
      <div className="flex h-11 items-center gap-2 lg:hidden">
        <h1 className="min-w-0 flex-1 truncate text-base font-bold" translate="yes">
          {trip.title}
        </h1>
        {showReaction && <ReactionButton onReaction={onReaction} cooldown={cooldown ?? false} />}
        <PresenceAvatars users={otherPresence} isConnected={isConnected} />
        <TripActions {...tripActionsProps} compact />
      </div>

      {/* Desktop header */}
      <div className="hidden lg:block">
        <div className="flex items-center gap-3">
          <h1 className="min-w-0 truncate text-2xl font-bold" translate="yes">
            {trip.title}
          </h1>
          <PresenceAvatars users={otherPresence} isConnected={isConnected} />
        </div>
        <p className="text-muted-foreground">
          {trip.startDate && trip.endDate ? (
            <>
              {trip.destination ? <span translate="yes">{trip.destination} / </span> : null}
              {formatDateRange(trip.startDate, trip.endDate, locale)}
              <span className="ml-2 text-sm">
                ({tdf("dayCount", { count: getDayCount(trip.startDate, trip.endDate) })})
              </span>
            </>
          ) : (
            <span translate="yes">{trip.destination}</span>
          )}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <TripActions {...tripActionsProps} />
          {showReaction && <ReactionButton onReaction={onReaction} cooldown={cooldown ?? false} />}
        </div>
      </div>
    </div>
  );
}
