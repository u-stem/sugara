import type { ExpensesResponse } from "@sugara/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { api, getApiErrorMessage } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

/**
 * Selection + batch-delete state for the expense list, following the trip-scoped
 * candidate/schedule selection pattern. Optimistically removes the selected rows
 * from the cached ExpensesResponse, then reconciles via invalidation (settlement
 * and member totals are recomputed server-side on the next fetch).
 */
export function useExpenseSelection(tripId: string) {
  const tm = useTranslations("messages");
  const queryClient = useQueryClient();
  const cacheKey = queryKeys.expenses.list(tripId);

  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchLoading, setBatchLoading] = useState(false);
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false);

  function enter() {
    setSelectionMode(true);
  }

  // Stable identity so callers can list it in effect deps (e.g. exit on tab change).
  const exit = useCallback(() => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  }, []);

  function toggle(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll(ids: string[]) {
    setSelectedIds(new Set(ids));
  }

  function deselectAll() {
    setSelectedIds(new Set());
  }

  async function handleBatchDelete() {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    setBatchLoading(true);
    const count = ids.length;
    const idSet = new Set(ids);

    await queryClient.cancelQueries({ queryKey: cacheKey });
    const prev = queryClient.getQueryData<ExpensesResponse>(cacheKey);
    if (prev) {
      queryClient.setQueryData(cacheKey, {
        ...prev,
        expenses: prev.expenses.filter((e) => !idSet.has(e.id)),
      });
    }
    // Clear the selection UI immediately, but defer the success toast until the
    // request actually succeeds.
    exit();

    try {
      await api(`/api/trips/${tripId}/expenses/batch-delete`, {
        method: "POST",
        body: JSON.stringify({ expenseIds: ids }),
      });
      queryClient.invalidateQueries({ queryKey: cacheKey });
      queryClient.invalidateQueries({ queryKey: queryKeys.trips.activityLogs(tripId) });
      toast.success(tm("batchDeleted", { count }));
    } catch (err) {
      if (prev) queryClient.setQueryData(cacheKey, prev);
      toast.error(getApiErrorMessage(err, tm("batchDeleteFailed")));
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
    selectAll,
    deselectAll,
    handleBatchDelete,
  };
}
