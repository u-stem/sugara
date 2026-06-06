"use client";

import type { ArticleResponse, TripListItem } from "@sugara/shared";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Heart, MoreHorizontal, Pencil, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ArticleEditorDialog } from "@/components/article-editor-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { Skeleton } from "@/components/ui/skeleton";
import { api, apiVoid, getApiErrorMessage } from "@/lib/api";
import { useSession } from "@/lib/auth-client";
import { pageTitle } from "@/lib/constants";
import { useArticleLike } from "@/lib/hooks/use-article-like";
import { MarkdownRenderer } from "@/lib/markdown";
import { queryKeys } from "@/lib/query-keys";

type ArticleDetailViewProps = {
  articleId: string;
  /** Route prefix for back link / post-delete navigation. "/articles" or "/sp/articles". */
  basePath?: string;
};

export function ArticleDetailView({ articleId, basePath = "/articles" }: ArticleDetailViewProps) {
  const ta = useTranslations("article");
  const tc = useTranslations("common");
  const tlVis = useTranslations("labels.visibility");
  const router = useRouter();
  const { data: session } = useSession();
  const { toggleLike } = useArticleLike();

  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const {
    data: article,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: queryKeys.articles.detail(articleId),
    queryFn: () => api<ArticleResponse>(`/api/articles/${articleId}`),
  });

  const isOwner = !!article && session?.user?.id === article.ownerId;

  // Owner-only: resolve linked trip names for display.
  const { data: ownedTrips = [] } = useQuery({
    queryKey: queryKeys.trips.owned(),
    queryFn: () => api<TripListItem[]>("/api/trips?scope=owned"),
    enabled: isOwner && (article?.tripIds.length ?? 0) > 0,
  });

  useEffect(() => {
    if (article) document.title = pageTitle(article.title);
  }, [article]);

  async function handleDelete() {
    if (!article) return;
    setDeleting(true);
    try {
      await apiVoid(`/api/articles/${article.id}`, { method: "DELETE" });
      toast.success(ta("deleted"));
      router.push(basePath);
    } catch (err) {
      toast.error(getApiErrorMessage(err, ta("deleteFailed")));
      setDeleting(false);
    }
  }

  const linkedTrips = article ? ownedTrips.filter((t) => article.tripIds.includes(t.id)) : [];

  return (
    <LoadingBoundary
      isLoading={isLoading}
      skeleton={
        <div className="mt-4 space-y-4">
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-40 w-full" />
        </div>
      }
      error={error}
      errorFallback={
        <div className="mt-8 text-center">
          <p className="text-destructive">{ta("fetchFailed")}</p>
          <Button variant="outline" size="sm" className="mt-4" onClick={() => refetch()}>
            {tc("retry")}
          </Button>
        </div>
      }
    >
      {article && (
        <div className="mt-4">
          <Link
            href={basePath}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            <ArrowLeft className="h-4 w-4" />
            {ta("back")}
          </Link>

          <div className="mt-4 flex items-start justify-between gap-2">
            <h1 className="text-2xl font-bold">{article.title}</h1>
            {isOwner && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    aria-label={ta("articleMenu")}
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => setEditOpen(true)}>
                    <Pencil className="h-4 w-4" />
                    {ta("edit")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="text-destructive"
                    onClick={() => setDeleteOpen(true)}
                  >
                    <Trash2 className="h-4 w-4" />
                    {ta("delete")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge
              variant={
                article.visibility === "public"
                  ? "default"
                  : article.visibility === "friends_only"
                    ? "secondary"
                    : "outline"
              }
              className="text-xs"
            >
              {tlVis(article.visibility)}
            </Badge>
            {article.tags.map((tag) => (
              <Badge key={tag} variant="outline" className="text-xs">
                {tag}
              </Badge>
            ))}
          </div>

          <div className="mt-6">
            <MarkdownRenderer content={article.content} />
          </div>

          {isOwner && linkedTrips.length > 0 && (
            <div className="mt-6 border-t pt-4">
              <p className="text-sm font-medium">{ta("linkedTrips")}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {linkedTrips.map((trip) => (
                  <Badge key={trip.id} variant="secondary" className="text-xs">
                    {trip.title}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          <div className="mt-6 flex items-center gap-2 border-t pt-4">
            <Button
              variant={article.likedByMe ? "default" : "outline"}
              size="sm"
              onClick={() => toggleLike(article)}
            >
              <Heart className={article.likedByMe ? "h-4 w-4 fill-current" : "h-4 w-4"} />
              {ta("like")}
              <span className="tabular-nums">{article.likeCount}</span>
            </Button>
          </div>

          {isOwner && (
            <ArticleEditorDialog
              open={editOpen}
              onOpenChange={setEditOpen}
              onSaved={() => refetch()}
              article={article}
            />
          )}

          <ResponsiveAlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
            <ResponsiveAlertDialogContent>
              <ResponsiveAlertDialogHeader>
                <ResponsiveAlertDialogTitle>{ta("deleteTitle")}</ResponsiveAlertDialogTitle>
                <ResponsiveAlertDialogDescription>
                  {ta("deleteDescription", { title: article.title })}
                </ResponsiveAlertDialogDescription>
              </ResponsiveAlertDialogHeader>
              <ResponsiveAlertDialogFooter>
                <ResponsiveAlertDialogCancel>
                  <X className="h-4 w-4" />
                  {tc("cancel")}
                </ResponsiveAlertDialogCancel>
                <ResponsiveAlertDialogDestructiveAction onClick={handleDelete} disabled={deleting}>
                  <Trash2 className="h-4 w-4" />
                  {ta("deleteConfirm")}
                </ResponsiveAlertDialogDestructiveAction>
              </ResponsiveAlertDialogFooter>
            </ResponsiveAlertDialogContent>
          </ResponsiveAlertDialog>
        </div>
      )}
    </LoadingBoundary>
  );
}
