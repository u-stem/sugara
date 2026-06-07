import type { ArticleListItem } from "@sugara/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { api, getApiErrorMessage } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

type UseArticleSelectionArgs = {
  articleIds: string[];
  invalidateArticles: () => void;
};

export function useArticleSelection({ articleIds, invalidateArticles }: UseArticleSelectionArgs) {
  const ta = useTranslations("article");
  const tm = useTranslations("messages");
  const queryClient = useQueryClient();
  const cacheKey = queryKeys.articles.list();

  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchLoading, setBatchLoading] = useState(false);
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false);

  function enter() {
    setSelectionMode(true);
  }

  function exit() {
    setSelectionMode(false);
    setSelectedIds(new Set());
  }

  function toggle(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll() {
    setSelectedIds(new Set(articleIds));
  }

  function deselectAll() {
    setSelectedIds(new Set());
  }

  function select(ids: string[]) {
    setSelectedIds(new Set(ids));
  }

  async function handleBatchDelete() {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    setBatchLoading(true);
    const count = ids.length;
    const idSet = new Set(ids);

    await queryClient.cancelQueries({ queryKey: cacheKey });
    const prev = queryClient.getQueryData<ArticleListItem[]>(cacheKey);
    if (prev) {
      queryClient.setQueryData(
        cacheKey,
        prev.filter((a) => !idSet.has(a.id)),
      );
    }
    toast.success(ta("bulkDeleted", { count }));
    exit();

    try {
      await api("/api/articles/batch-delete", {
        method: "POST",
        body: JSON.stringify({ articleIds: ids }),
      });
      invalidateArticles();
    } catch (err) {
      if (prev) queryClient.setQueryData(cacheKey, prev);
      toast.error(getApiErrorMessage(err, tm("batchDeleteFailed") as string));
    } finally {
      setBatchLoading(false);
      setBatchDeleteOpen(false);
    }
  }

  return {
    selectionMode,
    selectedIds,
    batchLoading,
    batchDeleteOpen,
    setBatchDeleteOpen,
    enter,
    exit,
    toggle,
    select,
    selectAll,
    deselectAll,
    handleBatchDelete,
  };
}
