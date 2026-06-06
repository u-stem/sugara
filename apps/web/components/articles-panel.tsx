"use client";

import type { ArticleListItem } from "@sugara/shared";
import { useQuery } from "@tanstack/react-query";
import { Heart } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { ArticleEmbedDialog } from "@/components/article-embed-dialog";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingBoundary } from "@/components/ui/loading-boundary";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

type ArticlesPanelProps = {
  tripId: string;
};

// Trip-scoped related articles. Members see every linked article (context
// sharing) and read them inline via ArticleEmbedDialog — never leaving the trip.
export function ArticlesPanel({ tripId }: ArticlesPanelProps) {
  const ta = useTranslations("article");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const {
    data: articles = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: queryKeys.articles.byTrip(tripId),
    queryFn: () => api<ArticleListItem[]>(`/api/trips/${tripId}/articles`),
  });

  return (
    <LoadingBoundary
      isLoading={isLoading}
      skeleton={
        <div className="space-y-2">
          {["s1", "s2", "s3"].map((k) => (
            <Skeleton key={k} className="h-14 w-full" />
          ))}
        </div>
      }
      error={error}
    >
      {articles.length === 0 ? (
        <EmptyState message={ta("tripEmpty")} variant="box" />
      ) : (
        <ul className="space-y-2">
          {articles.map((article) => (
            <li key={article.id}>
              <button
                type="button"
                onClick={() => setSelectedId(article.id)}
                className="w-full rounded-lg border p-3 text-left transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="line-clamp-2 font-medium">{article.title}</span>
                  <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                    <Heart
                      className={
                        article.likedByMe ? "h-3.5 w-3.5 fill-current text-rose-500" : "h-3.5 w-3.5"
                      }
                      aria-hidden
                    />
                    {article.likeCount}
                  </span>
                </div>
                {article.tags.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {article.tags.map((tag) => (
                      <Badge key={tag} variant="outline" className="text-xs">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      <ArticleEmbedDialog
        articleId={selectedId}
        open={selectedId !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null);
        }}
      />
    </LoadingBoundary>
  );
}
