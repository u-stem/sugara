import type { BookmarkResponse } from "@sugara/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { api, getApiErrorMessage } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

type UseBookmarkOperationsArgs = {
  listId: string;
  bookmarkCount: number;
  maxBookmarks: number;
  invalidateBookmarks: () => void;
  invalidateLists: () => void;
};

export function useBookmarkOperations({
  listId,
  bookmarkCount,
  maxBookmarks,
  invalidateBookmarks,
  invalidateLists,
}: UseBookmarkOperationsArgs) {
  const tm = useTranslations("messages");
  const queryClient = useQueryClient();
  const cacheKey = queryKeys.bookmarks.list(listId);

  const [addBookmarkOpen, setAddBookmarkOpen] = useState(false);
  const [editingBookmark, setEditingBookmark] = useState<BookmarkResponse | null>(null);
  const [deletingBookmark, setDeletingBookmark] = useState<BookmarkResponse | null>(null);
  const [bookmarkName, setBookmarkName] = useState("");
  const [bookmarkMemo, setBookmarkMemo] = useState("");
  const [bookmarkUrls, setBookmarkUrls] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  function resetForm() {
    setBookmarkName("");
    setBookmarkMemo("");
    setBookmarkUrls([]);
  }

  function openAdd() {
    resetForm();
    setAddBookmarkOpen(true);
  }

  function openEdit(bm: BookmarkResponse) {
    setBookmarkName(bm.name);
    setBookmarkMemo(bm.memo ?? "");
    setBookmarkUrls(bm.urls ?? []);
    setEditingBookmark(bm);
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = bookmarkName.trim();
    if (!trimmed) return;
    if (bookmarkCount >= maxBookmarks) {
      toast.error(tm("limitBookmarks"));
      return;
    }
    setSubmitting(true);
    try {
      await api(`/api/bookmark-lists/${listId}/bookmarks`, {
        method: "POST",
        body: JSON.stringify({
          name: trimmed,
          memo: bookmarkMemo.trim() || undefined,
          urls: bookmarkUrls.filter((u) => u.trim()),
        }),
      });
      toast.success(tm("bookmarkAdded"));
      resetForm();
      setAddBookmarkOpen(false);
      invalidateBookmarks();
      // Add affects BookmarkListResponse.bookmarkCount, so the lists query
      // also needs a refetch. handleDelete mirrors this; handleUpdate skips
      // it intentionally (PATCH /:bookmarkId doesn't touch bookmark_lists).
      invalidateLists();
    } catch (err) {
      toast.error(
        getApiErrorMessage(err, tm("bookmarkAddFailed") as string, {
          conflict: tm("limitBookmarks", { max: maxBookmarks }) as string,
        }),
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUpdate(e: React.FormEvent) {
    e.preventDefault();
    if (!editingBookmark) return;
    const trimmed = bookmarkName.trim();
    if (!trimmed) return;
    setSubmitting(true);

    const updatedFields = {
      name: trimmed,
      memo: bookmarkMemo.trim() || null,
      urls: bookmarkUrls.filter((u) => u.trim()),
    };

    await queryClient.cancelQueries({ queryKey: cacheKey });
    const prev = queryClient.getQueryData<BookmarkResponse[]>(cacheKey);
    if (prev) {
      queryClient.setQueryData(
        cacheKey,
        prev.map((b) => (b.id !== editingBookmark.id ? b : { ...b, ...updatedFields })),
      );
    }
    toast.success(tm("bookmarkUpdated"));
    resetForm();
    setEditingBookmark(null);

    try {
      await api(`/api/bookmark-lists/${listId}/bookmarks/${editingBookmark.id}`, {
        method: "PATCH",
        body: JSON.stringify(updatedFields),
      });
      // Bookmark update doesn't change BookmarkListResponse fields
      // (bookmarkCount/updatedAt are list-level, untouched by /:bookmarkId PATCH),
      // so unlike handleAdd/handleDelete we don't invalidate the lists query here.
      invalidateBookmarks();
    } catch (err) {
      if (prev) queryClient.setQueryData(cacheKey, prev);
      toast.error(getApiErrorMessage(err, tm("bookmarkUpdateFailed") as string));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!deletingBookmark) return;
    const bookmarkId = deletingBookmark.id;

    await queryClient.cancelQueries({ queryKey: cacheKey });
    const prev = queryClient.getQueryData<BookmarkResponse[]>(cacheKey);
    if (prev) {
      queryClient.setQueryData(
        cacheKey,
        prev.filter((b) => b.id !== bookmarkId),
      );
    }
    toast.success(tm("bookmarkDeleted"));
    setDeletingBookmark(null);

    try {
      await api(`/api/bookmark-lists/${listId}/bookmarks/${bookmarkId}`, {
        method: "DELETE",
      });
      invalidateBookmarks();
      // Delete affects BookmarkListResponse.bookmarkCount (mirrored in
      // handleAdd; handleUpdate skips this since /:bookmarkId PATCH doesn't
      // touch bookmark_lists).
      invalidateLists();
    } catch (err) {
      if (prev) queryClient.setQueryData(cacheKey, prev);
      toast.error(getApiErrorMessage(err, tm("bookmarkDeleteFailed") as string));
    }
  }

  return {
    addBookmarkOpen,
    setAddBookmarkOpen,
    editingBookmark,
    setEditingBookmark,
    deletingBookmark,
    setDeletingBookmark,
    bookmarkName,
    setBookmarkName,
    bookmarkMemo,
    setBookmarkMemo,
    bookmarkUrls,
    setBookmarkUrls,
    submitting,
    resetForm,
    openAdd,
    openEdit,
    handleAdd,
    handleUpdate,
    handleDelete,
  };
}
