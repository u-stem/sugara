import type { ArticleListItem } from "@sugara/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api } from "@/lib/api";
import { useAuthRedirect } from "@/lib/hooks/use-auth-redirect";
import { queryKeys } from "@/lib/query-keys";

export type ArticleVisibilityFilter = "all" | "public" | "friends_only" | "private";

export type UseArticlesReturn = {
  articles: ArticleListItem[];
  filteredArticles: ArticleListItem[];
  isLoading: boolean;
  error: Error | null;
  visibilityFilter: ArticleVisibilityFilter;
  setVisibilityFilter: (filter: ArticleVisibilityFilter) => void;
  createDialogOpen: boolean;
  setCreateDialogOpen: (open: boolean) => void;
  invalidateArticles: () => void;
};

export function useArticles(isGuest: boolean): UseArticlesReturn {
  const queryClient = useQueryClient();

  const {
    data: articles = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: queryKeys.articles.list(),
    queryFn: () => api<ArticleListItem[]>("/api/articles"),
    enabled: !isGuest,
  });
  useAuthRedirect(error);

  const [visibilityFilter, setVisibilityFilter] = useState<ArticleVisibilityFilter>("all");
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  const invalidateArticles = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.articles.list() });

  const filteredArticles = useMemo(() => {
    if (visibilityFilter === "all") return articles;
    return articles.filter((a) => a.visibility === visibilityFilter);
  }, [articles, visibilityFilter]);

  return {
    articles,
    filteredArticles,
    isLoading,
    error,
    visibilityFilter,
    setVisibilityFilter,
    createDialogOpen,
    setCreateDialogOpen,
    invalidateArticles,
  };
}
