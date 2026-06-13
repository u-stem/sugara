"use client";

import type { useSortable } from "@dnd-kit/sortable";
import type { ScheduleCategory, ScheduleColor, ScheduleResponse, TimeDelta } from "@sugara/shared";
import { shiftTime } from "@sugara/shared";
import { Bookmark, Clock, ExternalLink, Pencil, StickyNote, Trash2, Undo2, X } from "lucide-react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import type { CSSProperties } from "react";
import { useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ResponsiveAlertDialog,
  ResponsiveAlertDialogCancel,
  ResponsiveAlertDialogContent,
  ResponsiveAlertDialogDescription,
  ResponsiveAlertDialogDestructiveAction,
  ResponsiveAlertDialogFooter,
  ResponsiveAlertDialogHeader,
  ResponsiveAlertDialogTitle,
} from "@/components/ui/responsive-alert-dialog";
import type { SCHEDULE_COLOR_CLASSES } from "@/lib/colors";
import { getCrossDayLabel, getStartDayLabel } from "@/lib/cross-day-label";
import { isSafeUrl, stripProtocol } from "@/lib/format";
import { useMobile } from "@/lib/hooks/use-is-mobile";
import { cn } from "@/lib/utils";
import { ActionSheet } from "../action-sheet";
import { ItemMenuButton } from "../item-menu-button";

const EditScheduleDialog = dynamic(() =>
  import("../edit-schedule-dialog").then((mod) => mod.EditScheduleDialog),
);
const BatchShiftDialog = dynamic(() =>
  import("../batch-shift-dialog").then((mod) => mod.BatchShiftDialog),
);

type UseSortableReturn = ReturnType<typeof useSortable>;

export type SortableProps = {
  nodeRef: UseSortableReturn["setNodeRef"];
  style: CSSProperties;
  attributes: UseSortableReturn["attributes"];
  listeners: UseSortableReturn["listeners"];
  isDragging: boolean;
};

export type ScheduleItemProps = {
  id: string;
  name: string;
  category: ScheduleCategory;
  address?: string | null;
  urls: string[];
  startTime?: string | null;
  endTime?: string | null;
  endDayOffset?: number | null;
  memo?: string | null;
  departurePlace?: string | null;
  arrivalPlace?: string | null;
  transportMethod?: string | null;
  cost?: number | null;
  color?: ScheduleColor;
  updatedAt: string;
  tripId: string;
  dayId: string;
  patternId: string;
  onDelete: () => void;
  // Skip-refetch success path after an edit (cache reconciled in-place, #155).
  onSaved: () => void;
  // Refetch path: conflict/cache-evict recovery and post-batch-shift sync.
  onUpdate: () => void;
  onUnassign?: () => void;
  disabled?: boolean;
  isFirst?: boolean;
  isLast?: boolean;
  selectable?: boolean;
  selected?: boolean;
  onSelect?: (id: string) => void;
  maxEndDayOffset?: number;
  /** When true, display endTime only and hide endDayOffset label (cross-day target view) */
  crossDayDisplay?: boolean;
  /** Source day number for cross-day display (e.g. "1日目から継続") */
  crossDaySourceDayNumber?: number;
  /** Position within multi-day span: "intermediate" or "final" */
  crossDayPosition?: "intermediate" | "final";
  /** Subsequent schedules for batch time shift (sorted by sortOrder) */
  siblingSchedules?: ScheduleResponse[];
  /** ISO date string (YYYY-MM-DD) for transit search links */
  date?: string;
  onSaveToBookmark?: () => void;
  /** When false, hide DragHandle and disable useSortable (mobile) */
  draggable?: boolean;
  /** When true, show ReorderControls instead of DragHandle */
  reorderable?: boolean;
  /**
   * Disables link/address taps and hides the item menu without the
   * selectable/reorderable UI. Used by cross-day entries, which stay
   * non-selectable and non-reorderable while the rest of the timeline is in
   * selection/reorder mode.
   */
  interactionsDisabled?: boolean;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  mapsEnabled?: boolean;
  /** Trip currency for formatting transport cost. Defaults to JPY. */
  currency?: string;
};

export function ScheduleMenu({
  name,
  disabled,
  onEdit,
  onDelete,
  onUnassign,
  onSaveToBookmark,
}: {
  name: string;
  disabled?: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onUnassign?: () => void;
  onSaveToBookmark?: () => void;
}) {
  const isMobile = useMobile();
  const tc = useTranslations("common");
  const tsch = useTranslations("schedule");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  const sheetActions = [
    { label: tc("edit"), icon: <Pencil className="h-4 w-4" />, onClick: onEdit },
    ...(onUnassign
      ? [
          {
            label: tsch("moveToCandidate"),
            icon: <Undo2 className="h-4 w-4" />,
            onClick: onUnassign,
          },
        ]
      : []),
    ...(onSaveToBookmark
      ? [
          {
            label: tsch("saveToBookmark"),
            icon: <Bookmark className="h-4 w-4" />,
            onClick: onSaveToBookmark,
          },
        ]
      : []),
    {
      label: tc("delete"),
      icon: <Trash2 className="h-4 w-4" />,
      onClick: () => setDeleteOpen(true),
      variant: "destructive" as const,
    },
  ];

  return (
    <>
      {isMobile ? (
        <>
          <ItemMenuButton
            ariaLabel={tc("itemMenu", { name })}
            disabled={disabled}
            onClick={() => setSheetOpen(true)}
          />
          <ActionSheet open={sheetOpen} onOpenChange={setSheetOpen} actions={sheetActions} />
        </>
      ) : (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <ItemMenuButton ariaLabel={tc("itemMenu", { name })} disabled={disabled} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onEdit}>
              <Pencil />
              {tc("edit")}
            </DropdownMenuItem>
            {onUnassign && (
              <DropdownMenuItem onClick={onUnassign}>
                <Undo2 />
                {tsch("moveToCandidate")}
              </DropdownMenuItem>
            )}
            {onSaveToBookmark && (
              <DropdownMenuItem onClick={onSaveToBookmark}>
                <Bookmark />
                {tsch("saveToBookmark")}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem className="text-destructive" onClick={() => setDeleteOpen(true)}>
              <Trash2 />
              {tc("delete")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <ResponsiveAlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <ResponsiveAlertDialogContent>
          <ResponsiveAlertDialogHeader>
            <ResponsiveAlertDialogTitle>{tsch("deleteScheduleTitle")}</ResponsiveAlertDialogTitle>
            <ResponsiveAlertDialogDescription>
              {tsch("deleteScheduleDescription", { name })}
            </ResponsiveAlertDialogDescription>
          </ResponsiveAlertDialogHeader>
          <ResponsiveAlertDialogFooter>
            <ResponsiveAlertDialogCancel>
              <X className="h-4 w-4" />
              {tc("cancel")}
            </ResponsiveAlertDialogCancel>
            <ResponsiveAlertDialogDestructiveAction onClick={onDelete}>
              <Trash2 className="h-4 w-4" />
              {tsch("deleteScheduleConfirm")}
            </ResponsiveAlertDialogDestructiveAction>
          </ResponsiveAlertDialogFooter>
        </ResponsiveAlertDialogContent>
      </ResponsiveAlertDialog>
    </>
  );
}

function partitionShiftTargets(
  schedules: ScheduleResponse[],
  delta: number,
): { shiftable: ScheduleResponse[]; skipped: ScheduleResponse[] } {
  const shiftable: ScheduleResponse[] = [];
  const skipped: ScheduleResponse[] = [];
  for (const s of schedules) {
    if (!s.startTime && !s.endTime) continue;
    if (s.category === "hotel" && s.endDayOffset && s.endDayOffset > 0) {
      skipped.push(s);
      continue;
    }
    const canShiftStart = s.startTime ? shiftTime(s.startTime, delta) !== null : true;
    const canShiftEnd =
      !s.endTime || (s.endDayOffset && s.endDayOffset > 0)
        ? true
        : shiftTime(s.endTime, delta) !== null;
    if (canShiftStart && canShiftEnd) {
      shiftable.push(s);
    } else {
      skipped.push(s);
    }
  }
  return { shiftable, skipped };
}

export function useShiftProposal(siblingSchedules?: ScheduleResponse[]) {
  const [shiftDialogOpen, setShiftDialogOpen] = useState(false);
  const [shiftDelta, setShiftDelta] = useState(0);
  const [shiftSource, setShiftSource] = useState<"start" | "end">("start");
  const [shiftTargets, setShiftTargets] = useState<ScheduleResponse[]>([]);
  const [shiftSkipped, setShiftSkipped] = useState<ScheduleResponse[]>([]);

  const onShiftProposal =
    siblingSchedules && siblingSchedules.length > 0
      ? (timeDelta: TimeDelta) => {
          const { shiftable, skipped } = partitionShiftTargets(siblingSchedules, timeDelta.delta);
          if (shiftable.length > 0) {
            setShiftDelta(timeDelta.delta);
            setShiftSource(timeDelta.source);
            setShiftTargets(shiftable);
            setShiftSkipped(skipped);
            setShiftDialogOpen(true);
          }
        }
      : undefined;

  return {
    shiftDialogOpen,
    setShiftDialogOpen,
    shiftDelta,
    shiftSource,
    shiftTargets,
    shiftSkipped,
    onShiftProposal,
  };
}

export function TimelineNode({
  variant,
  icon: Icon,
  isFirst,
  isLast,
  colorClasses,
}: {
  variant: "place" | "transport";
  icon: React.ComponentType<{ className?: string }>;
  isFirst?: boolean;
  isLast?: boolean;
  colorClasses: (typeof SCHEDULE_COLOR_CLASSES)[ScheduleColor];
}) {
  const isPlace = variant === "place";
  const nodeSize = isPlace ? "h-7 w-7" : "h-5 w-5";
  const iconSize = isPlace ? "h-3.5 w-3.5" : "h-2.5 w-2.5";

  const lineSegment = (hidden: boolean) => (
    <div
      className={cn(
        "w-px flex-1",
        hidden ? "border-transparent" : cn("border-l border-solid", colorClasses.border),
      )}
    />
  );

  return (
    <div className={cn("flex flex-col items-center", !isPlace && "w-7")} aria-hidden="true">
      {lineSegment(!!isFirst)}
      <div className="relative flex shrink-0 items-center justify-center">
        <div
          className={cn(
            "relative flex items-center justify-center rounded-full",
            nodeSize,
            isPlace
              ? cn("text-white", colorClasses.bg)
              : cn("border-2 bg-background", colorClasses.border),
          )}
        >
          <Icon className={cn(iconSize, !isPlace && colorClasses.text)} />
        </div>
      </div>
      {lineSegment(!!isLast)}
    </div>
  );
}

export function ScheduleItemDialogs({
  tripId,
  dayId,
  patternId,
  schedule,
  editOpen,
  onEditOpenChange,
  onSaved,
  onUpdate,
  maxEndDayOffset,
  shift,
  mapsEnabled,
}: {
  tripId: string;
  dayId: string;
  patternId: string;
  schedule: {
    id: string;
    name: string;
    category: ScheduleCategory;
    address?: string | null;
    urls: string[];
    startTime?: string | null;
    endTime?: string | null;
    endDayOffset?: number | null;
    memo?: string | null;
    departurePlace?: string | null;
    arrivalPlace?: string | null;
    transportMethod?: string | null;
    cost?: number | null;
    color?: ScheduleColor;
    updatedAt: string;
  };
  editOpen: boolean;
  onEditOpenChange: (open: boolean) => void;
  // Skip-refetch success path (cache already reconciled); see EditScheduleDialog.
  onSaved: () => void;
  // Refetch path: conflict/cache-evict recovery and post-batch-shift sync.
  onUpdate: () => void;
  maxEndDayOffset?: number;
  shift: ReturnType<typeof useShiftProposal>;
  mapsEnabled?: boolean;
}) {
  return (
    <>
      <EditScheduleDialog
        tripId={tripId}
        dayId={dayId}
        patternId={patternId}
        schedule={{
          ...schedule,
          color: schedule.color ?? "blue",
          urls: schedule.urls,
          sortOrder: 0,
        }}
        open={editOpen}
        onOpenChange={onEditOpenChange}
        onSaved={onSaved}
        onConflict={onUpdate}
        maxEndDayOffset={maxEndDayOffset}
        onShiftProposal={shift.onShiftProposal}
        mapsEnabled={mapsEnabled}
      />
      <BatchShiftDialog
        open={shift.shiftDialogOpen}
        onOpenChange={shift.setShiftDialogOpen}
        tripId={tripId}
        dayId={dayId}
        patternId={patternId}
        scheduleName={schedule.name}
        deltaMinutes={shift.shiftDelta}
        deltaSource={shift.shiftSource}
        targetSchedules={shift.shiftTargets}
        skippedSchedules={shift.shiftSkipped}
        onDone={onUpdate}
      />
    </>
  );
}

function useCrossDayTranslations() {
  const tc = useTranslations("crossDay");
  return {
    hotelCheckin: tc("hotelCheckin"),
    hotelStaying: tc("hotelStaying"),
    hotelCheckout: tc("hotelCheckout"),
    genericStart: tc("genericStart"),
    genericContinuing: tc("genericContinuing"),
    genericEnd: tc("genericEnd"),
  };
}

export function ScheduleTimeLabel({
  crossDayDisplay,
  crossDayPosition,
  endDayOffset,
  category,
  timeStr,
}: {
  crossDayDisplay?: boolean;
  crossDayPosition?: "intermediate" | "final";
  endDayOffset?: number | null;
  category: ScheduleCategory;
  timeStr: string;
}) {
  const crossDayT = useCrossDayTranslations();
  const labelText = crossDayDisplay
    ? crossDayPosition
      ? getCrossDayLabel(category, crossDayPosition, crossDayT)
      : null
    : endDayOffset != null && endDayOffset > 0
      ? getStartDayLabel(category, crossDayT)
      : null;

  const labelEl = labelText ? (
    <span className="shrink-0 whitespace-nowrap rounded-sm bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
      {labelText}
    </span>
  ) : null;

  const timeEl = !timeStr ? null : crossDayDisplay ? (
    <span className="flex items-center gap-1 text-xs text-muted-foreground">
      <Clock className="h-3 w-3 shrink-0 text-muted-foreground/70" />~ {timeStr}
    </span>
  ) : (
    <span className="flex items-center gap-1 text-xs text-muted-foreground">
      <Clock className="h-3 w-3 shrink-0 text-muted-foreground/70" />
      {timeStr}
      {endDayOffset != null && endDayOffset > 0 ? " ~" : ""}
    </span>
  );

  if (!labelEl && !timeEl) return null;
  return (
    <div className="mt-0.5 flex items-center gap-1.5">
      {labelEl}
      {timeEl}
    </div>
  );
}

export function ScheduleLinks({ urls, memo }: { urls: string[]; memo?: string | null }) {
  const safeUrls = urls.filter(isSafeUrl);
  if (safeUrls.length === 0 && !memo) return null;
  return (
    <>
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
      {memo && (
        <div className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <StickyNote className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground/70" />
          <p className="whitespace-pre-line" translate="yes">
            {memo}
          </p>
        </div>
      )}
    </>
  );
}

export function cardBodyProps(
  id: string,
  name: string,
  category: ScheduleCategory,
  selectable?: boolean,
  selected?: boolean,
  onSelect?: (id: string) => void,
  crossDayDisplay?: boolean,
  crossDaySourceDayNumber?: number,
  crossDayPosition?: "intermediate" | "final",
  crossDayAriaFallback?: string,
  crossDayTranslations?: {
    hotelCheckin: string;
    hotelStaying: string;
    hotelCheckout: string;
    genericStart: string;
    genericContinuing: string;
    genericEnd: string;
  },
): Record<string, unknown> {
  if (selectable) {
    return {
      onClick: () => onSelect?.(id),
      "aria-pressed": selected,
    };
  }
  if (crossDayDisplay && crossDaySourceDayNumber) {
    const t = crossDayTranslations ?? {
      hotelCheckin: "Check-in",
      hotelStaying: "Staying",
      hotelCheckout: "Checkout",
      genericStart: "Start",
      genericContinuing: "Continuing",
      genericEnd: "End",
    };
    return {
      role: "group" as const,
      "aria-label": `${getCrossDayLabel(category, crossDayPosition ?? "intermediate", t) ?? crossDayAriaFallback ?? ""}: ${name}`,
    };
  }
  return {};
}
