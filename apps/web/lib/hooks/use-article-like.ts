import type { ArticleListItem, ArticleResponse } from "@sugara/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useRef } from "react";
import { toast } from "sonner";
import { api, getApiErrorMessage } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

type LikeResult = { liked: boolean; likeCount: number };

// Toggle like with optimistic updates against both the list and detail caches.
export function useArticleLike() {
  const queryClient = useQueryClient();
  const ta = useTranslations("article");
  // Guards against rapid toggling: a second click while a request is in flight
  // for the same article would race POST/DELETE and desync the UI from the server.
  const pendingIds = useRef<Set<string>>(new Set());

  async function toggleLike(article: { id: string; likedByMe: boolean }) {
    const id = article.id;
    if (pendingIds.current.has(id)) return;
    pendingIds.current.add(id);
    const willLike = !article.likedByMe;

    const listKey = queryKeys.articles.list();
    const detailKey = queryKeys.articles.detail(id);

    await Promise.all([
      queryClient.cancelQueries({ queryKey: listKey }),
      queryClient.cancelQueries({ queryKey: detailKey }),
    ]);

    const prevList = queryClient.getQueryData<ArticleListItem[]>(listKey);
    const prevDetail = queryClient.getQueryData<ArticleResponse>(detailKey);

    const applyDelta = (likeCount: number, likedByMe: boolean) => ({
      likedByMe,
      likeCount: Math.max(0, likeCount + (willLike ? 1 : -1)),
    });

    if (prevList) {
      queryClient.setQueryData<ArticleListItem[]>(
        listKey,
        prevList.map((a) => (a.id === id ? { ...a, ...applyDelta(a.likeCount, willLike) } : a)),
      );
    }
    if (prevDetail) {
      queryClient.setQueryData<ArticleResponse>(detailKey, {
        ...prevDetail,
        ...applyDelta(prevDetail.likeCount, willLike),
      });
    }

    try {
      const res = await api<LikeResult>(`/api/articles/${id}/like`, {
        method: willLike ? "POST" : "DELETE",
      });
      // Reconcile with the authoritative server count.
      const current = queryClient.getQueryData<ArticleListItem[]>(listKey);
      if (current) {
        queryClient.setQueryData<ArticleListItem[]>(
          listKey,
          current.map((a) =>
            a.id === id ? { ...a, likedByMe: res.liked, likeCount: res.likeCount } : a,
          ),
        );
      }
      const currentDetail = queryClient.getQueryData<ArticleResponse>(detailKey);
      if (currentDetail) {
        queryClient.setQueryData<ArticleResponse>(detailKey, {
          ...currentDetail,
          likedByMe: res.liked,
          likeCount: res.likeCount,
        });
      }
      // Invalidate trip-scoped article caches (used by ArticlesPanel) so the new
      // like state is reflected without needing per-trip optimistic updates.
      await queryClient.invalidateQueries({
        queryKey: [...queryKeys.articles.all, "trip"],
      });
    } catch (err) {
      if (prevList) queryClient.setQueryData(listKey, prevList);
      if (prevDetail) queryClient.setQueryData(detailKey, prevDetail);
      toast.error(getApiErrorMessage(err, ta("likeFailed")));
    } finally {
      pendingIds.current.delete(id);
    }
  }

  return { toggleLike };
}
