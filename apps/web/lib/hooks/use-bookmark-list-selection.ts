import { type BookmarkListResponse, MAX_BOOKMARK_LISTS_PER_USER } from "@sugara/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { api, getApiErrorMessage } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

type UseBookmarkListSelectionArgs = {
  listIds: string[];
  invalidateLists: () => void;
};

export function useBookmarkListSelection({
  listIds,
  invalidateLists,
}: UseBookmarkListSelectionArgs) {
  const tm = useTranslations("messages");
  const queryClient = useQueryClient();
  const cacheKey = queryKeys.bookmarks.lists();

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
    setSelectedIds(new Set(listIds));
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
    const prev = queryClient.getQueryData<BookmarkListResponse[]>(cacheKey);
    if (prev) {
      queryClient.setQueryData(
        cacheKey,
        prev.filter((l) => !idSet.has(l.id)),
      );
    }
    toast.success(tm("bookmarkListBulkDeleted", { count }));
    exit();

    try {
      await api("/api/bookmark-lists/batch-delete", {
        method: "POST",
        body: JSON.stringify({ listIds: ids }),
      });
      invalidateLists();
    } catch (err) {
      if (prev) queryClient.setQueryData(cacheKey, prev);
      toast.error(getApiErrorMessage(err, tm("batchDeleteFailed") as string));
    } finally {
      setBatchLoading(false);
      setBatchDeleteOpen(false);
    }
  }

  async function handleBatchDuplicate() {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    setBatchLoading(true);
    try {
      await api("/api/bookmark-lists/batch-duplicate", {
        method: "POST",
        body: JSON.stringify({ listIds: ids }),
      });
      toast.success(tm("bookmarkListBulkDuplicated", { count: ids.length }));
      exit();
      invalidateLists();
    } catch (err) {
      toast.error(
        getApiErrorMessage(err, tm("batchDuplicateFailed") as string, {
          conflict: tm("limitBookmarkLists", { max: MAX_BOOKMARK_LISTS_PER_USER }) as string,
        }),
      );
    } finally {
      setBatchLoading(false);
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
    handleBatchDuplicate,
  };
}
