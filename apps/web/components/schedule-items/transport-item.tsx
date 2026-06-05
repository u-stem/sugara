"use client";

import type { TransportMethod } from "@sugara/shared";
import { formatCurrency, toCurrencyCode } from "@sugara/shared";
import { Route, Wallet } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { memo, useState } from "react";
import { SelectionIndicator } from "@/components/ui/selection-indicator";
import { SCHEDULE_COLOR_CLASSES, SELECTED_RING } from "@/lib/colors";
import { formatTime } from "@/lib/format";
import { CATEGORY_ICONS, TRANSPORT_ICONS } from "@/lib/icons";
import { buildTransportUrl } from "@/lib/transport-link";
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

type TransportItemProps = ScheduleItemProps & { sortable: SortableProps };

export const TransportItem = memo(function TransportItem({
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
  cost,
  currency = "JPY",
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
  date,
  onSaveToBookmark,
  draggable,
  reorderable,
  onMoveUp,
  onMoveDown,
  mapsEnabled,
}: TransportItemProps) {
  const [editOpen, setEditOpen] = useState(false);
  const shift = useShiftProposal(siblingSchedules);
  const tc = useTranslations("crossDay");
  const tLabel = useTranslations("labels.transportMethod");
  const locale = useLocale();
  const crossDayT = {
    hotelCheckin: tc("hotelCheckin"),
    hotelStaying: tc("hotelStaying"),
    hotelCheckout: tc("hotelCheckout"),
    genericStart: tc("genericStart"),
    genericContinuing: tc("genericContinuing"),
    genericEnd: tc("genericEnd"),
  };
  const colorClasses = SCHEDULE_COLOR_CLASSES[color];
  const TransportIcon = transportMethod
    ? TRANSPORT_ICONS[transportMethod as TransportMethod]
    : CATEGORY_ICONS.transport;

  const routeStr = crossDayDisplay
    ? arrivalPlace || ""
    : departurePlace && arrivalPlace
      ? `${departurePlace} → ${arrivalPlace}`
      : departurePlace || arrivalPlace || "";

  const methodLabel = transportMethod ? tLabel(transportMethod as TransportMethod) : "";

  // cost is a plain integer in the trip currency's units (no minor-unit scaling),
  // so format it directly. Hidden on the cross-day continuation view to avoid
  // repeating the fare on each spanned day.
  const costStr =
    !crossDayDisplay && cost != null ? formatCurrency(cost, toCurrencyCode(currency), locale) : "";

  const timeStr = crossDayDisplay
    ? endTime
      ? formatTime(endTime)
      : ""
    : startTime
      ? endTime && (endDayOffset == null || endDayOffset === 0)
        ? `${formatTime(startTime)} - ${formatTime(endTime)}`
        : formatTime(startTime)
      : "";

  const transitUrl =
    departurePlace && arrivalPlace
      ? buildTransportUrl({
          from: departurePlace,
          to: arrivalPlace,
          method: transportMethod,
          date,
          time: startTime,
        })
      : null;

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
        undefined,
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
          {(routeStr || costStr || urls.length > 0 || memo) && (
            <div className={cn("mt-1 space-y-1", selectable && "pointer-events-none")}>
              {routeStr && (
                <span
                  className="flex w-fit max-w-full items-center gap-1.5 text-xs text-muted-foreground"
                  translate="yes"
                >
                  <Route className="h-3 w-3 shrink-0 text-muted-foreground/70" />
                  {transitUrl ? (
                    <a
                      href={transitUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:underline dark:text-blue-400"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {crossDayDisplay && arrivalPlace ? `→ ${routeStr}` : routeStr}
                    </a>
                  ) : (
                    <span>{crossDayDisplay && arrivalPlace ? `→ ${routeStr}` : routeStr}</span>
                  )}
                  {methodLabel && <span className="shrink-0">({methodLabel})</span>}
                </span>
              )}
              {costStr && (
                <span className="flex w-fit items-center gap-1.5 text-xs text-muted-foreground">
                  <Wallet className="h-3 w-3 shrink-0 text-muted-foreground/70" />
                  {costStr}
                </span>
              )}
              <ScheduleLinks urls={urls} memo={memo} />
            </div>
          )}
        </div>
        {!selectable && (
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
        "flex gap-3 py-0.5",
        sortable.isDragging && "opacity-50",
      )}
    >
      <TimelineNode
        variant="transport"
        icon={TransportIcon}
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
          cost,
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
