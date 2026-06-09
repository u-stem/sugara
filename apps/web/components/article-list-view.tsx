"use client";

import { MAX_ARTICLES_PER_USER } from "@sugara/shared";
import { Globe, ListFilter, Lock, Plus, SquareMousePointer, Trash2, Users, X } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type React from "react";
import { useEffect, useState } from "react";
import { ActionSheet } from "@/components/action-sheet";
import { ArticleCard } from "@/components/article-card";
import { ArticleEditorDialog } from "@/components/article-editor-dialog";
import { Fab } from "@/components/fab";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingBoundary } from "@/components/ui/loading-boundary";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useSession } from "@/lib/auth-client";
import { pageTitle } from "@/lib/constants";
import { isGuestUser } from "@/lib/guest";
import { type ArticleVisibilityFilter, useArticles } from "@/lib/hooks/use-articles";
import { useMobile } from "@/lib/hooks/use-is-mobile";
import { useOnlineStatus } from "@/lib/hooks/use-online-status";

function ArticlesSkeleton() {
  return (
    <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {["s1", "s2", "s3"].map((key) => (
        <div key={key} className="rounded-lg border bg-card p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
          <Skeleton className="mt-4 h-4 w-40" />
        </div>
      ))}
    </div>
  );
}

type ArticleListViewProps = {
  /** Link prefix for cards. "/articles" (PC) or "/sp/articles" (SP). */
  hrefPrefix?: string;
};

export function ArticleListView({ hrefPrefix = "/articles" }: ArticleListViewProps) {
  const ta = useTranslations("article");
  const tc = useTranslations("common");
  const tlVis = useTranslations("labels.visibility");
  const online = useOnlineStatus();
  const { data: session } = useSession();
  const isGuest = isGuestUser(session);
  const isMobile = useMobile();

  const {
    articles,
    filteredArticles,
    isLoading,
    error,
    visibilityFilter,
    setVisibilityFilter,
    createDialogOpen,
    setCreateDialogOpen,
    invalidateArticles,
    sel,
  } = useArticles(isGuest);

  const [visibilitySheetOpen, setVisibilitySheetOpen] = useState(false);

  useEffect(() => {
    document.title = pageTitle(ta("pageTitle"));
  }, [ta]);

  const filters: { value: ArticleVisibilityFilter; label: string; icon: React.ReactNode }[] = [
    { value: "all", label: ta("filterAll"), icon: <ListFilter className="h-4 w-4" /> },
    { value: "public", label: ta("filterPublic"), icon: <Globe className="h-4 w-4" /> },
    { value: "friends_only", label: tlVis("friends_only"), icon: <Users className="h-4 w-4" /> },
    { value: "private", label: tlVis("private"), icon: <Lock className="h-4 w-4" /> },
  ];

  if (isGuest) {
    return (
      <div className="mx-auto mt-4 max-w-2xl">
        <div className="rounded-lg border bg-muted/50 p-8 text-center">
          <p className="text-sm text-muted-foreground">{ta("createDescription")}</p>
          <Button asChild className="mt-4">
            <Link href="/auth/signup">{ta("signupCta")}</Link>
          </Button>
        </div>
      </div>
    );
  }

  const atLimit = articles.length >= MAX_ARTICLES_PER_USER;

  // --- Selection toolbar (shared between PC and SP) ---
  const selectionBar = (
    <div className="flex h-8 select-none items-center gap-1.5 rounded-lg bg-muted px-1.5">
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        onClick={sel.exit}
        disabled={sel.batchLoading}
        aria-label={tc("endSelection")}
      >
        <X className="h-4 w-4" aria-hidden />
      </Button>
      <span className="text-xs font-medium">
        {tc("selectedCount", { count: sel.selectedIds.size })}
      </span>
      <Button
        variant="ghost"
        size="sm"
        className="h-8 px-2 text-xs"
        onClick={sel.selectedIds.size === filteredArticles.length ? sel.deselectAll : sel.selectAll}
        disabled={sel.batchLoading || filteredArticles.length === 0}
      >
        {sel.selectedIds.size === filteredArticles.length ? tc("deselectAll") : tc("selectAll")}
      </Button>
      <div className="ml-auto flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          className="h-8 px-2 text-xs text-destructive"
          disabled={sel.selectedIds.size === 0 || sel.batchLoading}
          onClick={() => sel.setBatchDeleteOpen(true)}
        >
          <Trash2 className="h-4 w-4" aria-hidden />
          {tc("delete")}
        </Button>
      </div>
    </div>
  );

  return (
    <>
      <LoadingBoundary
        isLoading={isLoading}
        skeleton={<ArticlesSkeleton />}
        error={error}
        errorFallback={
          <div className="mt-8 text-center">
            <p className="text-destructive">{ta("fetchFailed")}</p>
            <Button variant="outline" size="sm" className="mt-4" onClick={invalidateArticles}>
              {tc("retry")}
            </Button>
          </div>
        }
      >
        <div className="mt-4">
          {isMobile ? (
            // --- SP branch ---
            sel.selectionMode ? (
              selectionBar
            ) : (
              <div className="flex gap-2">
                <button
                  type="button"
                  aria-label={ta("filterByVisibility")}
                  onClick={(e) => {
                    e.currentTarget.blur();
                    setVisibilitySheetOpen(true);
                  }}
                  className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md border bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {filters.find((f) => f.value === visibilityFilter)?.icon}
                  {filters.find((f) => f.value === visibilityFilter)?.label ?? ta("filterAll")}
                </button>
                <ActionSheet
                  open={visibilitySheetOpen}
                  onOpenChange={setVisibilitySheetOpen}
                  actions={filters.map((f) => ({
                    label: f.label,
                    icon: f.icon,
                    onClick: () => setVisibilityFilter(f.value),
                  }))}
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 flex-1"
                  onClick={sel.enter}
                  disabled={!online || filteredArticles.length === 0}
                  aria-label={tc("selectionMode")}
                >
                  <SquareMousePointer className="h-4 w-4" aria-hidden />
                  {tc("select")}
                </Button>
              </div>
            )
          ) : // --- PC branch ---
          sel.selectionMode ? (
            selectionBar
          ) : (
            <div className="flex items-center gap-2">
              <Select
                value={visibilityFilter}
                onValueChange={(v) => setVisibilityFilter(v as ArticleVisibilityFilter)}
              >
                <SelectTrigger
                  className="h-8 w-[130px] text-xs"
                  aria-label={ta("filterByVisibility")}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {filters.map((f) => (
                    <SelectItem key={f.value} value={f.value}>
                      <span className="flex items-center gap-2">
                        {f.icon}
                        {f.label}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="ml-auto flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={sel.enter}
                  disabled={!online || filteredArticles.length === 0}
                >
                  <SquareMousePointer className="h-4 w-4" aria-hidden />
                  {tc("select")}
                </Button>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span>
                      <Button
                        size="sm"
                        disabled={!online || atLimit}
                        onClick={() => setCreateDialogOpen(true)}
                      >
                        <Plus className="h-4 w-4" aria-hidden />
                        {ta("new")}
                      </Button>
                    </span>
                  </TooltipTrigger>
                  {atLimit && (
                    <TooltipContent>
                      {ta("limitReached", { max: MAX_ARTICLES_PER_USER })}
                    </TooltipContent>
                  )}
                </Tooltip>
              </div>
            </div>
          )}
        </div>

        {articles.length === 0 ? (
          <EmptyState message={ta("empty")} variant="page" />
        ) : filteredArticles.length === 0 ? (
          <EmptyState message={ta("emptyFilter")} variant="page" />
        ) : (
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filteredArticles.map((article, index) => (
              <div
                key={article.id}
                className="animate-in fade-in duration-300"
                style={{
                  animationDelay: `${Math.min(index * 50, 300)}ms`,
                  animationFillMode: "both",
                }}
              >
                <ArticleCard
                  {...article}
                  hrefPrefix={hrefPrefix}
                  selectable={sel.selectionMode}
                  selected={sel.selectedIds.has(article.id)}
                  onSelect={sel.toggle}
                />
              </div>
            ))}
          </div>
        )}
      </LoadingBoundary>

      <ResponsiveAlertDialog open={sel.batchDeleteOpen} onOpenChange={sel.setBatchDeleteOpen}>
        <ResponsiveAlertDialogContent>
          <ResponsiveAlertDialogHeader>
            <ResponsiveAlertDialogTitle>
              {ta("batchDeleteTitle", { count: sel.selectedIds.size })}
            </ResponsiveAlertDialogTitle>
            <ResponsiveAlertDialogDescription>
              {ta("batchDeleteDescription")}
            </ResponsiveAlertDialogDescription>
          </ResponsiveAlertDialogHeader>
          <ResponsiveAlertDialogFooter>
            <ResponsiveAlertDialogCancel>
              <X className="h-4 w-4" aria-hidden />
              {tc("cancel")}
            </ResponsiveAlertDialogCancel>
            <ResponsiveAlertDialogDestructiveAction onClick={sel.handleBatchDelete}>
              <Trash2 className="h-4 w-4" aria-hidden />
              {ta("deleteConfirm")}
            </ResponsiveAlertDialogDestructiveAction>
          </ResponsiveAlertDialogFooter>
        </ResponsiveAlertDialogContent>
      </ResponsiveAlertDialog>

      <ArticleEditorDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        onSaved={invalidateArticles}
      />
      <Fab
        onClick={() => setCreateDialogOpen(true)}
        label={ta("createFab")}
        hidden={!online || atLimit || sel.selectionMode}
      />
    </>
  );
}
