"use client";

import { MAX_ARTICLES_PER_USER } from "@sugara/shared";
import { Globe, ListFilter, Lock, Plus, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import type React from "react";
import { useEffect } from "react";
import { ArticleCard } from "@/components/article-card";
import { ArticleEditorDialog } from "@/components/article-editor-dialog";
import { Fab } from "@/components/fab";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingBoundary } from "@/components/ui/loading-boundary";
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
import { useOnlineStatus } from "@/lib/hooks/use-online-status";

function ArticlesSkeleton() {
  return (
    <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {["s1", "s2", "s3"].map((key) => (
        <div key={key} className="rounded-lg border bg-card p-6 shadow-sm">
          <Skeleton className="h-5 w-32" />
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
  } = useArticles(isGuest);

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
        </div>
      </div>
    );
  }

  const atLimit = articles.length >= MAX_ARTICLES_PER_USER;

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
        <div className="mt-4 flex items-center gap-2">
          <Select
            value={visibilityFilter}
            onValueChange={(v) => setVisibilityFilter(v as ArticleVisibilityFilter)}
          >
            <SelectTrigger className="h-8 w-[130px] text-xs" aria-label={ta("filterByVisibility")}>
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
          <div className="ml-auto">
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Button
                    size="sm"
                    disabled={!online || atLimit}
                    onClick={() => setCreateDialogOpen(true)}
                  >
                    <Plus className="h-4 w-4" />
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
                <ArticleCard {...article} hrefPrefix={hrefPrefix} />
              </div>
            ))}
          </div>
        )}
      </LoadingBoundary>

      <ArticleEditorDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        onSaved={invalidateArticles}
      />
      <Fab
        onClick={() => setCreateDialogOpen(true)}
        label={ta("createFab")}
        hidden={!online || atLimit}
      />
    </>
  );
}
