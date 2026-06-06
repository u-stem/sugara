"use client";

import { DAY_MEMO_MAX_LENGTH } from "@sugara/shared";
import { Check, MessageSquare, Pencil, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { useDayMemo } from "@/lib/hooks/use-day-memo";
import { linkifyText } from "@/lib/linkify";
import { cn } from "@/lib/utils";

type Memo = ReturnType<typeof useDayMemo>;

export function DayMemoEditor({
  memo,
  currentDayId,
  currentDayMemo,
  canEdit,
  online,
}: {
  memo: Memo;
  currentDayId: string;
  currentDayMemo: string | null | undefined;
  canEdit: boolean;
  online: boolean;
}) {
  const tc = useTranslations("common");
  const tsch = useTranslations("schedule");

  const interactive = canEdit && online;

  return (
    <div className="mb-3">
      {memo.editingDayId === currentDayId ? (
        <div className="space-y-2">
          <Textarea
            value={memo.text}
            onChange={(e) => memo.setText(e.target.value)}
            placeholder={tsch("memoPlaceholder")}
            maxLength={DAY_MEMO_MAX_LENGTH}
            rows={3}
            className="resize-none"
            autoFocus
          />
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              {memo.text.length}/{DAY_MEMO_MAX_LENGTH}
            </span>
            <div className="flex gap-1.5">
              <Button variant="ghost" size="sm" onClick={memo.cancelEdit} disabled={memo.saving}>
                <X className="h-3.5 w-3.5" />
                {tc("cancel")}
              </Button>
              <Button size="sm" onClick={memo.save} disabled={memo.saving}>
                <Check className="h-3.5 w-3.5" />
                {memo.saving ? tsch("memoSaving") : tsch("memoSave")}
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div
          className={cn(
            "flex w-full items-start gap-2 rounded-md border border-dashed px-3 py-2 text-sm transition-colors",
            currentDayMemo
              ? "border-border text-foreground"
              : "border-muted-foreground/20 text-muted-foreground",
          )}
        >
          <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {currentDayMemo ? (
            // Memo text links its URLs; editing is moved to a dedicated button so
            // clicking a link no longer opens the editor.
            <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">
              {linkifyText(currentDayMemo)}
            </span>
          ) : interactive ? (
            <button
              type="button"
              onClick={() => memo.startEdit(currentDayId, currentDayMemo)}
              className="flex-1 cursor-pointer select-none text-left"
            >
              {tsch("memoAdd")}
            </button>
          ) : (
            <span className="flex-1 select-none">{tsch("memoAdd")}</span>
          )}
          {currentDayMemo && interactive && (
            <button
              type="button"
              onClick={() => memo.startEdit(currentDayId, currentDayMemo)}
              aria-label={tc("edit")}
              className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
