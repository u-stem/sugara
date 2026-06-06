"use client";

import { useDroppable } from "@dnd-kit/core";
import type {
  CandidateResponse,
  DayResponse,
  ScheduleResponse,
  TripResponse,
} from "@sugara/shared";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowUpDown,
  Bookmark,
  Copy,
  GripVertical,
  MoreHorizontal,
  Plus,
  SquareMousePointer,
  Trash2,
  X,
} from "lucide-react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
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
import { useSelection } from "@/lib/hooks/selection-context";
import { useMobile } from "@/lib/hooks/use-is-mobile";
import { queryKeys } from "@/lib/query-keys";
import { moveCandidateToSchedule, removeCandidate } from "@/lib/trip-cache";
import { CandidateList } from "./candidate-list";

const AddCandidateDialog = dynamic(() =>
  import("@/components/add-candidate-dialog").then((mod) => mod.AddCandidateDialog),
);

const EditCandidateDialog = dynamic(() =>
  import("@/components/edit-candidate-dialog").then((mod) => mod.EditCandidateDialog),
);

const DayPickerDrawer = dynamic(() =>
  import("@/components/day-picker-drawer").then((mod) => mod.DayPickerDrawer),
);

type CandidatePanelProps = {
  tripId: string;
  candidates: CandidateResponse[];
  currentDayId?: string;
  currentPatternId?: string;
  onRefresh: () => void;
  disabled?: boolean;
  draggable?: boolean;
  scheduleLimitReached?: boolean;
  scheduleLimitMessage?: string;
  addDialogOpen?: boolean;
  onAddDialogOpenChange?: (open: boolean) => void;
  overCandidateId?: string | null;
  maxEndDayOffset?: number;
  onSaveToBookmark?: (scheduleIds: string[]) => void;
  onReorderCandidate?: (id: string, direction: "up" | "down") => void;
  days?: DayResponse[];
  // Trip currency (whole-unit) for formatting transport candidate fares.
  currency?: string;
};

export function CandidatePanel({
  tripId,
  candidates,
  currentDayId,
  currentPatternId,
  onRefresh,
  disabled,
  draggable,
  scheduleLimitReached,
  scheduleLimitMessage,
  addDialogOpen: controlledAddOpen,
  onAddDialogOpenChange: controlledOnAddOpenChange,
  overCandidateId,
  maxEndDayOffset = 0,
  onSaveToBookmark,
  onReorderCandidate,
  days,
  currency,
}: CandidatePanelProps) {
  const tm = useTranslations("messages");
  const tc = useTranslations("common");
  const tsch = useTranslations("schedule");
  const queryClient = useQueryClient();
  const cacheKey = queryKeys.trips.detail(tripId);

  const sel = useSelection();
  const selectionMode = sel.selectionTarget === "candidates";
  const selectedIds = selectionMode ? sel.selectedIds : undefined;
  const { setNodeRef: setDroppableRef, isOver: isOverCandidates } = useDroppable({
    id: "candidates",
    data: { type: "candidates" },
  });
  const isMobile = useMobile();
  const [reorderMode, setReorderMode] = useState(false);
  const [dayPickerOpen, setDayPickerOpen] = useState(false);
  const [assignPendingSpotId, setAssignPendingSpotId] = useState<string | null>(null);
  const [internalAddOpen, setInternalAddOpen] = useState(false);
  const addOpen = controlledAddOpen ?? internalAddOpen;
  const setAddOpen = controlledOnAddOpenChange ?? setInternalAddOpen;
  const [editSchedule, setEditSchedule] = useState<ScheduleResponse | null>(null);
  const [sortBy, setSortBy] = useState<"order" | "popular">("order");

  const sortedCandidates = useMemo(() => {
    if (sortBy === "popular") {
      return [...candidates].sort((a, b) => {
        const diff = b.likeCount - a.likeCount;
        if (diff !== 0) return diff;
        return a.hmmCount - b.hmmCount;
      });
    }
    return candidates;
  }, [candidates, sortBy]);

  const hasDayContext = !!currentDayId && !!currentPatternId;

  async function handleAssign(spotId: string, dayId?: string, patternId?: string) {
    const targetDayId = dayId ?? currentDayId;
    const targetPatternId = patternId ?? currentPatternId;
    if (!targetDayId || !targetPatternId) return;
    await queryClient.cancelQueries({ queryKey: cacheKey });
    const prev = queryClient.getQueryData<TripResponse>(cacheKey);
    if (prev) {
      queryClient.setQueryData(
        cacheKey,
        moveCandidateToSchedule(prev, spotId, targetDayId, targetPatternId),
      );
    }
    toast.success(tm("candidateAssigned"));

    try {
      await api(`/api/trips/${tripId}/candidates/${spotId}/assign`, {
        method: "POST",
        body: JSON.stringify({ dayPatternId: targetPatternId }),
      });
      onRefresh();
    } catch {
      if (prev) queryClient.setQueryData(cacheKey, prev);
      toast.error(tm("candidateAssignFailed"));
    }
  }

  async function handleDelete(spotId: string) {
    await queryClient.cancelQueries({ queryKey: cacheKey });
    const prev = queryClient.getQueryData<TripResponse>(cacheKey);
    if (prev) {
      queryClient.setQueryData(cacheKey, removeCandidate(prev, spotId));
    }
    toast.success(tm("candidateDeleted"));

    try {
      await api(`/api/trips/${tripId}/candidates/${spotId}`, {
        method: "DELETE",
      });
      onRefresh();
    } catch {
      if (prev) queryClient.setQueryData(cacheKey, prev);
      toast.error(tm("candidateDeleteFailed"));
    }
  }

  async function handleReact(scheduleId: string, type: "like" | "hmm") {
    await queryClient.cancelQueries({ queryKey: cacheKey });
    const prev = queryClient.getQueryData<TripResponse>(cacheKey);
    queryClient.setQueryData(cacheKey, (old: TripResponse | undefined) => {
      if (!old) return old;
      return {
        ...old,
        candidates: old.candidates.map((c) => {
          if (c.id !== scheduleId) return c;
          const prevReaction = c.myReaction;
          return {
            ...c,
            myReaction: type,
            likeCount: c.likeCount + (type === "like" ? 1 : 0) - (prevReaction === "like" ? 1 : 0),
            hmmCount: c.hmmCount + (type === "hmm" ? 1 : 0) - (prevReaction === "hmm" ? 1 : 0),
          };
        }),
      };
    });
    try {
      await api(`/api/trips/${tripId}/candidates/${scheduleId}/reaction`, {
        method: "PUT",
        body: JSON.stringify({ type }),
      });
      onRefresh();
    } catch {
      if (prev) queryClient.setQueryData(cacheKey, prev);
      toast.error(tm("reactionFailed"));
    }
  }

  async function handleRemoveReaction(scheduleId: string) {
    await queryClient.cancelQueries({ queryKey: cacheKey });
    const prev = queryClient.getQueryData<TripResponse>(cacheKey);
    queryClient.setQueryData(cacheKey, (old: TripResponse | undefined) => {
      if (!old) return old;
      return {
        ...old,
        candidates: old.candidates.map((c) => {
          if (c.id !== scheduleId) return c;
          return {
            ...c,
            myReaction: null,
            likeCount: c.likeCount - (c.myReaction === "like" ? 1 : 0),
            hmmCount: c.hmmCount - (c.myReaction === "hmm" ? 1 : 0),
          };
        }),
      };
    });
    try {
      await api(`/api/trips/${tripId}/candidates/${scheduleId}/reaction`, {
        method: "DELETE",
      });
      onRefresh();
    } catch {
      if (prev) queryClient.setQueryData(cacheKey, prev);
      toast.error(tm("reactionRemoveFailed"));
    }
  }

  function handleAssignSpot(spotId: string) {
    if (isMobile && days) {
      setAssignPendingSpotId(spotId);
      setDayPickerOpen(true);
    } else {
      handleAssign(spotId);
    }
  }

  const selectedCount = selectedIds?.size ?? 0;

  return (
    <div>
      {selectionMode ? (
        <div className="mb-2 flex items-center gap-1.5 rounded-lg bg-muted px-1.5 py-1">
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
            onClick={selectedCount === candidates.length ? sel.deselectAll : sel.selectAll}
          >
            {selectedCount === candidates.length ? tc("deselectAll") : tc("selectAll")}
          </Button>
          <div className="ml-auto flex items-center gap-1">
            {hasDayContext && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 px-2 text-xs"
                onClick={sel.batchAssign}
                disabled={selectedCount === 0 || sel.batchLoading}
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                {tsch("addToSchedule")}
              </Button>
            )}
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
                <DropdownMenuItem onClick={sel.batchDuplicateCandidates}>
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
        <div className="mb-2 flex items-center gap-1.5 rounded-lg bg-muted px-1.5 py-1">
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
        <div className="mb-2 flex items-center gap-1.5">
          <div className="flex flex-1 items-center gap-1.5 [&>*]:flex-1 lg:flex-initial lg:ml-auto lg:[&>*]:flex-initial">
            {!disabled &&
              !isMobile &&
              (scheduleLimitReached ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span>
                      <Button variant="outline" size="sm" className="w-full" disabled>
                        <Plus className="h-4 w-4" />
                        {tsch("addCandidate")}
                        <span className="hidden text-xs text-muted-foreground lg:inline">(C)</span>
                      </Button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>{scheduleLimitMessage}</TooltipContent>
                </Tooltip>
              ) : (
                <Button variant="outline" size="sm" onClick={() => setAddOpen(true)}>
                  <Plus className="h-4 w-4" />
                  {tsch("addCandidate")}
                  <span className="hidden text-xs text-muted-foreground lg:inline">(C)</span>
                </Button>
              ))}
            {!disabled && candidates.length > 0 && sel.canEnter && (
              <Button
                variant="outline"
                size="sm"
                className="h-9"
                onClick={() => {
                  setReorderMode(false);
                  sel.enter("candidates");
                }}
              >
                <SquareMousePointer className="h-4 w-4" />
                {tc("select")}
              </Button>
            )}
            {!disabled && isMobile && candidates.length > 1 && onReorderCandidate && (
              <Button
                variant="outline"
                size="sm"
                className="h-9"
                onClick={() => {
                  sel.exit();
                  setSortBy("order");
                  setReorderMode(true);
                }}
              >
                <GripVertical className="h-4 w-4" />
                {tc("sort")}
              </Button>
            )}
            {candidates.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="h-9"
                onClick={() => setSortBy(sortBy === "popular" ? "order" : "popular")}
              >
                <ArrowUpDown className="h-4 w-4" />
                {sortBy === "popular" ? tsch("popular") : tsch("newest")}
              </Button>
            )}
          </div>
        </div>
      )}

      <CandidateList
        candidates={sortedCandidates}
        currency={currency}
        draggable={draggable}
        droppableRef={setDroppableRef}
        isOverCandidates={isOverCandidates}
        overCandidateId={overCandidateId}
        isMobile={isMobile}
        reorderMode={reorderMode}
        disabled={disabled}
        selectionMode={selectionMode}
        selectedIds={selectedIds}
        onToggle={sel.toggle}
        onEdit={setEditSchedule}
        onDelete={handleDelete}
        onAssign={hasDayContext ? handleAssignSpot : undefined}
        onReact={handleReact}
        onRemoveReaction={handleRemoveReaction}
        onSaveToBookmark={onSaveToBookmark}
        onReorderCandidate={onReorderCandidate}
      />

      <AddCandidateDialog
        tripId={tripId}
        open={addOpen}
        onOpenChange={setAddOpen}
        onAdd={onRefresh}
        maxEndDayOffset={maxEndDayOffset}
      />

      {editSchedule && (
        <EditCandidateDialog
          tripId={tripId}
          schedule={editSchedule}
          open={editSchedule !== null}
          onOpenChange={(open) => {
            if (!open) setEditSchedule(null);
          }}
          onUpdate={onRefresh}
          maxEndDayOffset={maxEndDayOffset}
        />
      )}

      {isMobile && hasDayContext && days && days.length > 0 && (
        <DayPickerDrawer
          open={dayPickerOpen}
          onOpenChange={(open) => {
            setDayPickerOpen(open);
            if (!open) setAssignPendingSpotId(null);
          }}
          days={days.map((d, i) => ({
            id: d.id,
            date: d.date,
            dayIndex: i,
          }))}
          defaultDayIndex={Math.max(
            0,
            days.findIndex((d) => d.id === currentDayId),
          )}
          patternsByDayId={Object.fromEntries(
            days.map((d) => {
              // put the default pattern first so the drawer pre-selects it
              const sorted = [...d.patterns].sort((a, b) => {
                if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
                return a.sortOrder - b.sortOrder;
              });
              return [d.id, sorted.map((p) => ({ id: p.id, label: p.label }))];
            }),
          )}
          onConfirm={(dayId, patternId) => {
            if (assignPendingSpotId) {
              handleAssign(assignPendingSpotId, dayId, patternId ?? currentPatternId);
            }
            setAssignPendingSpotId(null);
          }}
        />
      )}
    </div>
  );
}
