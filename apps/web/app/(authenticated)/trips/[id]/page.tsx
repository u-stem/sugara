"use client";

import { type Announcements, DndContext, DragOverlay, defaultDropAnimation } from "@dnd-kit/core";
import type {
  BookmarkListResponse,
  CurrencyCode,
  PollDetailResponse,
  TripResponse,
} from "@sugara/shared";
import {
  canEdit as canEditRole,
  isOwner as isOwnerRole,
  MAX_SCHEDULES_PER_TRIP,
} from "@sugara/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { APIProvider } from "@vis.gl/react-google-maps";
import dynamic from "next/dynamic";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useHotkeys } from "react-hotkeys-hook";
import { toast } from "sonner";
import { ActivityLog } from "@/components/activity-log";
import { BookmarkListPickerDialog } from "@/components/bookmark-list-picker-dialog";
import { CandidatePanel } from "@/components/candidate-panel";
import { DayTimeline } from "@/components/day-timeline";
import { Fab } from "@/components/fab";
import { ReactionOverlay } from "@/components/reaction-overlay";
import { SpSwipeTabs } from "@/components/sp-swipe-tabs";

const EditTripDialog = dynamic(() =>
  import("@/components/edit-trip-dialog").then((mod) => mod.EditTripDialog),
);

import { DayWeatherEditor } from "@/components/day-weather-editor";
import { ScrollToTop } from "@/components/scroll-to-top";
import type { ShortcutGroup } from "@/components/shortcut-help-dialog";
import { LoadingBoundary } from "@/components/ui/loading-boundary";
import { Skeleton } from "@/components/ui/skeleton";
import { api, getApiErrorMessage } from "@/lib/api";
import { useSession } from "@/lib/auth-client";
import { SCHEDULE_COLOR_CLASSES } from "@/lib/colors";
import { pageTitle } from "@/lib/constants";
import { getCrossDayEntries } from "@/lib/cross-day";
import { isGuestUser } from "@/lib/guest";
import { SelectionProvider } from "@/lib/hooks/selection-context";
import { useAuthRedirect } from "@/lib/hooks/use-auth-redirect";
import { useDayMemo } from "@/lib/hooks/use-day-memo";
import { useDayWeather } from "@/lib/hooks/use-day-weather";
import { useIsLg } from "@/lib/hooks/use-is-lg";
import { useOnlineStatus } from "@/lib/hooks/use-online-status";
import { usePatternOperations } from "@/lib/hooks/use-pattern-operations";
import { buildReactionUser, useReaction } from "@/lib/hooks/use-reaction";
import { useScheduleSelection } from "@/lib/hooks/use-schedule-selection";
import { useTripDragAndDrop } from "@/lib/hooks/use-trip-drag-and-drop";
import { useTripMutationCallbacks } from "@/lib/hooks/use-trip-mutation-callbacks";
import { useTripSync } from "@/lib/hooks/use-trip-sync";
import { isDialogOpen } from "@/lib/hotkeys";
import { CATEGORY_ICONS } from "@/lib/icons";
import { QUERY_CONFIG } from "@/lib/query-config";
import { queryKeys } from "@/lib/query-keys";
import { useRegisterShortcuts, useShortcutHelp } from "@/lib/shortcut-help-context";
import { cn } from "@/lib/utils";
import { BookmarkTab } from "./_components/bookmark-tab";
import { DayMemoEditor } from "./_components/day-memo-editor";
import { DayTabs } from "./_components/day-tabs";
import { ExpenseTab } from "./_components/expense-tab";
import { MapPanel } from "./_components/map-panel";
import { PatternTabs } from "./_components/pattern-tabs";
import { PollTab } from "./_components/poll-tab";
import { RightPanel, type RightPanelTab } from "./_components/right-panel";
import { SouvenirTab } from "./_components/souvenir-tab";
import {
  AddPatternDialog,
  BatchDeleteDialog,
  DeletePatternDialog,
  OverwritePatternDialog,
  RenamePatternDialog,
} from "./_components/trip-dialogs";
import { TripHeader } from "./_components/trip-header";

function useDndAnnouncements(): Announcements {
  const tsch = useTranslations("schedule");
  return useMemo(
    () => ({
      onDragStart({ active }) {
        return tsch("dndPickUp", { id: String(active.id) });
      },
      onDragOver({ active, over }) {
        if (over) return tsch("dndMoveOver", { id: String(active.id), over: String(over.id) });
        return tsch("dndDropped", { id: String(active.id) });
      },
      onDragEnd({ active, over }) {
        if (over) return tsch("dndMovedTo", { id: String(active.id), over: String(over.id) });
        return tsch("dndDropped", { id: String(active.id) });
      },
      onDragCancel({ active }) {
        return tsch("dndCancelled", { id: String(active.id) });
      },
    }),
    [tsch],
  );
}

function TripDetailSkeleton() {
  return (
    <div className="mt-4">
      {/* Mobile skeleton */}
      <div className="lg:hidden">
        <div className="flex h-11 items-center gap-2">
          <Skeleton className="h-5 w-36" />
          <Skeleton className="ml-auto h-8 w-8 rounded-md" />
        </div>
        <div className="flex shrink-0">
          {(["w-12", "w-16", "w-12"] as const).map((w, i) => (
            <div key={w + String(i)} className="flex flex-1 items-center justify-center py-2.5">
              <Skeleton className={`h-4 ${w}`} />
            </div>
          ))}
        </div>
        <div className="rounded-lg border bg-card">
          <div className="flex gap-1.5 px-3 pt-3">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-[44px] w-14 rounded-full" />
            ))}
          </div>
          <div className="p-4">
            <Skeleton className="mb-3 h-9 w-full rounded-md" />
            <div className="mb-2 flex items-center gap-1.5">
              <Skeleton className="h-8 flex-1 rounded-md" />
              <Skeleton className="h-8 flex-1 rounded-md" />
              <Skeleton className="h-8 flex-1 rounded-md" />
            </div>
            <div className="mb-2 flex items-center gap-1.5">
              <Skeleton className="h-7 w-24 rounded-full" />
              <Skeleton className="h-7 w-7 rounded-md" />
              <Skeleton className="h-7 w-7 rounded-md" />
            </div>
            <div className="space-y-1.5">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex gap-3 py-1.5">
                  <Skeleton className="h-7 w-7 shrink-0 rounded-full" />
                  <Skeleton className="h-20 flex-1 rounded-md" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Desktop skeleton */}
      <div className="hidden lg:block">
        <div className="mb-6">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="mt-2 h-4 w-64" />
          <div className="mt-3 flex items-center gap-2">
            <Skeleton className="h-8 w-20 rounded-md" />
            <Skeleton className="h-8 w-20 rounded-md" />
          </div>
        </div>
        <div className="flex gap-4">
          <div className="flex min-w-0 max-h-[calc(100vh-12rem)] flex-[3] flex-col rounded-lg border bg-card">
            <div className="flex shrink-0 gap-1.5 px-3 pt-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-7 w-14 rounded-full" />
              ))}
            </div>
            <div className="p-4">
              <Skeleton className="mb-3 h-9 w-full rounded-md" />
              <div className="mb-2 flex items-center gap-1.5">
                <Skeleton className="h-4 w-20" />
                <div className="ml-auto flex items-center gap-1.5">
                  <Skeleton className="h-8 w-24 rounded-md" />
                  <Skeleton className="h-8 w-16 rounded-md" />
                  <Skeleton className="h-8 w-16 rounded-md" />
                </div>
              </div>
              <div className="mb-2 flex items-center gap-1.5">
                <Skeleton className="h-7 w-24 rounded-full" />
                <Skeleton className="h-7 w-7 rounded-md" />
                <Skeleton className="h-7 w-7 rounded-md" />
              </div>
              <div className="space-y-1.5">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="flex gap-3 py-1.5">
                    <Skeleton className="h-7 w-7 shrink-0 rounded-full" />
                    <Skeleton className="h-24 flex-1 rounded-md" />
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="flex-[2] self-start sticky top-4 rounded-lg border border-dashed bg-card p-4">
            <div className="mb-3 flex items-center justify-between">
              <Skeleton className="h-5 w-20" />
              <Skeleton className="h-8 w-20 rounded-md" />
            </div>
            <div className="space-y-2">
              {[1, 2].map((i) => (
                <div key={i} className="flex items-center gap-2 py-1">
                  <Skeleton className="h-2.5 w-2.5 shrink-0 rounded-full" />
                  <div className="flex-1 space-y-1">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-3 w-16" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

type MobileContentTab =
  | "schedule"
  | "candidates"
  | "expenses"
  | "bookmarks"
  | "activity"
  | "souvenirs"
  | "map";

// Labels assigned dynamically via useTranslations in TripDetailPage
const MOBILE_SWIPE_TAB_IDS = ["schedule", "candidates", "expenses", "souvenirs"] as const;

export default function TripDetailPage() {
  const tm = useTranslations("messages");
  const tsch = useTranslations("schedule");
  const te = useTranslations("expense");
  const ts = useTranslations("souvenir");
  const tp = useTranslations("poll");
  const tsc = useTranslations("shortcuts");
  const dndAnnouncements = useDndAnnouncements();
  const params = useParams();
  const tripId = params.id as string;
  const online = useOnlineStatus();
  const isLg = useIsLg();
  const { data: session } = useSession();
  const queryClient = useQueryClient();

  const {
    data: trip,
    isLoading,
    error: queryError,
  } = useQuery({
    queryKey: queryKeys.trips.detail(tripId),
    queryFn: () => api<TripResponse>(`/api/trips/${tripId}`),
  });
  useAuthRedirect(queryError);
  const pollId = trip?.poll?.id;
  const { isLoading: isPollLoading, data: pollData } = useQuery({
    queryKey: queryKeys.polls.detail(pollId ?? ""),
    queryFn: () => api<PollDetailResponse>(`/api/polls/${pollId}`),
    enabled: !!pollId,
  });

  // Prefetch bookmark lists so BookmarkPanel renders instantly on tab switch
  useQuery({
    queryKey: queryKeys.bookmarks.lists(),
    queryFn: () => api<BookmarkListResponse[]>("/api/bookmark-lists"),
    ...QUERY_CONFIG.stable,
  });

  const [editOpen, setEditOpen] = useState(false);
  const [addScheduleOpen, setAddScheduleOpen] = useState(false);
  const [addCandidateOpen, setAddCandidateOpen] = useState(false);
  const [addExpenseOpen, setAddExpenseOpen] = useState(false);
  const [addSouvenirOpen, setAddSouvenirOpen] = useState(false);
  const [addPollOptionOpen, setAddPollOptionOpen] = useState(false);
  const [selectedDay, setSelectedDay] = useState(0);
  const [selectedPattern, setSelectedPattern] = useState<Record<string, number>>({});
  const [mobileTab, setMobileTab] = useState<MobileContentTab>("schedule");
  // Ref mirrors mobileTab so swipe/tab-change handlers always see the latest
  // value without re-registration on every tab change.
  const mobileTabRef = useRef<MobileContentTab>("schedule");
  const prevDayRef = useRef(0);
  const gPressedRef = useRef(false);
  const [rightPanelTab, setRightPanelTab] = useState<RightPanelTab>("candidates");
  const [saveToBookmarkIds, setSaveToBookmarkIds] = useState<string[]>([]);
  const [bookmarkPickerOpen, setBookmarkPickerOpen] = useState(false);
  const timelinePanelRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const currentDay = trip?.days[selectedDay] ?? null;
  const currentPatternIndex = currentDay ? (selectedPattern[currentDay.id] ?? 0) : 0;
  const currentPattern = currentDay?.patterns[currentPatternIndex] ?? null;

  // Keyboard shortcuts
  // Computed early (before early returns) for use in shortcut help display and enabled flags.
  // Handlers use canEditRef.current instead to avoid re-registration on every trip change.
  const canEditEarly = trip ? canEditRole(trip.role) : false;
  const isGuestEarly = isGuestUser(session);

  const { open: openShortcutHelp } = useShortcutHelp();
  const tripShortcuts: ShortcutGroup[] = useMemo(
    () => [
      {
        group: tsc("navigation"),
        items: [
          { key: "1-9", description: tsc("switchToDay") },
          { key: "[", description: tsc("prevDay") },
          { key: "]", description: tsc("nextDay") },
          ...(trip?.poll ? [{ key: "p", description: tsc("pollTab") }] : []),
        ],
      },
      {
        group: tsc("pattern"),
        items: [
          { key: "{", description: tsc("prevPattern") },
          { key: "}", description: tsc("nextPattern") },
        ],
      },
      ...(canEditEarly
        ? [
            {
              group: tsc("actions"),
              items: [
                { key: "a", description: tsc("addSchedule") },
                { key: "c", description: tsc("addCandidate") },
                { key: "s", description: tsc("addSouvenir") },
                { key: "e", description: tsc("editTrip") },
              ],
            },
          ]
        : []),
      ...(isLg
        ? [
            {
              group: tsc("panel"),
              items: [
                { key: "g c", description: tsc("candidates") },
                { key: "g x", description: tsc("expenses") },
                { key: "g s", description: tsc("souvenirs") },
                { key: "g l", description: tsc("activityLog") },
                ...(!isGuestEarly ? [{ key: "g b", description: tsc("bookmarks") }] : []),
                ...(trip?.mapsEnabled ? [{ key: "g m", description: tsc("map") }] : []),
              ],
            },
          ]
        : []),
    ],
    [trip?.poll, trip?.mapsEnabled, isLg, canEditEarly, isGuestEarly, tsc],
  );
  useRegisterShortcuts(tripShortcuts);
  useHotkeys("?", () => openShortcutHelp(), { useKey: true, preventDefault: true });
  useHotkeys("1,2,3,4,5,6,7,8,9", (e) => {
    if (isDialogOpen()) return;
    const dayIndex = Number(e.key) - 1;
    if (trip && dayIndex < trip.days.length) {
      setSelectedDay(dayIndex);
    }
  });
  useHotkeys(
    "[",
    () => {
      if (isDialogOpen()) return;
      setSelectedDay((prev) => Math.max(0, prev - 1));
    },
    { useKey: true },
  );
  useHotkeys(
    "]",
    () => {
      if (isDialogOpen()) return;
      if (trip) {
        setSelectedDay((prev) => Math.min(trip.days.length - 1, prev + 1));
      }
    },
    { useKey: true },
  );
  useHotkeys(
    "{",
    () => {
      if (isDialogOpen()) return;
      if (!currentDay) return;
      const dayId = currentDay.id;
      setSelectedPattern((prev) => ({
        ...prev,
        [dayId]: Math.max(0, (prev[dayId] ?? 0) - 1),
      }));
    },
    { useKey: true },
  );
  useHotkeys(
    "}",
    () => {
      if (isDialogOpen()) return;
      if (!currentDay) return;
      const dayId = currentDay.id;
      const maxIndex = currentDay.patterns.length - 1;
      setSelectedPattern((prev) => ({
        ...prev,
        [dayId]: Math.min(maxIndex, (prev[dayId] ?? 0) + 1),
      }));
    },
    { useKey: true },
  );
  useHotkeys(
    "p",
    () => {
      if (isDialogOpen()) return;
      if (!trip?.poll) return;
      if (selectedDay === -1) {
        setSelectedDay(prevDayRef.current);
      } else {
        prevDayRef.current = selectedDay;
        setSelectedDay(-1);
      }
    },
    { preventDefault: true },
  );
  // Track "g" press to prevent sequence suffixes (c, h, etc.) from firing standalone handlers
  useHotkeys("g", () => {
    gPressedRef.current = true;
    setTimeout(() => {
      gPressedRef.current = false;
    }, 1000);
  });
  useHotkeys(
    "g>c",
    () => {
      if (!isDialogOpen()) setRightPanelTab("candidates");
    },
    { enabled: isLg },
  );
  useHotkeys(
    "g>x",
    () => {
      if (!isDialogOpen()) setRightPanelTab("expenses");
    },
    { enabled: isLg },
  );
  useHotkeys(
    "g>l",
    () => {
      if (!isDialogOpen()) setRightPanelTab("activity");
    },
    { enabled: isLg },
  );
  useHotkeys(
    "g>s",
    () => {
      if (!isDialogOpen()) setRightPanelTab("souvenirs");
    },
    { enabled: isLg },
  );
  useHotkeys(
    "g>b",
    () => {
      if (!isDialogOpen()) setRightPanelTab("bookmarks");
    },
    { enabled: isLg && !isGuestEarly },
  );
  useHotkeys(
    "g>m",
    () => {
      if (!isDialogOpen()) setRightPanelTab("map");
    },
    { enabled: isLg && !!trip?.mapsEnabled },
  );
  useHotkeys(
    "a",
    () => {
      if (isDialogOpen()) return;
      if (canEditRef.current && online) setAddScheduleOpen(true);
    },
    { preventDefault: true },
  );
  useHotkeys(
    "c",
    () => {
      if (gPressedRef.current) return;
      if (isDialogOpen()) return;
      if (canEditRef.current && online) setAddCandidateOpen(true);
    },
    { preventDefault: true },
  );
  useHotkeys(
    "s",
    () => {
      if (gPressedRef.current) return;
      if (isDialogOpen()) return;
      if (canEditRef.current && online) {
        if (isLg) setRightPanelTab("souvenirs");
        setAddSouvenirOpen(true);
      }
    },
    { preventDefault: true },
  );
  useHotkeys(
    "e",
    () => {
      if (isDialogOpen()) return;
      if (canEditRef.current) setEditOpen(true);
    },
    { preventDefault: true },
  );

  // Stable ref for canEdit to avoid re-registering hotkeys on every trip change
  const canEditRef = useRef(false);

  const invalidateTrip = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.trips.detail(tripId) });
    if (pollId) {
      await queryClient.invalidateQueries({ queryKey: queryKeys.polls.detail(pollId) });
    }
  }, [queryClient, tripId, pollId]);

  const syncUser = useMemo(
    () =>
      session?.user
        ? { id: session.user.id, name: session.user.name, image: session.user.image }
        : null,
    [session?.user?.id, session?.user?.name, session?.user?.image],
  );
  const { presence, isConnected, updatePresence, broadcastChange, channel } = useTripSync(
    tripId,
    syncUser,
    invalidateTrip,
    trip?.shareToken,
  );

  const reactionUser = useMemo(
    () => (session?.user ? buildReactionUser(session) : null),
    [session?.user?.id, session?.user?.name, session?.user?.image],
  );
  const { reactions, sendReaction, removeReaction, cooldown } = useReaction(channel, reactionUser);

  // Mutation callbacks: refetch + broadcast to other clients (see hook for
  // why schedule adds and reorders skip the refetch, #123 / #166)
  const {
    onMutate,
    onCacheWritten,
    onSchedulesReordered,
    onCandidatesReordered,
    onCandidateAssigned,
    onScheduleUnassigned,
  } = useTripMutationCallbacks({
    tripId,
    invalidateTrip,
    broadcastChange,
  });

  const handleSaveToBookmark = useCallback((scheduleIds: string[]) => {
    setSaveToBookmarkIds(scheduleIds);
    setBookmarkPickerOpen(true);
  }, []);

  const handleBookmarkListSelected = useCallback(
    async (listId: string) => {
      try {
        await api(`/api/bookmark-lists/${listId}/bookmarks/from-schedules`, {
          method: "POST",
          body: JSON.stringify({ tripId, scheduleIds: saveToBookmarkIds }),
        });
        toast.success(tm("scheduleSavedToBookmarks", { count: saveToBookmarkIds.length }));
        queryClient.invalidateQueries({ queryKey: queryKeys.bookmarks.all });
      } catch (err) {
        toast.error(getApiErrorMessage(err, tm("scheduleSaveToBookmarksFailed")));
      }
    },
    [tripId, saveToBookmarkIds, queryClient],
  );

  const handleMobileTabChange = useCallback((tab: MobileContentTab) => {
    mobileTabRef.current = tab;
    setMobileTab(tab);
  }, []);

  useEffect(() => {
    if (trip) {
      document.title = pageTitle(trip.title);
    }
  }, [trip?.title]);

  // Exclude self from presence display
  const otherPresence = useMemo(
    () => (session?.user ? presence.filter((u) => u.userId !== session.user.id) : presence),
    [presence, session?.user],
  );

  useEffect(() => {
    if (currentDay) {
      updatePresence(currentDay.id, currentPattern?.id ?? null);
    } else if (selectedDay === -1) {
      updatePresence("poll", null);
    }
  }, [currentDay?.id, currentPattern?.id, selectedDay, updatePresence]);

  // Show poll tab by default for scheduling trips
  useEffect(() => {
    if (trip?.status === "scheduling" && trip.poll) {
      setSelectedDay(-1);
    }
  }, [trip?.status, trip?.poll?.id]);

  // Stable references to avoid infinite re-render when values are null
  const dndSchedules = useMemo(() => currentPattern?.schedules ?? [], [currentPattern?.schedules]);
  const dndCandidates = useMemo(() => trip?.candidates ?? [], [trip?.candidates]);
  const dndCrossDayEntries = useMemo(
    () =>
      currentDay && trip
        ? getCrossDayEntries(trip.days, currentDay.dayNumber, currentPattern?.sortOrder)
        : undefined,
    [currentDay?.dayNumber, trip?.days, currentPattern?.sortOrder],
  );

  const allSchedules = useMemo(
    () =>
      trip?.days.flatMap((day, dayIndex) =>
        day.patterns.flatMap((p) => p.schedules.map((s) => ({ ...s, dayIndex }))),
      ) ?? [],
    [trip?.days],
  );

  const dnd = useTripDragAndDrop({
    tripId,
    currentDayId: currentDay?.id ?? null,
    currentPatternId: currentPattern?.id ?? null,
    schedules: dndSchedules,
    candidates: dndCandidates,
    crossDayEntries: dndCrossDayEntries,
    onDone: onMutate,
    onSchedulesReordered,
    onCandidatesReordered,
    onCandidateAssigned,
    onScheduleUnassigned,
  });

  const patternOps = usePatternOperations({
    tripId,
    currentDayId: currentDay?.id ?? null,
    onDone: onMutate,
    onPatternDeleted: (dayId) => setSelectedPattern((prev) => ({ ...prev, [dayId]: 0 })),
  });

  const memo = useDayMemo({
    tripId,
    currentDayId: currentDay?.id ?? null,
    onDone: onMutate,
  });

  const weather = useDayWeather({
    tripId,
    currentDayId: currentDay?.id ?? null,
    onDone: onMutate,
  });

  const timelineScheduleIds = useMemo(
    () => new Set(currentPattern?.schedules.map((s) => s.id) ?? []),
    [currentPattern?.schedules],
  );

  const candidateIds = useMemo(
    () => new Set(dnd.localCandidates.map((c) => c.id)),
    [dnd.localCandidates],
  );

  const selection = useScheduleSelection({
    tripId,
    currentDayId: currentDay?.id ?? null,
    currentPatternId: currentPattern?.id ?? null,
    timelineScheduleIds,
    candidateIds,
    onDone: onMutate,
  });

  // Only re-run on navigation changes, not when selection ref changes
  useEffect(() => {
    selection.exit();
  }, [selectedDay, mobileTab, rightPanelTab]);

  const canEdit = trip ? canEditRole(trip.role) : false;
  canEditRef.current = canEdit;
  const isGuest = isGuestUser(session);

  const scheduleLimitReached = (trip?.scheduleCount ?? 0) >= MAX_SCHEDULES_PER_TRIP;
  const scheduleLimitMessage = tm("limitSchedules", { max: MAX_SCHEDULES_PER_TRIP });
  const selectionCanEnter = canEdit && online;
  const selectionValue = useMemo(
    () => ({ ...selection, canEnter: selectionCanEnter }),
    [selection, selectionCanEnter],
  );

  const mobileSwipeTabs = MOBILE_SWIPE_TAB_IDS.map((id) => ({
    id,
    label: tsch(id),
  }));
  const mobileTripTabs = mobileSwipeTabs.map((t) =>
    t.id === "candidates" ? { ...t, badge: dnd.localCandidates.length } : t,
  );
  const isSwipableTab = MOBILE_SWIPE_TAB_IDS.some((id) => id === mobileTab);

  // Capture narrowed trip for use in renderTabContent closure
  const tripData = trip;

  function renderTabContent(tabId: MobileContentTab) {
    if (!tripData) return null;
    switch (tabId) {
      case "schedule":
        return (
          <div className="flex min-w-0 flex-col rounded-lg border bg-card">
            <DayTabs
              days={tripData.days}
              selectedDay={selectedDay}
              onSelectDay={setSelectedDay}
              otherPresence={otherPresence}
              hasPoll={!!tripData.poll}
            />
            {selectedDay === -1 && tripData.poll ? (
              <div>
                <PollTab
                  pollId={tripData.poll.id}
                  isOwner={isOwnerRole(tripData.role)}
                  canEdit={canEdit}
                  onMutate={onMutate}
                  onConfirmed={() => setSelectedDay(0)}
                  addOptionOpen={addPollOptionOpen}
                  onAddOptionOpenChange={setAddPollOptionOpen}
                />
              </div>
            ) : currentDay && currentPattern ? (
              <div id={`mobile-day-panel-${currentDay.id}`} role="tabpanel" className="p-4">
                <DayWeatherEditor
                  weatherHook={weather}
                  currentDayId={currentDay.id}
                  currentWeatherType={currentDay.weatherType}
                  currentWeatherTypeSecondary={currentDay.weatherTypeSecondary}
                  currentTempHigh={currentDay.tempHigh}
                  currentTempLow={currentDay.tempLow}
                  canEdit={canEdit}
                  online={online}
                />
                <DayMemoEditor
                  memo={memo}
                  currentDayId={currentDay.id}
                  currentDayMemo={currentDay.memo}
                  canEdit={canEdit}
                  online={online}
                />
                <DayTimeline
                  key={currentPattern.id}
                  tripId={tripId}
                  dayId={currentDay.id}
                  patternId={currentPattern.id}
                  date={currentDay.date}
                  schedules={dnd.localSchedules}
                  onRefresh={onMutate}
                  onScheduleAdded={onCacheWritten}
                  disabled={!online || !canEdit}
                  addScheduleOpen={!isLg ? addScheduleOpen : false}
                  onAddScheduleOpenChange={!isLg ? setAddScheduleOpen : undefined}
                  maxEndDayOffset={Math.max(1, tripData.days.length - 1 - selectedDay)}
                  totalDays={tripData.days.length}
                  crossDayEntries={dndCrossDayEntries}
                  overScheduleId={dnd.activeDragItem ? dnd.overScheduleId : null}
                  overUpperHalf={dnd.overUpperHalf}
                  scheduleLimitReached={scheduleLimitReached}
                  scheduleLimitMessage={scheduleLimitMessage}
                  onSaveToBookmark={canEdit && online ? handleSaveToBookmark : undefined}
                  onReorderSchedule={dnd.reorderSchedule}
                  mapsEnabled={tripData.mapsEnabled}
                  currency={tripData.currency}
                  headerContent={
                    <PatternTabs
                      patterns={currentDay.patterns}
                      currentDayId={currentDay.id}
                      currentPatternIndex={currentPatternIndex}
                      canEdit={canEdit}
                      online={online}
                      patternOps={patternOps}
                      onSelectPattern={(dayId, index) =>
                        setSelectedPattern((prev) => ({ ...prev, [dayId]: index }))
                      }
                    />
                  }
                />
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <p className="text-lg font-medium">{tm("schedulingStatusTitle")}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {tm("schedulingStatusDescription")}
                </p>
              </div>
            )}
          </div>
        );
      case "candidates":
        return currentDay && currentPattern ? (
          <div className="rounded-lg border bg-card p-4">
            <CandidatePanel
              tripId={tripId}
              candidates={dnd.localCandidates}
              currentDayId={currentDay.id}
              currentPatternId={currentPattern.id}
              onRefresh={onMutate}
              onCacheWritten={onCacheWritten}
              disabled={!online || !canEdit}
              draggable={false}
              addDialogOpen={!isLg ? addCandidateOpen : false}
              onAddDialogOpenChange={!isLg ? setAddCandidateOpen : undefined}
              scheduleLimitReached={scheduleLimitReached}
              scheduleLimitMessage={scheduleLimitMessage}
              maxEndDayOffset={Math.max(0, tripData.days.length - 1)}
              onSaveToBookmark={canEdit && online ? handleSaveToBookmark : undefined}
              onReorderCandidate={dnd.reorderCandidate}
              currency={tripData.currency}
            />
          </div>
        ) : (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {tsch("schedulesNotAvailable", { feature: tsch("candidates") })}
          </p>
        );
      case "expenses":
        return (
          <ExpenseTab
            tripId={tripId}
            canEdit={canEdit}
            hasDays={tripData.days.length > 0}
            addOpen={!isLg ? addExpenseOpen : false}
            onAddOpenChange={setAddExpenseOpen}
          />
        );
      case "bookmarks":
        return (
          <BookmarkTab
            tripId={tripId}
            disabled={!online || !canEdit}
            hasDays={tripData.days.length > 0}
            onCandidateAdded={onMutate}
          />
        );
      case "souvenirs":
        return (
          <SouvenirTab
            tripId={tripId}
            hasDays={tripData.days.length > 0}
            addOpen={!isLg ? addSouvenirOpen : false}
            onAddOpenChange={setAddSouvenirOpen}
          />
        );
      case "activity":
        return <ActivityLog tripId={tripId} />;
      case "map":
        return (
          <div className="h-[calc(100svh-14rem)]">
            <MapPanel
              tripId={tripId}
              currentDaySchedules={currentPattern?.schedules ?? []}
              allSchedules={allSchedules}
              online={online}
            />
          </div>
        );
    }
  }

  return (
    <LoadingBoundary
      isLoading={isLoading || (!!pollId && isPollLoading)}
      skeleton={<TripDetailSkeleton />}
    >
      {queryError ? (
        <p className="text-destructive">{tm("tripFetchFailed")}</p>
      ) : trip ? (
        <MapsProvider enabled={trip.mapsEnabled}>
          <SelectionProvider value={selectionValue}>
            <div className="mt-4">
              <TripHeader
                trip={trip}
                tripId={tripId}
                otherPresence={otherPresence}
                isConnected={isConnected}
                online={online}
                canEdit={canEdit}
                onCacheWritten={onCacheWritten}
                onEditOpen={() => setEditOpen(true)}
                onOpenBookmarks={
                  isGuest
                    ? undefined
                    : () => {
                        handleMobileTabChange("bookmarks");
                      }
                }
                onOpenActivity={() => {
                  handleMobileTabChange("activity");
                }}
                onOpenMap={trip.mapsEnabled ? () => handleMobileTabChange("map") : undefined}
                onReaction={sendReaction}
                cooldown={cooldown}
              />
              <EditTripDialog
                tripId={tripId}
                title={trip.title}
                destination={trip.destination}
                startDate={trip.startDate}
                endDate={trip.endDate}
                coverImageUrl={trip.coverImageUrl}
                coverImagePosition={trip.coverImagePosition}
                currency={(trip.currency ?? "JPY") as CurrencyCode}
                expenseCount={trip.expenseCount ?? 0}
                open={editOpen}
                onOpenChange={setEditOpen}
                onUpdate={onMutate}
              />
              <DndContext
                sensors={dnd.sensors}
                collisionDetection={dnd.collisionDetection}
                onDragStart={dnd.handleDragStart}
                onDragOver={dnd.handleDragOver}
                onDragMove={dnd.handleDragMove}
                onDragEnd={dnd.handleDragEnd}
                onDragCancel={dnd.handleDragCancel}
                accessibility={{ announcements: dndAnnouncements }}
              >
                {/* Mobile layout */}
                <div className="lg:hidden" inert={isLg || undefined}>
                  <SpSwipeTabs<MobileContentTab>
                    tabs={mobileTripTabs}
                    activeTab={mobileTab}
                    onTabChange={handleMobileTabChange}
                    renderContent={renderTabContent}
                    swipeEnabled={isSwipableTab && !isLoading && !!trip}
                    className="my-2"
                  />
                  {!isSwipableTab && <div className="pb-20">{renderTabContent(mobileTab)}</div>}
                </div>

                {/* Desktop layout */}
                <div className="hidden lg:flex items-start gap-4">
                  {/* Left panel */}
                  <div className="flex min-w-0 max-h-[calc(100vh-8rem)] sm:max-h-[calc(100vh-12rem)] flex-[3] flex-col rounded-lg border bg-card">
                    <DayTabs
                      days={trip.days}
                      selectedDay={selectedDay}
                      onSelectDay={setSelectedDay}
                      otherPresence={otherPresence}
                      hasPoll={!!trip.poll}
                    />
                    {selectedDay === -1 && trip.poll ? (
                      <div className="min-h-0 overflow-y-auto overscroll-contain">
                        <PollTab
                          pollId={trip.poll.id}
                          isOwner={isOwnerRole(trip.role)}
                          canEdit={canEdit}
                          onMutate={onMutate}
                          onConfirmed={() => setSelectedDay(0)}
                          addOptionOpen={addPollOptionOpen}
                          onAddOptionOpenChange={setAddPollOptionOpen}
                        />
                      </div>
                    ) : currentDay && currentPattern ? (
                      <div
                        ref={timelinePanelRef}
                        id={`day-panel-${currentDay.id}`}
                        role="tabpanel"
                        className="min-h-0 overflow-y-auto overscroll-contain p-4"
                      >
                        <DayWeatherEditor
                          weatherHook={weather}
                          currentDayId={currentDay.id}
                          currentWeatherType={currentDay.weatherType}
                          currentWeatherTypeSecondary={currentDay.weatherTypeSecondary}
                          currentTempHigh={currentDay.tempHigh}
                          currentTempLow={currentDay.tempLow}
                          canEdit={canEdit}
                          online={online}
                        />
                        <DayMemoEditor
                          memo={memo}
                          currentDayId={currentDay.id}
                          currentDayMemo={currentDay.memo}
                          canEdit={canEdit}
                          online={online}
                        />

                        <DayTimeline
                          key={currentPattern.id}
                          tripId={tripId}
                          dayId={currentDay.id}
                          patternId={currentPattern.id}
                          date={currentDay.date}
                          schedules={dnd.localSchedules}
                          onRefresh={onMutate}
                          onScheduleAdded={onCacheWritten}
                          disabled={!online || !canEdit}
                          addScheduleOpen={isLg ? addScheduleOpen : false}
                          onAddScheduleOpenChange={isLg ? setAddScheduleOpen : undefined}
                          maxEndDayOffset={Math.max(1, trip.days.length - 1 - selectedDay)}
                          totalDays={trip.days.length}
                          crossDayEntries={dndCrossDayEntries}
                          overScheduleId={dnd.activeDragItem ? dnd.overScheduleId : null}
                          overUpperHalf={dnd.overUpperHalf}
                          scheduleLimitReached={scheduleLimitReached}
                          scheduleLimitMessage={scheduleLimitMessage}
                          onSaveToBookmark={canEdit && online ? handleSaveToBookmark : undefined}
                          onReorderSchedule={dnd.reorderSchedule}
                          mapsEnabled={trip.mapsEnabled}
                          currency={trip.currency}
                          headerContent={
                            <PatternTabs
                              patterns={currentDay.patterns}
                              currentDayId={currentDay.id}
                              currentPatternIndex={currentPatternIndex}
                              canEdit={canEdit}
                              online={online}
                              patternOps={patternOps}
                              onSelectPattern={(dayId, index) =>
                                setSelectedPattern((prev) => ({ ...prev, [dayId]: index }))
                              }
                            />
                          }
                        />
                        <ScrollToTop containerRef={timelinePanelRef} />
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center py-16 text-center">
                        <p className="text-lg font-medium">{tm("schedulingStatusTitle")}</p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {tm("schedulingStatusDescription")}
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Right panel */}
                  <RightPanel
                    tripId={tripId}
                    rightPanelTab={rightPanelTab}
                    setRightPanelTab={setRightPanelTab}
                    candidates={dnd.localCandidates}
                    currentDayId={currentDay?.id ?? null}
                    currentPatternId={currentPattern?.id ?? null}
                    onRefresh={onMutate}
                    onCacheWritten={onCacheWritten}
                    disabled={!online || !canEdit}
                    canEdit={canEdit}
                    online={online}
                    addCandidateOpen={isLg ? addCandidateOpen : false}
                    onAddCandidateOpenChange={setAddCandidateOpen}
                    addSouvenirOpen={isLg ? addSouvenirOpen : false}
                    onAddSouvenirOpenChange={setAddSouvenirOpen}
                    scheduleLimitReached={scheduleLimitReached}
                    scheduleLimitMessage={scheduleLimitMessage}
                    overCandidateId={dnd.activeDragItem ? dnd.overCandidateId : null}
                    hasDays={trip.days.length > 0}
                    maxEndDayOffset={Math.max(0, trip.days.length - 1)}
                    onSaveToBookmark={canEdit && online ? handleSaveToBookmark : undefined}
                    mapsEnabled={trip.mapsEnabled}
                    allSchedules={allSchedules}
                    currentDaySchedules={currentPattern?.schedules ?? []}
                    currency={trip.currency}
                  />
                </div>
                {mounted &&
                  createPortal(
                    <DragOverlay dropAnimation={defaultDropAnimation}>
                      {dnd.activeDragItem &&
                        (() => {
                          const Icon = CATEGORY_ICONS[dnd.activeDragItem.category];
                          const colorClasses = SCHEDULE_COLOR_CLASSES[dnd.activeDragItem.color];
                          return (
                            <div className="flex w-max items-center gap-2 rounded-md border bg-card p-2 shadow-lg opacity-90">
                              <div
                                className={cn(
                                  "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-white",
                                  colorClasses.bg,
                                )}
                              >
                                <Icon className="h-3 w-3" />
                              </div>
                              <span className="whitespace-nowrap text-sm font-medium">
                                {dnd.activeDragItem.name}
                              </span>
                            </div>
                          );
                        })()}
                    </DragOverlay>,
                    document.body,
                  )}
              </DndContext>

              <Fab
                onClick={() => {
                  if (mobileTab === "schedule") {
                    if (selectedDay === -1) {
                      setAddPollOptionOpen(true);
                    } else {
                      if (scheduleLimitReached) {
                        toast.error(scheduleLimitMessage);
                        return;
                      }
                      setAddScheduleOpen(true);
                    }
                  } else if (mobileTab === "candidates") setAddCandidateOpen(true);
                  else if (mobileTab === "expenses") setAddExpenseOpen(true);
                  else if (mobileTab === "souvenirs") setAddSouvenirOpen(true);
                }}
                label={
                  mobileTab === "schedule"
                    ? selectedDay === -1
                      ? tp("addOptionButton")
                      : tsch("addSchedule")
                    : mobileTab === "candidates"
                      ? tsch("addCandidate")
                      : mobileTab === "expenses"
                        ? te("addTitle")
                        : ts("addSouvenir")
                }
                hidden={
                  !canEdit ||
                  !online ||
                  mobileTab === "bookmarks" ||
                  mobileTab === "activity" ||
                  (mobileTab === "schedule" &&
                    selectedDay === -1 &&
                    (!isOwnerRole(trip.role) || pollData?.status !== "open"))
                }
              />

              <AddPatternDialog patternOps={patternOps} />
              <RenamePatternDialog patternOps={patternOps} />
              <BatchDeleteDialog selection={selection} />
              <DeletePatternDialog patternOps={patternOps} />
              <OverwritePatternDialog
                patternOps={patternOps}
                patterns={currentDay?.patterns ?? []}
              />
              <BookmarkListPickerDialog
                open={bookmarkPickerOpen}
                onOpenChange={setBookmarkPickerOpen}
                onSelect={handleBookmarkListSelected}
              />
            </div>
          </SelectionProvider>
        </MapsProvider>
      ) : null}
      <ReactionOverlay reactions={reactions} onAnimationEnd={removeReaction} />
    </LoadingBoundary>
  );
}

const MAPS_LIBRARIES: ("places" | "geometry")[] = ["places", "geometry"];

function MapsProvider({ enabled, children }: { enabled: boolean; children: React.ReactNode }) {
  if (!enabled) return <>{children}</>;
  return (
    <APIProvider
      apiKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? ""}
      libraries={MAPS_LIBRARIES}
    >
      {children}
    </APIProvider>
  );
}
