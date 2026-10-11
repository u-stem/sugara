"use client";

import type {
  CrossDayEntry,
  DayPatternResponse,
  ScheduleResponse,
  SharedTripResponse,
  TransportMethod,
  WeatherType,
} from "@sugara/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Calendar,
  Clock,
  ExternalLink,
  Lightbulb,
  MapPin,
  RefreshCw,
  Route,
  StickyNote,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Logo } from "@/components/logo";
import { SharedFooter } from "@/components/shared-footer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LoadingBoundary } from "@/components/ui/loading-boundary";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError, api } from "@/lib/api";
import { SCHEDULE_COLOR_CLASSES, STATUS_COLORS } from "@/lib/colors";
import { getCrossDayEntries } from "@/lib/cross-day";
import { getCrossDayLabel, getStartDayLabel } from "@/lib/cross-day-label";
import {
  formatDate,
  formatDateFromISO,
  formatDateRange,
  formatTimeRange,
  getDayCount,
  isSafeUrl,
  stripProtocol,
} from "@/lib/format";
import { CATEGORY_ICONS } from "@/lib/icons";
import { buildMergedTimeline } from "@/lib/merge-timeline";
import { queryKeys } from "@/lib/query-keys";
import { sharedTripChannelName } from "@/lib/share-channel";
import { supabase } from "@/lib/supabase";
import { buildMapsSearchUrl, buildTransportUrl } from "@/lib/transport-link";
import { cn } from "@/lib/utils";
import { WEATHER_ICON, WEATHER_ICON_COLOR } from "@/lib/weather-icons";

function SharedHeader() {
  const tsh = useTranslations("shared");
  return (
    <header className="border-b">
      <div className="container flex h-14 items-center">
        <Logo href="/" />
        <span className="ml-2 text-sm text-muted-foreground">{tsh("sharedPlan")}</span>
      </div>
    </header>
  );
}

function SharedTripBodySkeleton() {
  return (
    <div className="container max-w-3xl py-8">
      {/* Hero skeleton */}
      <div className="mb-8 rounded-xl border bg-card px-6 py-6 shadow-sm">
        <Skeleton className="mb-3 h-5 w-16 rounded-full" />
        <Skeleton className="h-8 w-56" />
        <div className="mt-3 flex items-center gap-4">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-36" />
        </div>
      </div>
      {/* Day card skeletons */}
      <div className="space-y-6">
        {[1, 2].map((day) => (
          <div key={day} className="overflow-hidden rounded-xl border bg-card shadow-sm">
            <div className="border-b bg-muted/40 px-4 py-3 sm:px-5">
              <div className="flex items-center gap-2">
                <Skeleton className="h-6 w-6 rounded-full" />
                <Skeleton className="h-4 w-24" />
              </div>
            </div>
            <div className="space-y-2 p-4 sm:p-5">
              {[1, 2].map((s) => (
                <div key={s} className="flex items-start gap-3 rounded-lg px-3 py-2.5">
                  <Skeleton className="h-5 w-5 rounded-md" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-4 w-40" />
                    <Skeleton className="h-3 w-28" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function SharedTripClient({ token }: { token: string }) {
  const locale = useLocale();
  const tsh = useTranslations("shared");
  const tm = useTranslations("messages");
  const tlStatus = useTranslations("labels.status");
  const tlWeather = useTranslations("labels.weather");
  const queryClient = useQueryClient();
  const [hasUpdate, setHasUpdate] = useState(false);

  const {
    data: trip,
    isLoading,
    error: queryError,
  } = useQuery({
    queryKey: queryKeys.shared.trip(token),
    queryFn: () => api<SharedTripResponse>(`/api/shared/${token}`),
    enabled: true,
  });

  // Derive error message from query error
  const error =
    queryError instanceof ApiError && queryError.status === 404
      ? tm("sharedLinkInvalid")
      : queryError
        ? tm("sharedTripFetchFailed")
        : null;

  function handleRefresh() {
    setHasUpdate(false);
    queryClient.invalidateQueries({ queryKey: queryKeys.shared.trip(token) });
  }

  // Subscribe to broadcast updates via the channel derived from the share token.
  // Shared viewers use trip-shared:<hash> (not trip:${tripId}) to prevent
  // Presence pollution — they cannot see or pollute the members-only channel.
  // The key comes from the API, so the raw token never becomes a channel name.
  const shareChannelKey = trip?.shareChannelKey;
  useEffect(() => {
    if (!shareChannelKey) return;
    const channel = supabase
      .channel(sharedTripChannelName(shareChannelKey))
      .on("broadcast", { event: "trip:updated" }, () => {
        setHasUpdate(true);
      })
      .subscribe();
    return () => {
      channel.unsubscribe();
    };
  }, [shareChannelKey]);

  const dayCount = trip?.startDate && trip?.endDate ? getDayCount(trip.startDate, trip.endDate) : 0;

  return (
    <div className="min-h-screen">
      <SharedHeader />
      <LoadingBoundary isLoading={isLoading} skeleton={<SharedTripBodySkeleton />}>
        {error ? (
          <div className="container flex max-w-3xl flex-col items-center py-16 text-center">
            <Calendar className="mb-4 h-12 w-12 text-muted-foreground" />
            <p className="text-lg font-medium text-destructive">{error}</p>
            <p className="mt-2 text-sm text-muted-foreground">{tsh("checkLink")}</p>
          </div>
        ) : !trip ? (
          <div className="container flex max-w-3xl flex-col items-center py-16 text-center">
            <p className="text-lg font-medium text-destructive">{tm("sharedTripNotFound")}</p>
          </div>
        ) : (
          <>
            {hasUpdate && (
              <div className="sticky top-0 z-10 border-b bg-blue-50 px-4 py-2 text-center dark:bg-blue-950">
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1.5 text-blue-700 hover:text-blue-800 dark:text-blue-300 dark:hover:text-blue-200"
                  onClick={handleRefresh}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  {tsh("updateAvailable")}
                </Button>
              </div>
            )}
            <div className="container max-w-3xl py-8">
              {/* Hero */}
              <div className="mb-8 rounded-xl border bg-card px-6 py-6 shadow-sm">
                <Badge variant="outline" className={cn("mb-3 w-fit", STATUS_COLORS[trip.status])}>
                  {tlStatus(trip.status)}
                </Badge>
                <h1 className="break-words text-2xl font-bold sm:text-3xl">{trip.title}</h1>
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-muted-foreground">
                  {trip.destination && (
                    <span className="flex items-center gap-1.5">
                      <MapPin className="h-4 w-4 shrink-0" />
                      {trip.destination}
                    </span>
                  )}
                  <span className="flex items-center gap-1.5">
                    <Calendar className="h-4 w-4 shrink-0" />
                    {trip.startDate && trip.endDate ? (
                      <>
                        {formatDateRange(trip.startDate, trip.endDate, locale)}
                        <span className="text-xs">（{tsh("dayCount", { count: dayCount })}）</span>
                      </>
                    ) : (
                      <span className="text-muted-foreground">{tsh("noDate")}</span>
                    )}
                  </span>
                </div>
                {trip.shareExpiresAt && (
                  <p className="mt-3 text-xs text-muted-foreground">
                    {tsh("shareExpiry", {
                      date: formatDateFromISO(trip.shareExpiresAt, { locale }),
                    })}
                  </p>
                )}
              </div>
              <div className="space-y-6">
                {(trip.days ?? []).length === 0 && (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    {tsh("noScheduleYet")}
                  </p>
                )}
                {(trip.candidates ?? []).length > 0 && (
                  <SharedCandidatesSection candidates={trip.candidates} />
                )}
                {(trip.days ?? []).map((day) => {
                  return (
                    <section
                      key={day.id}
                      className="overflow-hidden rounded-xl border bg-card shadow-sm"
                    >
                      <div className="border-b bg-muted/40 px-4 py-3 sm:px-5">
                        <h3 className="flex items-center gap-2 text-sm font-semibold">
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-foreground text-[11px] font-bold text-background">
                            {day.dayNumber}
                          </span>
                          <span>{formatDate(day.date, { locale })}</span>
                          <span className="font-normal text-muted-foreground">
                            {(() => {
                              const d = new Date(day.date);
                              const dayKeys = [
                                "dayOfWeekSun",
                                "dayOfWeekMon",
                                "dayOfWeekTue",
                                "dayOfWeekWed",
                                "dayOfWeekThu",
                                "dayOfWeekFri",
                                "dayOfWeekSat",
                              ] as const;
                              return tsh(dayKeys[d.getDay()]);
                            })()}
                            {tsh("dayOfWeek")}
                          </span>
                          {day.weatherType != null &&
                            (() => {
                              const weatherType = day.weatherType as WeatherType;
                              const weatherTypeSecondary =
                                day.weatherTypeSecondary as WeatherType | null;
                              const PrimaryIcon = WEATHER_ICON[weatherType];
                              return (
                                <span className="ml-auto flex items-center gap-1 font-normal text-xs text-muted-foreground">
                                  <PrimaryIcon
                                    className={cn(
                                      "h-4 w-4 shrink-0",
                                      WEATHER_ICON_COLOR[weatherType],
                                    )}
                                  />
                                  <span>{tlWeather(weatherType)}</span>
                                  {weatherTypeSecondary != null &&
                                    (() => {
                                      const SecondaryIcon = WEATHER_ICON[weatherTypeSecondary];
                                      return (
                                        <>
                                          <span>→</span>
                                          <SecondaryIcon
                                            className={cn(
                                              "h-4 w-4 shrink-0",
                                              WEATHER_ICON_COLOR[weatherTypeSecondary],
                                            )}
                                          />
                                          <span>{tlWeather(weatherTypeSecondary)}</span>
                                        </>
                                      );
                                    })()}
                                  {(day.tempHigh != null || day.tempLow != null) && (
                                    <span>
                                      {day.tempHigh != null ? `${day.tempHigh}` : "-"}/
                                      {day.tempLow != null ? `${day.tempLow}` : "-"}°
                                    </span>
                                  )}
                                </span>
                              );
                            })()}
                        </h3>
                      </div>
                      <div className="p-4 sm:p-5">
                        {(day.patterns ?? []).map((pattern) => (
                          <PatternSection
                            key={pattern.id}
                            pattern={pattern}
                            dayDate={day.date}
                            showLabel={(day.patterns ?? []).length > 1}
                            crossDayEntries={getCrossDayEntries(
                              trip.days ?? [],
                              day.dayNumber,
                              pattern.sortOrder,
                            )}
                          />
                        ))}
                        {day.memo && (
                          <div className="mt-3 flex items-start gap-2 border-t pt-3 text-sm text-muted-foreground">
                            <StickyNote className="mt-0.5 h-4 w-4 shrink-0" />
                            <p className="whitespace-pre-line">{day.memo}</p>
                          </div>
                        )}
                      </div>
                    </section>
                  );
                })}
              </div>
            </div>
          </>
        )}
        <SharedFooter />
      </LoadingBoundary>
    </div>
  );
}

function PatternSection({
  pattern,
  dayDate,
  showLabel,
  crossDayEntries,
}: {
  pattern: DayPatternResponse;
  dayDate: string;
  showLabel: boolean;
  crossDayEntries?: CrossDayEntry[];
}) {
  const tm = useTranslations("messages");
  const schedules = pattern.schedules ?? [];
  const merged = buildMergedTimeline(schedules, crossDayEntries);

  return (
    <div className={showLabel ? "mt-4 border-t pt-3" : ""}>
      {showLabel && (
        <p className="mb-2 text-sm font-medium text-muted-foreground">{pattern.label}</p>
      )}
      {merged.length === 0 ? (
        <p className="py-2 text-center text-sm text-muted-foreground">{tm("emptySchedule")}</p>
      ) : (
        <div className="relative space-y-1">
          {/* Vertical timeline line */}
          {merged.length > 1 && (
            <div className="absolute left-[11px] top-4 bottom-4 w-px bg-border" aria-hidden />
          )}
          {merged.map((item) =>
            item.type === "crossDay" ? (
              <ScheduleCard
                key={`cross-${item.entry.schedule.id}`}
                schedule={item.entry.schedule}
                dayDate={dayDate}
                crossDayDisplay
                crossDayPosition={item.entry.crossDayPosition}
              />
            ) : (
              <ScheduleCard key={item.schedule.id} schedule={item.schedule} dayDate={dayDate} />
            ),
          )}
        </div>
      )}
    </div>
  );
}

function SharedCandidatesSection({ candidates }: { candidates: ScheduleResponse[] }) {
  const tsh = useTranslations("shared");
  const tlCat = useTranslations("labels.category");
  const tlTransport = useTranslations("labels.transportMethod");

  return (
    <section className="overflow-hidden rounded-xl border bg-card shadow-sm">
      <div className="border-b bg-muted/40 px-4 py-3 sm:px-5">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Lightbulb className="h-4 w-4 text-amber-500" />
          <span>{tsh("candidates")}</span>
          <span className="text-xs font-normal text-muted-foreground">
            {tsh("candidateCount", { count: candidates.length })}
          </span>
        </h3>
      </div>
      <div className="space-y-1 p-4 sm:p-5">
        {candidates.map((spot) => {
          const colorClasses = SCHEDULE_COLOR_CLASSES[spot.color ?? "blue"];
          const CategoryIcon = CATEGORY_ICONS[spot.category];
          const timeStr = formatTimeRange(spot.startTime, spot.endTime);
          const transportLabel = spot.transportMethod
            ? tlTransport(spot.transportMethod as TransportMethod)
            : null;
          const safeUrls = spot.urls.filter(isSafeUrl);
          const routeStr =
            spot.departurePlace && spot.arrivalPlace
              ? `${spot.departurePlace} → ${spot.arrivalPlace}`
              : spot.departurePlace || spot.arrivalPlace || "";

          return (
            <div
              key={spot.id}
              className="flex items-start gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-muted/30"
            >
              <div
                className={cn(
                  "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-white",
                  colorClasses.bg,
                )}
              >
                <CategoryIcon className="h-3 w-3" />
              </div>
              <div className="min-w-0 flex-1 space-y-1">
                <p className="flex items-baseline gap-1.5 text-sm">
                  <span className="break-words font-medium">{spot.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {tlCat(spot.category)}
                  </span>
                </p>
                {timeStr && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3 shrink-0 text-muted-foreground/70" />
                    <span>{timeStr}</span>
                  </div>
                )}
                {spot.address && (
                  <a
                    href={buildMapsSearchUrl(spot.address)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex w-fit max-w-full items-center gap-1.5 text-xs text-blue-600 hover:underline dark:text-blue-400"
                  >
                    <MapPin className="h-3 w-3 shrink-0 text-muted-foreground/70" />
                    <span className="truncate">{spot.address}</span>
                  </a>
                )}
                {spot.category === "transport" && routeStr && (
                  <span className="flex w-fit max-w-full items-center gap-1.5 text-xs text-muted-foreground">
                    <Route className="h-3 w-3 shrink-0 text-muted-foreground/70" />
                    <span className="truncate">{routeStr}</span>
                    {transportLabel && <span className="shrink-0">({transportLabel})</span>}
                  </span>
                )}
                {safeUrls.map((u) => (
                  <a
                    key={u}
                    href={u}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex w-fit max-w-full items-center gap-1.5 text-xs text-blue-600 hover:underline dark:text-blue-400"
                  >
                    <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground/70" />
                    <span className="truncate">{stripProtocol(u)}</span>
                  </a>
                ))}
                {spot.memo && (
                  <div className="flex items-start gap-1.5 text-xs text-muted-foreground/70">
                    <StickyNote className="mt-0.5 h-3 w-3 shrink-0" />
                    <p className="whitespace-pre-line">{spot.memo}</p>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** Compact read-only schedule row for the public shared view. */
function ScheduleCard({
  schedule,
  dayDate,
  crossDayDisplay,
  crossDayPosition,
}: {
  schedule: ScheduleResponse;
  dayDate: string;
  crossDayDisplay?: boolean;
  crossDayPosition?: "intermediate" | "final";
}) {
  const tlTransport = useTranslations("labels.transportMethod");
  const CategoryIcon = CATEGORY_ICONS[schedule.category];
  const colorClasses = SCHEDULE_COLOR_CLASSES[schedule.color ?? "blue"];
  const transportLabel = schedule.transportMethod
    ? tlTransport(schedule.transportMethod as TransportMethod)
    : null;

  const displayTime = crossDayDisplay ? schedule.endTime : schedule.startTime;
  const showEndTime = !crossDayDisplay && !schedule.endDayOffset && schedule.endTime;

  const tc = useTranslations("crossDay");
  const crossDayT = {
    hotelCheckin: tc("hotelCheckin"),
    hotelStaying: tc("hotelStaying"),
    hotelCheckout: tc("hotelCheckout"),
    genericStart: tc("genericStart"),
    genericContinuing: tc("genericContinuing"),
    genericEnd: tc("genericEnd"),
  };
  const roleLabel =
    crossDayDisplay && crossDayPosition
      ? getCrossDayLabel(schedule.category, crossDayPosition, crossDayT)
      : !crossDayDisplay && schedule.endDayOffset
        ? getStartDayLabel(schedule.category, crossDayT)
        : null;

  const safeUrls = schedule.urls.filter(isSafeUrl);

  const routeStr = crossDayDisplay
    ? schedule.arrivalPlace || ""
    : schedule.departurePlace && schedule.arrivalPlace
      ? `${schedule.departurePlace} → ${schedule.arrivalPlace}`
      : schedule.departurePlace || schedule.arrivalPlace || "";

  const transitUrl =
    schedule.departurePlace && schedule.arrivalPlace
      ? buildTransportUrl({
          from: schedule.departurePlace,
          to: schedule.arrivalPlace,
          method: schedule.transportMethod,
          date: dayDate,
          time: schedule.startTime,
        })
      : null;

  const hasDetails =
    (schedule.category === "transport" && (routeStr || transportLabel)) ||
    schedule.address ||
    safeUrls.length > 0 ||
    schedule.memo;

  return (
    <div
      className={cn(
        "relative flex items-start gap-3 rounded-lg px-3 py-2.5 transition-colors",
        crossDayDisplay ? "bg-muted/40" : "hover:bg-muted/30",
      )}
    >
      {/* Dot marker — aligns with the vertical line in PatternSection */}
      <div
        className={cn(
          "relative z-10 mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-white",
          colorClasses.bg,
        )}
      >
        <CategoryIcon className="h-3 w-3" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="w-[5.5rem] shrink-0 text-xs tabular-nums text-muted-foreground">
            {displayTime && (
              <>
                {crossDayDisplay ? "~ " : ""}
                {displayTime.slice(0, 5)}
                {showEndTime && ` - ${schedule.endTime?.slice(0, 5)}`}
                {!crossDayDisplay && schedule.endDayOffset ? " ~" : ""}
              </>
            )}
          </span>
          <span className="break-words text-sm font-medium">{schedule.name}</span>
          {roleLabel && (
            <span className="rounded-sm bg-muted px-1 py-0.5 text-xs text-muted-foreground">
              {roleLabel}
            </span>
          )}
        </div>

        {hasDetails && (
          <div className="mt-1 space-y-1 pl-24 text-xs text-muted-foreground">
            {schedule.category === "transport" && routeStr && (
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Route className="h-3 w-3 shrink-0 text-muted-foreground/70" />
                {transitUrl ? (
                  <a
                    href={transitUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:underline dark:text-blue-400"
                  >
                    {crossDayDisplay && schedule.arrivalPlace ? `→ ${routeStr}` : routeStr}
                  </a>
                ) : (
                  <span>
                    {crossDayDisplay && schedule.arrivalPlace ? `→ ${routeStr}` : routeStr}
                  </span>
                )}
                {transportLabel && <span className="shrink-0">({transportLabel})</span>}
              </span>
            )}
            {schedule.address && (
              <a
                href={buildMapsSearchUrl(schedule.address)}
                target="_blank"
                rel="noopener noreferrer"
                className="flex w-fit max-w-full items-center gap-1.5 text-blue-600 hover:underline dark:text-blue-400"
              >
                <MapPin className="h-3 w-3 shrink-0 text-muted-foreground/70" />
                <span className="truncate">{schedule.address}</span>
              </a>
            )}
            {safeUrls.map((u) => (
              <a
                key={u}
                href={u}
                target="_blank"
                rel="noopener noreferrer"
                className="flex w-fit max-w-full items-center gap-1.5 text-blue-600 hover:underline dark:text-blue-400"
              >
                <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground/70" />
                <span className="truncate">{stripProtocol(u)}</span>
              </a>
            ))}
            {schedule.memo && (
              <div className="flex items-start gap-1.5">
                <StickyNote className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground/70" />
                <p className="whitespace-pre-line">{schedule.memo}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
