"use client";

import { MapPin } from "lucide-react";
import { useTranslations } from "next-intl";
import { memo, useState } from "react";
import { SelectionIndicator } from "@/components/ui/selection-indicator";
import { SCHEDULE_COLOR_CLASSES, SELECTED_RING } from "@/lib/colors";
import { formatTimeRange } from "@/lib/format";
import { CATEGORY_ICONS } from "@/lib/icons";
import { buildMapsSearchUrl } from "@/lib/transport-link";
import { cn } from "@/lib/utils";
import { DragHandle } from "../drag-handle";
import { ReorderControls } from "../reorder-controls";
import type { ScheduleItemProps, SortableProps } from "./primitives";
import {
  cardBodyProps,
  ScheduleItemDialogs,
  ScheduleLinks,
  ScheduleMenu,
  ScheduleTimeLabel,
  TimelineNode,
  useShiftProposal,
} from "./primitives";

type PlaceItemProps = ScheduleItemProps & { sortable: SortableProps };

export const PlaceItem = memo(function PlaceItem({
  id,
  name,
  category,
  address,
  urls,
  startTime,
  endTime,
  endDayOffset,
  memo,
  departurePlace,
  arrivalPlace,
  transportMethod,
  color = "blue",
  updatedAt,
  tripId,
  dayId,
  patternId,
  onDelete,
  onUpdate,
  onUnassign,
  disabled,
  isFirst,
  isLast,
  selectable,
  selected,
  onSelect,
  sortable,
  maxEndDayOffset,
  crossDayDisplay,
  crossDaySourceDayNumber,
  crossDayPosition,
  siblingSchedules,
  onSaveToBookmark,
  draggable,
  reorderable,
  interactionsDisabled,
  onMoveUp,
  onMoveDown,
  mapsEnabled,
}: PlaceItemProps) {
  const [editOpen, setEditOpen] = useState(false);
  const shift = useShiftProposal(siblingSchedules);
  const tc = useTranslations("crossDay");
  const tdt = useTranslations("dayTabs");
  const crossDayT = {
    hotelCheckin: tc("hotelCheckin"),
    hotelStaying: tc("hotelStaying"),
    hotelCheckout: tc("hotelCheckout"),
    genericStart: tc("genericStart"),
    genericContinuing: tc("genericContinuing"),
    genericEnd: tc("genericEnd"),
  };
  const CategoryIcon = CATEGORY_ICONS[category];
  const colorClasses = SCHEDULE_COLOR_CLASSES[color];

  const visibleStartTime = crossDayDisplay ? endTime : startTime;
  const visibleEndTime = crossDayDisplay || endDayOffset ? null : endTime;
  const timeStr = formatTimeRange(visibleStartTime, visibleEndTime);

  const CardBodyWrapper = selectable ? "button" : "div";
  const cardBody = (
    <CardBodyWrapper
      type={selectable ? "button" : undefined}
      className={cn(
        "min-w-0 flex-1 rounded-md border p-3",
        crossDayDisplay && "border-dashed bg-muted/30",
        selectable &&
          "w-full cursor-pointer text-left transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selectable && selected && SELECTED_RING,
      )}
      {...cardBodyProps(
        id,
        name,
        category,
        selectable,
        selected,
        onSelect,
        crossDayDisplay,
        crossDaySourceDayNumber,
        crossDayPosition,
        tdt("dayNumber", { n: crossDaySourceDayNumber ?? 0 }),
        crossDayT,
      )}
    >
      <div className="flex items-center gap-2">
        {selectable ? (
          <SelectionIndicator checked={!!selected} />
        ) : reorderable ? (
          <ReorderControls
            onMoveUp={onMoveUp}
            onMoveDown={onMoveDown}
            isFirst={!!isFirst}
            isLast={!!isLast}
          />
        ) : draggable !== false && !crossDayDisplay ? (
          <DragHandle attributes={sortable.attributes} listeners={sortable.listeners} />
        ) : null}
        <div className="min-w-0 flex-1">
          <span className="block min-w-0 truncate text-sm font-medium" translate="yes">
            {name}
          </span>
          <ScheduleTimeLabel
            crossDayDisplay={crossDayDisplay}
            crossDayPosition={crossDayPosition}
            endDayOffset={endDayOffset}
            category={category}
            timeStr={timeStr}
          />
          {(address || urls.length > 0 || memo) && (
            <div
              className={cn(
                "mt-1 space-y-1",
                (selectable || reorderable || interactionsDisabled) && "pointer-events-none",
              )}
            >
              {address && (
                <a
                  href={buildMapsSearchUrl(address)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex w-fit max-w-full items-center gap-1.5 text-xs text-blue-600 hover:underline dark:text-blue-400"
                >
                  <MapPin className="h-3 w-3 shrink-0 text-muted-foreground/70" />
                  <span className="truncate" translate="yes">
                    {address}
                  </span>
                </a>
              )}
              <ScheduleLinks urls={urls} memo={memo} />
            </div>
          )}
        </div>
        {!selectable && !reorderable && !interactionsDisabled && (
          <ScheduleMenu
            name={name}
            disabled={disabled}
            onEdit={() => setEditOpen(true)}
            onDelete={onDelete}
            onUnassign={onUnassign}
            onSaveToBookmark={onSaveToBookmark}
          />
        )}
      </div>
    </CardBodyWrapper>
  );

  return (
    <div
      ref={sortable.nodeRef}
      style={sortable.style}
      className={cn(
        "animate-in fade-in-0 slide-in-from-top-1 duration-200",
        "flex gap-3 py-1.5",
        sortable.isDragging && "opacity-50",
      )}
    >
      <TimelineNode
        variant="place"
        icon={CategoryIcon}
        isFirst={isFirst}
        isLast={isLast}
        colorClasses={colorClasses}
      />

      {cardBody}

      <ScheduleItemDialogs
        tripId={tripId}
        dayId={dayId}
        patternId={patternId}
        schedule={{
          id,
          name,
          category,
          address,
          urls,
          startTime,
          endTime,
          endDayOffset,
          memo,
          departurePlace,
          arrivalPlace,
          transportMethod,
          color,
          updatedAt,
        }}
        editOpen={editOpen}
        onEditOpenChange={setEditOpen}
        onUpdate={onUpdate}
        maxEndDayOffset={maxEndDayOffset}
        shift={shift}
        mapsEnabled={mapsEnabled}
      />
    </div>
  );
});
