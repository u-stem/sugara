"use client";

import { useParams } from "next/navigation";
import { ArticleDetailView } from "@/components/article-detail-view";

export default function ArticleDetailPage() {
  const params = useParams<{ articleId: string }>();
  return <ArticleDetailView articleId={params.articleId} basePath="/articles" />;
}
