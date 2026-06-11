"use client";

import { SortableContext } from "@dnd-kit/sortable";
import type { CandidateResponse } from "@sugara/shared";
import { useTranslations } from "next-intl";
import { memo } from "react";
import { EmptyState } from "@/components/ui/empty-state";
import { DROP_ZONE_ACTIVE } from "@/lib/colors";
import { noShiftSortingStrategy } from "@/lib/dnd-sorting";
import { cn } from "@/lib/utils";
import { CandidateItem } from "./candidate-item";
import { DndInsertIndicator } from "./dnd-insert-indicator";

type CandidateListProps = {
  candidates: CandidateResponse[];
  // Trip currency (whole-unit) passed down to format transport candidate fares.
  currency?: string;
  draggable?: boolean;
  droppableRef: (node: HTMLElement | null) => void;
  isOverCandidates: boolean;
  overCandidateId?: string | null;
  isMobile: boolean;
  reorderMode: boolean;
  disabled?: boolean;
  selectionMode: boolean;
  selectedIds?: Set<string>;
  onToggle: (id: string) => void;
  onEdit: (spot: CandidateResponse) => void;
  onDelete: (spotId: string) => void;
  onAssign?: (spotId: string) => void;
  onReact: (spotId: string, type: "like" | "hmm") => void;
  onRemoveReaction: (spotId: string) => void;
  onSaveToBookmark?: (ids: string[]) => void;
  onReorderCandidate?: (id: string, direction: "up" | "down") => void;
};

export const CandidateList = memo(function CandidateList({
  candidates,
  currency,
  draggable,
  droppableRef,
  isOverCandidates,
  overCandidateId,
  isMobile,
  reorderMode,
  disabled,
  selectionMode,
  selectedIds,
  onToggle,
  onEdit,
  onDelete,
  onAssign,
  onReact,
  onRemoveReaction,
  onSaveToBookmark,
  onReorderCandidate,
}: CandidateListProps) {
  const tm = useTranslations("messages");
  function renderItems(withDndIndicators: boolean) {
    const overlayIndicator = withDndIndicators ? <DndInsertIndicator overlay /> : null;
    const inlineIndicator = withDndIndicators ? <DndInsertIndicator /> : null;

    return (
      <div className="space-y-1.5">
        {candidates.map((spot, idx) => {
          const isReorderable = isMobile && reorderMode && !disabled;
          const item = (
            <div
              key={spot.id}
              className={cn(
                withDndIndicators ? "relative" : undefined,
                "animate-in fade-in duration-300",
              )}
              style={{ animationDelay: `${Math.min(idx * 30, 300)}ms`, animationFillMode: "both" }}
            >
              {withDndIndicators && overCandidateId === spot.id && overlayIndicator}
              <CandidateItem
                spot={spot}
                currency={currency}
                onEdit={() => onEdit(spot)}
                onDelete={() => onDelete(spot.id)}
                onAssign={onAssign ? () => onAssign(spot.id) : undefined}
                onReact={(type) => onReact(spot.id, type)}
                onRemoveReaction={() => onRemoveReaction(spot.id)}
                onSaveToBookmark={onSaveToBookmark ? () => onSaveToBookmark([spot.id]) : undefined}
                disabled={disabled}
                draggable={withDndIndicators && !isMobile && !selectionMode}
                selectable={selectionMode}
                selected={selectedIds?.has(spot.id)}
                onSelect={onToggle}
                reorderable={isReorderable}
                onMoveUp={isReorderable ? () => onReorderCandidate?.(spot.id, "up") : undefined}
                onMoveDown={isReorderable ? () => onReorderCandidate?.(spot.id, "down") : undefined}
                isFirst={idx === 0}
                isLast={idx === candidates.length - 1}
              />
            </div>
          );
          return withDndIndicators ? item : <div key={spot.id}>{item}</div>;
        })}
        {withDndIndicators && isOverCandidates && overCandidateId === null && inlineIndicator}
      </div>
    );
  }

  if (draggable) {
    return (
      <div ref={droppableRef}>
        <SortableContext items={candidates.map((c) => c.id)} strategy={noShiftSortingStrategy}>
          {candidates.length === 0 ? (
            <div
              className={cn(
                "flex min-h-24 items-center justify-center rounded-md border border-dashed text-center transition-colors",
                isOverCandidates && DROP_ZONE_ACTIVE,
              )}
            >
              <p className="text-sm text-muted-foreground">{tm("emptyCandidate")}</p>
            </div>
          ) : (
            renderItems(true)
          )}
        </SortableContext>
      </div>
    );
  }

  if (candidates.length === 0) {
    return <EmptyState message={tm("emptyCandidate")} variant="box" />;
  }

  return renderItems(false);
});
