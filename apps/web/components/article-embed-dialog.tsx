"use client";

import type { ArticleResponse } from "@sugara/shared";
import { useQuery } from "@tanstack/react-query";
import { Heart } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { useArticleLike } from "@/lib/hooks/use-article-like";
import { MarkdownRenderer } from "@/lib/markdown";
import { queryKeys } from "@/lib/query-keys";

type ArticleEmbedDialogProps = {
  articleId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

// Reads an article inline (modal/drawer) without navigating to /articles/:id,
// so the standalone URL is never surfaced from the trip context.
export function ArticleEmbedDialog({ articleId, open, onOpenChange }: ArticleEmbedDialogProps) {
  const ta = useTranslations("article");
  const tlVis = useTranslations("labels.visibility");
  const { toggleLike } = useArticleLike();

  const { data: article, isLoading } = useQuery({
    queryKey: queryKeys.articles.detail(articleId ?? ""),
    queryFn: () => api<ArticleResponse>(`/api/articles/${articleId}`),
    enabled: open && !!articleId,
  });

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{article?.title ?? ta("relatedTitle")}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription className="sr-only">
            {ta("relatedTitle")}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <div className="px-4 pb-4 sm:px-0">
          {isLoading || !article ? (
            <div className="space-y-3">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-40 w-full" />
            </div>
          ) : (
            <>
              <div className="mb-4 flex flex-wrap items-center gap-2">
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

              <MarkdownRenderer content={article.content} />

              <div className="mt-6 border-t pt-4">
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
            </>
          )}
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
