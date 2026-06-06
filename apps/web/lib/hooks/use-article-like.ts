import type { ArticleListItem, ArticleResponse } from "@sugara/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { api, getApiErrorMessage } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

type LikeResult = { liked: boolean; likeCount: number };

// Toggle like with optimistic updates against both the list and detail caches.
export function useArticleLike() {
  const queryClient = useQueryClient();
  const ta = useTranslations("article");

  async function toggleLike(article: { id: string; likedByMe: boolean }) {
    const id = article.id;
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
    } catch (err) {
      if (prevList) queryClient.setQueryData(listKey, prevList);
      if (prevDetail) queryClient.setQueryData(detailKey, prevDetail);
      toast.error(getApiErrorMessage(err, ta("likeFailed")));
    }
  }

  return { toggleLike };
}
