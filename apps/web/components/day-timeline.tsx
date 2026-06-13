"use client";

import { useDroppable } from "@dnd-kit/core";
import { SortableContext } from "@dnd-kit/sortable";
import type { CrossDayEntry, ScheduleResponse, TripResponse } from "@sugara/shared";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpDown,
  Bookmark,
  Copy,
  GripVertical,
  MoreHorizontal,
  Plus,
  SquareMousePointer,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import dynamic from "next/dynamic";
import { useLocale, useTranslations } from "next-intl";
import { Fragment, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { api } from "@/lib/api";
import { DROP_ZONE_ACTIVE } from "@/lib/colors";
import { noShiftSortingStrategy } from "@/lib/dnd-sorting";
import { indicatorGapIndex } from "@/lib/drop-position";
import { compareByStartTime, formatDate } from "@/lib/format";
import { useSelection } from "@/lib/hooks/selection-context";
import { useMobile } from "@/lib/hooks/use-is-mobile";
import type { TimelineItem } from "@/lib/merge-timeline";
import { buildMergedTimeline, timelineSortableIds } from "@/lib/merge-timeline";
import { queryKeys } from "@/lib/query-keys";
import { isScheduleListSorted } from "@/lib/timeline-sort";
import { moveScheduleToCandidate, removeScheduleFromPattern } from "@/lib/trip-cache";
import { cn } from "@/lib/utils";
import { DndInsertIndicator } from "./dnd-insert-indicator";
import { TravelTimeSeparator } from "./travel-time-separator";

const AddScheduleDialog = dynamic(() =>
  import("./add-schedule-dialog").then((mod) => mod.AddScheduleDialog),
);

import { ScheduleItem } from "./schedule-item";

type DayTimelineProps = {
  tripId: string;
  dayId: string;
  patternId: string;
  date: string;
  schedules: ScheduleResponse[];
  onRefresh: () => void;
  /**
   * Post-add callback that must not refetch the trip detail: the add dialog
   * already wrote the POST response into the cache, and an immediate stale
   * refetch can clobber it (#123). Required so new call sites cannot silently
   * fall back to a refetching callback.
   */
  onScheduleAdded: () => void;
  disabled?: boolean;
  headerContent?: React.ReactNode;
  maxEndDayOffset?: number;
  totalDays?: number;
  crossDayEntries?: CrossDayEntry[];
  scheduleLimitReached?: boolean;
  scheduleLimitMessage?: string;
  addScheduleOpen?: boolean;
  onAddScheduleOpenChange?: (open: boolean) => void;
  overScheduleId?: string | null;
  overUpperHalf?: boolean;
  onSaveToBookmark?: (scheduleIds: string[]) => void;
  onReorderSchedule?: (id: string, direction: "up" | "down") => void;
  mapsEnabled?: boolean;
  /** Trip currency for formatting transport cost. Defaults to JPY. */
  currency?: string;
};

export function DayTimeline({
  tripId,
  dayId,
  patternId,
  date,
  schedules,
  onRefresh,
  onScheduleAdded,
  disabled,
  headerContent,
  maxEndDayOffset,
  totalDays,
  crossDayEntries,
  scheduleLimitReached,
  scheduleLimitMessage,
  addScheduleOpen,
  onAddScheduleOpenChange,
  overScheduleId,
  overUpperHalf = true,
  onSaveToBookmark,
  onReorderSchedule,
  mapsEnabled = false,
  currency = "JPY",
}: DayTimelineProps) {
  const locale = useLocale();
  const tm = useTranslations("messages");
  const tc = useTranslations("common");
  const tsch = useTranslations("schedule");
  const queryClient = useQueryClient();
  const cacheKey = queryKeys.trips.detail(tripId);

  const sel = useSelection();
  const selectionMode = sel.selectionTarget === "timeline";
  const selectedIds = selectionMode ? sel.selectedIds : undefined;
  const selectedCount = selectedIds?.size ?? 0;
  const { setNodeRef: setDroppableRef, isOver: isOverTimeline } = useDroppable({
    id: "timeline",
    data: { type: "timeline" },
  });

  const isMobile = useMobile();
  const [reorderMode, setReorderMode] = useState(false);
  const [isSortingByTime, setIsSortingByTime] = useState(false);

  async function handleDelete(
    scheduleId: string,
    overrideDayId?: string,
    overridePatternId?: string,
  ) {
    const dId = overrideDayId ?? dayId;
    const pId = overridePatternId ?? patternId;

    // Cancel in-flight refetches to prevent them from overwriting the optimistic update
    await queryClient.cancelQueries({ queryKey: cacheKey });
    const prev = queryClient.getQueryData<TripResponse>(cacheKey);
    if (prev) {
      queryClient.setQueryData(cacheKey, removeScheduleFromPattern(prev, dId, pId, scheduleId));
    }

    toast.success(tm("scheduleDeleted"));

    try {
      await api(`/api/trips/${tripId}/days/${dId}/patterns/${pId}/schedules/${scheduleId}`, {
        method: "DELETE",
      });
      onRefresh();
    } catch {
      if (prev) queryClient.setQueryData(cacheKey, prev);
      toast.error(tm("scheduleDeleteFailed"));
    }
  }

  async function handleUnassign(scheduleId: string) {
    await queryClient.cancelQueries({ queryKey: cacheKey });
    const prev = queryClient.getQueryData<TripResponse>(cacheKey);
    if (prev) {
      queryClient.setQueryData(
        cacheKey,
        moveScheduleToCandidate(prev, dayId, patternId, scheduleId),
      );
    }
    toast.success(tm("scheduleMovedToCandidate"));

    try {
      await api(`/api/trips/${tripId}/schedules/${scheduleId}/unassign`, {
        method: "POST",
      });
      onRefresh();
    } catch {
      if (prev) queryClient.setQueryData(cacheKey, prev);
      toast.error(tm("scheduleMoveFailed"));
    }
  }

  // Memoized so unrelated re-renders (selection-mode toggle, drag-over state)
  // don't pay the O(n) cost on schedules that haven't changed. The actual
  // sorted-vs-anchored logic lives in lib/timeline-sort.ts where it's
  // independently unit-tested.
  const isSorted = useMemo(() => isScheduleListSorted(schedules), [schedules]);

  async function handleSortByTime() {
    if (isSortingByTime) return;
    setIsSortingByTime(true);
    const sorted = [...schedules].sort(compareByStartTime);
    const scheduleIds = sorted.map((s) => s.id);
    try {
      await api(`/api/trips/${tripId}/days/${dayId}/patterns/${patternId}/schedules/reorder`, {
        method: "PATCH",
        body: JSON.stringify({ scheduleIds, clearAnchors: true }),
      });
      onRefresh();
    } catch {
      toast.error(tm("scheduleReorderFailed"));
    } finally {
      setIsSortingByTime(false);
    }
  }

  const merged = useMemo(
    () => buildMergedTimeline(schedules, crossDayEntries),
    [schedules, crossDayEntries],
  );
  const sortableIds = useMemo(() => timelineSortableIds(merged), [merged]);
  const scheduleIndexById = useMemo(() => new Map(schedules.map((s, i) => [s.id, i])), [schedules]);

  const inlineIndicator = <DndInsertIndicator />;
  // The hovered card + upperHalf pair is normalized to a gap index so that
  // "lower half of item i" and "upper half of item i+1" — which drop into the
  // same position — render the line at one canonical spot instead of two.
  const insertGapIndex = useMemo(
    () => indicatorGapIndex(sortableIds, overScheduleId ?? null, overUpperHalf),
    [sortableIds, overScheduleId, overUpperHalf],
  );

  function renderItem(item: TimelineItem, i: number, opts?: { selectable?: boolean }) {
    const isFirst = i === 0;
    const isLast = i === merged.length - 1;
    const isReorderable = isMobile && reorderMode && !disabled;

    // Gap k renders above item k; the "after the last item" gap (k === length)
    // renders on the bottom edge of the last item.
    const overlayIndicator =
      insertGapIndex === i ? (
        <DndInsertIndicator overlay position="top" />
      ) : isLast && insertGapIndex === merged.length ? (
        <DndInsertIndicator overlay position="bottom" />
      ) : null;

    if (item.type === "crossDay") {
      const {
        schedule: s,
        sourceDayId,
        sourcePatternId,
        sourceDayNumber,
        crossDayPosition,
      } = item.entry;
      const sourceMaxEndDayOffset =
        totalDays != null ? totalDays - sourceDayNumber : maxEndDayOffset;
      return (
        <div key={`cross-${s.id}`} className="relative">
          {overlayIndicator}
          <ScheduleItem
            {...s}
            tripId={tripId}
            dayId={sourceDayId}
            patternId={sourcePatternId}
            date={date}
            isFirst={isFirst}
            isLast={isLast}
            onDelete={() => handleDelete(s.id, sourceDayId, sourcePatternId)}
            onSaved={onScheduleAdded}
            onUpdate={onRefresh}
            onUnassign={!disabled && !opts?.selectable ? () => handleUnassign(s.id) : undefined}
            disabled={disabled}
            maxEndDayOffset={sourceMaxEndDayOffset}
            crossDayDisplay
            crossDaySourceDayNumber={sourceDayNumber}
            crossDayPosition={crossDayPosition}
            interactionsDisabled={!!opts?.selectable || isReorderable}
            currency={currency}
          />
        </div>
      );
    }

    const { schedule } = item;
    // O(1) lookup via precomputed Map; previously O(n) findIndex
    const scheduleIdx = scheduleIndexById.get(schedule.id) ?? -1;
    // slice is O(n-k) instead of filter O(n); valid because schedules is in sortOrder order
    const schedulesAfter = scheduleIdx >= 0 ? schedules.slice(scheduleIdx + 1) : [];

    return (
      <div key={schedule.id} className="relative">
        {overlayIndicator}
        <ScheduleItem
          {...schedule}
          tripId={tripId}
          dayId={dayId}
          patternId={patternId}
          date={date}
          isFirst={isFirst}
          isLast={isLast}
          onDelete={() => handleDelete(schedule.id)}
          onSaved={onScheduleAdded}
          onUpdate={onRefresh}
          onUnassign={
            !disabled && !opts?.selectable ? () => handleUnassign(schedule.id) : undefined
          }
          disabled={disabled}
          maxEndDayOffset={maxEndDayOffset}
          selectable={opts?.selectable}
          selected={opts?.selectable ? selectedIds?.has(schedule.id) : undefined}
          onSelect={opts?.selectable ? sel.toggle : undefined}
          siblingSchedules={schedulesAfter}
          onSaveToBookmark={onSaveToBookmark ? () => onSaveToBookmark([schedule.id]) : undefined}
          draggable={!isMobile}
          reorderable={isReorderable}
          onMoveUp={isReorderable ? () => onReorderSchedule?.(schedule.id, "up") : undefined}
          onMoveDown={isReorderable ? () => onReorderSchedule?.(schedule.id, "down") : undefined}
          mapsEnabled={mapsEnabled}
          currency={currency}
        />
      </div>
    );
  }

  return (
    <div>
      {selectionMode ? (
        <div className="mb-2 flex select-none items-center gap-1.5 rounded-lg bg-muted px-1.5 py-1">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={sel.exit}>
            <X className="h-3.5 w-3.5" />
          </Button>
          <span className="text-xs font-medium">
            {tc("selectedCount", { count: selectedCount })}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2 text-xs"
            onClick={selectedCount === schedules.length ? sel.deselectAll : sel.selectAll}
          >
            {selectedCount === schedules.length ? tc("deselectAll") : tc("selectAll")}
          </Button>
          <div className="ml-auto flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              className="h-8 px-2 text-xs"
              onClick={sel.batchUnassign}
              disabled={selectedCount === 0 || sel.batchLoading}
            >
              <Undo2 className="h-3.5 w-3.5" />
              {tsch("moveToCandidate")}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  disabled={selectedCount === 0 || sel.batchLoading}
                >
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={sel.batchDuplicateSchedules}>
                  <Copy />
                  {tc("duplicate")}
                </DropdownMenuItem>
                {onSaveToBookmark && (
                  <DropdownMenuItem onClick={() => onSaveToBookmark(Array.from(selectedIds ?? []))}>
                    <Bookmark />
                    {tsch("saveToBookmark")}
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  className="text-destructive"
                  onClick={() => sel.setBatchDeleteOpen(true)}
                >
                  <Trash2 />
                  {tc("delete")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      ) : reorderMode ? (
        <div className="mb-2 flex select-none items-center gap-1.5 rounded-lg bg-muted px-1.5 py-1">
          <GripVertical className="ml-1 h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-medium">{tsch("reordering")}</span>
          <div className="ml-auto">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-xs"
              onClick={() => setReorderMode(false)}
            >
              {tsch("done")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="mb-2 flex select-none items-center gap-1.5">
          <span className="hidden text-sm text-muted-foreground lg:inline">
            {formatDate(date, { locale })}
          </span>
          <div className="flex flex-1 items-center gap-1.5 [&>*]:flex-1 lg:ml-auto lg:flex-initial lg:[&>*]:flex-initial">
            {!disabled &&
              !isMobile &&
              (scheduleLimitReached ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span>
                      <Button variant="outline" size="sm" className="w-full" disabled>
                        <Plus className="h-4 w-4" />
                        {tsch("addSchedule")}
                        <span className="hidden text-xs text-muted-foreground lg:inline">(A)</span>
                      </Button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>{scheduleLimitMessage}</TooltipContent>
                </Tooltip>
              ) : (
                <AddScheduleDialog
                  tripId={tripId}
                  dayId={dayId}
                  patternId={patternId}
                  onAdd={onScheduleAdded}
                  disabled={disabled}
                  maxEndDayOffset={maxEndDayOffset}
                  open={addScheduleOpen}
                  onOpenChange={onAddScheduleOpenChange}
                  mapsEnabled={mapsEnabled}
                />
              ))}
            {!disabled && isMobile && !scheduleLimitReached && (
              <AddScheduleDialog
                tripId={tripId}
                dayId={dayId}
                patternId={patternId}
                onAdd={onScheduleAdded}
                disabled={disabled}
                maxEndDayOffset={maxEndDayOffset}
                open={addScheduleOpen}
                onOpenChange={onAddScheduleOpenChange}
                mapsEnabled={mapsEnabled}
                hideTrigger
              />
            )}
            {!disabled && schedules.length > 0 && sel.canEnter && (
              <Button
                variant="outline"
                size="sm"
                className="h-9"
                onClick={() => {
                  setReorderMode(false);
                  sel.enter("timeline");
                }}
              >
                <SquareMousePointer className="h-4 w-4" />
                {tc("select")}
              </Button>
            )}
            {!disabled && isMobile && schedules.length > 0 && onReorderSchedule && (
              <Button
                variant="outline"
                size="sm"
                className="h-9"
                disabled={merged.length <= 1}
                onClick={() => {
                  sel.exit();
                  setReorderMode(true);
                }}
              >
                <GripVertical className="h-4 w-4" />
                {tc("sort")}
              </Button>
            )}
            {schedules.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="h-9"
                onClick={handleSortByTime}
                disabled={disabled || isSorted || isSortingByTime}
              >
                <ArrowUpDown className="h-4 w-4" />
                {tsch("sortByTime")}
              </Button>
            )}
          </div>
        </div>
      )}
      {!selectionMode && !reorderMode && headerContent}

      {merged.length === 0 ? (
        <div
          ref={selectionMode ? undefined : setDroppableRef}
          className={cn(
            "rounded-md border border-dashed p-6 text-center transition-colors",
            isOverTimeline && DROP_ZONE_ACTIVE,
          )}
        >
          <p className="text-sm text-muted-foreground">{tm("emptySchedule")}</p>
        </div>
      ) : selectionMode ? (
        <div className="space-y-1.5">
          {merged.map((item, i) => renderItem(item, i, { selectable: true }))}
        </div>
      ) : (
        <div ref={setDroppableRef}>
          <SortableContext items={sortableIds} strategy={noShiftSortingStrategy}>
            <div className="space-y-1.5">
              {merged.map((item, i) => {
                const next = merged[i + 1];
                const showSeparator =
                  mapsEnabled &&
                  item.type === "schedule" &&
                  next?.type === "schedule" &&
                  item.schedule.category !== "transport" &&
                  next.schedule.category !== "transport" &&
                  item.schedule.latitude != null &&
                  item.schedule.longitude != null &&
                  next.schedule.latitude != null &&
                  next.schedule.longitude != null &&
                  // Only show when both schedules have times set (no travel time for untimed spots)
                  item.schedule.startTime != null &&
                  item.schedule.endTime != null &&
                  next.schedule.startTime != null &&
                  // Skip if first schedule spans multiple days (endDayOffset > 0)
                  (item.schedule.endDayOffset == null || item.schedule.endDayOffset === 0);
                const itemKey =
                  item.type === "crossDay" ? `cross-${item.entry.schedule.id}` : item.schedule.id;
                return (
                  <Fragment key={itemKey}>
                    {renderItem(item, i)}
                    {showSeparator && item.type === "schedule" && next?.type === "schedule" && (
                      <TravelTimeSeparator
                        tripId={tripId}
                        originLat={item.schedule.latitude as number}
                        originLng={item.schedule.longitude as number}
                        originPlaceId={item.schedule.placeId}
                        destLat={next.schedule.latitude as number}
                        destLng={next.schedule.longitude as number}
                        destPlaceId={next.schedule.placeId}
                      />
                    )}
                  </Fragment>
                );
              })}
              {isOverTimeline && overScheduleId === null && inlineIndicator}
            </div>
          </SortableContext>
        </div>
      )}
    </div>
  );
}
