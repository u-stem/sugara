"use client";

import { useTranslations } from "next-intl";
import { useSession } from "@/lib/auth-client";
import { isGuestUser } from "@/lib/guest";
import { cn } from "@/lib/utils";

export type RightPanelTab =
  | "candidates"
  | "activity"
  | "bookmarks"
  | "articles"
  | "expenses"
  | "souvenirs"
  | "map";

const CHIP_BASE =
  "shrink-0 whitespace-nowrap rounded-full px-3.5 py-1.5 text-center text-sm font-medium transition-[colors,transform] active:scale-[0.95]";
const CHIP_ACTIVE = "bg-muted text-foreground";
const CHIP_INACTIVE = "bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground";

export function RightPanelTabs({
  current,
  onChange,
  candidateCount,
  mapsEnabled = false,
}: {
  current: RightPanelTab;
  onChange: (tab: RightPanelTab) => void;
  candidateCount: number;
  mapsEnabled?: boolean;
}) {
  const { data: session } = useSession();
  const isGuest = isGuestUser(session);
  const t = useTranslations("schedule");

  return (
    <div
      className="flex shrink-0 select-none gap-1.5 overflow-x-auto border-b px-3 pb-2.5 pt-3"
      role="tablist"
      aria-label={t("panelTabs")}
    >
      <button
        type="button"
        role="tab"
        aria-selected={current === "candidates"}
        onClick={() => onChange("candidates")}
        className={cn(CHIP_BASE, current === "candidates" ? CHIP_ACTIVE : CHIP_INACTIVE)}
      >
        {t("candidates")}
        {candidateCount > 0 && <span className="ml-1 text-xs">{candidateCount}</span>}
      </button>
      {mapsEnabled && (
        <button
          type="button"
          role="tab"
          aria-selected={current === "map"}
          onClick={() => onChange("map")}
          className={cn(CHIP_BASE, current === "map" ? CHIP_ACTIVE : CHIP_INACTIVE)}
        >
          {t("map")}
          <span className="ml-1 text-[10px] font-semibold opacity-60">β</span>
        </button>
      )}
      <button
        type="button"
        role="tab"
        aria-selected={current === "expenses"}
        onClick={() => onChange("expenses")}
        className={cn(CHIP_BASE, current === "expenses" ? CHIP_ACTIVE : CHIP_INACTIVE)}
      >
        {t("expenses")}
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={current === "activity"}
        onClick={() => onChange("activity")}
        className={cn(CHIP_BASE, current === "activity" ? CHIP_ACTIVE : CHIP_INACTIVE)}
      >
        {t("history")}
      </button>
      <div className="shrink-0 self-stretch w-px bg-border" />
      <button
        type="button"
        role="tab"
        aria-selected={current === "souvenirs"}
        onClick={() => onChange("souvenirs")}
        className={cn(CHIP_BASE, current === "souvenirs" ? CHIP_ACTIVE : CHIP_INACTIVE)}
      >
        {t("souvenirs")}
      </button>
      {!isGuest && (
        <button
          type="button"
          role="tab"
          aria-selected={current === "bookmarks"}
          onClick={() => onChange("bookmarks")}
          className={cn(CHIP_BASE, current === "bookmarks" ? CHIP_ACTIVE : CHIP_INACTIVE)}
        >
          {t("bookmarks")}
        </button>
      )}
      {!isGuest && (
        <button
          type="button"
          role="tab"
          aria-selected={current === "articles"}
          onClick={() => onChange("articles")}
          className={cn(CHIP_BASE, current === "articles" ? CHIP_ACTIVE : CHIP_INACTIVE)}
        >
          {t("articles")}
        </button>
      )}
    </div>
  );
}
