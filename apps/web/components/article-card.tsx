"use client";

import type { ArticleListItem } from "@sugara/shared";
import { Heart } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { memo } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type ArticleCardProps = ArticleListItem & {
  /** URL prefix for article links. Defaults to "/articles". SP pages use "/sp/articles". */
  hrefPrefix?: string;
};

export const ArticleCard = memo(function ArticleCard({
  id,
  title,
  tags,
  visibility,
  likeCount,
  likedByMe,
  hrefPrefix = "/articles",
}: ArticleCardProps) {
  const ta = useTranslations("article");
  const tlVis = useTranslations("labels.visibility");

  return (
    <Link href={`${hrefPrefix}/${id}`} className="group block focus-visible:outline-none">
      <Card className="h-full transition-[colors,transform,box-shadow] hover:bg-accent/50 hover:shadow-md lg:active:scale-[0.98] group-focus-visible:border-ring group-focus-visible:ring-2 group-focus-visible:ring-ring">
        <CardHeader>
          <div className="flex items-start justify-between gap-2">
            <CardTitle className="line-clamp-2 text-lg" translate="yes">
              {title}
            </CardTitle>
            <Badge
              variant={
                visibility === "public"
                  ? "default"
                  : visibility === "friends_only"
                    ? "secondary"
                    : "outline"
              }
              className="shrink-0 text-xs"
            >
              {tlVis(visibility)}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap gap-1">
            {tags.map((tag) => (
              <Badge key={tag} variant="outline" className="max-w-full truncate text-xs">
                {tag}
              </Badge>
            ))}
          </div>
          <span
            className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground"
            title={ta("likeCount", { count: likeCount })}
          >
            <Heart
              className={likedByMe ? "h-3.5 w-3.5 fill-current text-rose-500" : "h-3.5 w-3.5"}
              aria-hidden
            />
            {likeCount}
          </span>
        </CardContent>
      </Card>
    </Link>
  );
});
