"use client";

import {
  ARTICLE_CONTENT_MAX_LENGTH,
  ARTICLE_TAG_MAX_LENGTH,
  ARTICLE_TITLE_MAX_LENGTH,
  type ArticleResponse,
  type ArticleVisibility,
  MAX_TAGS_PER_ARTICLE,
  MAX_TRIPS_PER_ARTICLE,
  type TripListItem,
} from "@sugara/shared";
import { useQuery } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ResponsiveDialog,
  ResponsiveDialogClose,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { api, getApiErrorMessage } from "@/lib/api";
import { MarkdownRenderer } from "@/lib/markdown";
import { queryKeys } from "@/lib/query-keys";

type ArticleEditorDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  // Present for edit mode; absent for create mode.
  article?: ArticleResponse;
};

export function ArticleEditorDialog({
  open,
  onOpenChange,
  onSaved,
  article,
}: ArticleEditorDialogProps) {
  const ta = useTranslations("article");
  const tc = useTranslations("common");
  const tlVis = useTranslations("labels.visibility");
  const isEdit = !!article;

  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState("");
  const [visibility, setVisibility] = useState<ArticleVisibility>("private");
  const [tripIds, setTripIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // Reset/prefill whenever the dialog opens.
  useEffect(() => {
    if (!open) return;
    setTitle(article?.title ?? "");
    setContent(article?.content ?? "");
    setTags(article?.tags ?? []);
    setTagDraft("");
    setVisibility(article?.visibility ?? "private");
    setTripIds(article?.tripIds ?? []);
  }, [open, article]);

  const { data: ownedTrips = [] } = useQuery({
    queryKey: queryKeys.trips.owned(),
    queryFn: () => api<TripListItem[]>("/api/trips?scope=owned"),
    enabled: open,
  });

  function addTag() {
    const t = tagDraft.trim();
    if (!t) return;
    if (tags.length >= MAX_TAGS_PER_ARTICLE) return;
    if (t.length > ARTICLE_TAG_MAX_LENGTH) return;
    if (tags.includes(t)) {
      setTagDraft("");
      return;
    }
    setTags([...tags, t]);
    setTagDraft("");
  }

  function toggleTrip(id: string) {
    setTripIds((prev) => {
      if (prev.includes(id)) return prev.filter((t) => t !== id);
      if (prev.length >= MAX_TRIPS_PER_ARTICLE) return prev;
      return [...prev, id];
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;
    setSubmitting(true);
    try {
      const payload = { title: trimmed, content, tags, visibility };
      const saved = isEdit
        ? await api<ArticleResponse>(`/api/articles/${article.id}`, {
            method: "PATCH",
            body: JSON.stringify(payload),
          })
        : await api<ArticleResponse>("/api/articles", {
            method: "POST",
            body: JSON.stringify(payload),
          });

      // Sync trip links (idempotent PUT). Always send on edit; on create only
      // when trips were chosen, to avoid an unneeded request.
      if (isEdit || tripIds.length > 0) {
        await api(`/api/articles/${saved.id}/trips`, {
          method: "PUT",
          body: JSON.stringify({ tripIds }),
        });
      }

      toast.success(isEdit ? ta("updated") : ta("created"));
      onOpenChange(false);
      onSaved();
    } catch (err) {
      toast.error(getApiErrorMessage(err, ta(isEdit ? "updateFailed" : "createFailed")));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>
            {isEdit ? ta("editTitle") : ta("createTitle")}
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {isEdit ? ta("editDescription") : ta("createDescription")}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4 px-4 py-2 sm:px-0">
            <div className="space-y-2">
              <Label htmlFor="article-title">
                {ta("titleLabel")} <span className="text-destructive">*</span>
              </Label>
              <Input
                id="article-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={ta("titlePlaceholder")}
                maxLength={ARTICLE_TITLE_MAX_LENGTH}
                required
              />
              <p className="text-right text-xs text-muted-foreground">
                {title.length}/{ARTICLE_TITLE_MAX_LENGTH}
              </p>
            </div>

            <div className="space-y-2">
              <Label>{ta("contentLabel")}</Label>
              <Tabs defaultValue="write">
                <TabsList>
                  <TabsTrigger value="write">{ta("write")}</TabsTrigger>
                  <TabsTrigger value="preview">{ta("preview")}</TabsTrigger>
                </TabsList>
                <TabsContent value="write">
                  <Textarea
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    placeholder={ta("contentPlaceholder")}
                    maxLength={ARTICLE_CONTENT_MAX_LENGTH}
                    rows={10}
                    className="font-mono text-sm"
                  />
                  <p className="text-right text-xs text-muted-foreground">
                    {content.length}/{ARTICLE_CONTENT_MAX_LENGTH}
                  </p>
                </TabsContent>
                <TabsContent value="preview">
                  <div className="min-h-[12rem] rounded-md border p-3">
                    {content.trim() ? (
                      <MarkdownRenderer content={content} />
                    ) : (
                      <p className="text-sm text-muted-foreground">{ta("previewEmpty")}</p>
                    )}
                  </div>
                </TabsContent>
              </Tabs>
            </div>

            <div className="space-y-2">
              <Label htmlFor="article-tag">{ta("tagsLabel")}</Label>
              <div className="flex gap-2">
                <Input
                  id="article-tag"
                  value={tagDraft}
                  onChange={(e) => setTagDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addTag();
                    }
                  }}
                  placeholder={ta("tagsPlaceholder")}
                  maxLength={ARTICLE_TAG_MAX_LENGTH}
                  disabled={tags.length >= MAX_TAGS_PER_ARTICLE}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={addTag}
                  disabled={!tagDraft.trim() || tags.length >= MAX_TAGS_PER_ARTICLE}
                  aria-label={ta("addTag")}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {ta("tagsHint", { max: MAX_TAGS_PER_ARTICLE, length: ARTICLE_TAG_MAX_LENGTH })}
              </p>
              {tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {tags.map((tag) => (
                    <Badge key={tag} variant="secondary" className="gap-1">
                      {tag}
                      <button
                        type="button"
                        onClick={() => setTags(tags.filter((t) => t !== tag))}
                        aria-label={ta("removeTag", { tag })}
                        className="rounded-full hover:text-destructive"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="article-visibility">{ta("visibilityLabel")}</Label>
              <Select
                value={visibility}
                onValueChange={(v) => setVisibility(v as ArticleVisibility)}
              >
                <SelectTrigger id="article-visibility" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="private">{tlVis("private")}</SelectItem>
                  <SelectItem value="friends_only">{tlVis("friends_only")}</SelectItem>
                  <SelectItem value="public">{tlVis("public")}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>{ta("tripsLabel")}</Label>
              <p className="text-xs text-muted-foreground">{ta("tripsHint")}</p>
              {ownedTrips.length === 0 ? (
                <p className="text-sm text-muted-foreground">{ta("tripsEmpty")}</p>
              ) : (
                <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border p-2">
                  {ownedTrips.map((trip) => {
                    const checked = tripIds.includes(trip.id);
                    return (
                      <label
                        key={trip.id}
                        htmlFor={`article-trip-${trip.id}`}
                        className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-accent"
                      >
                        <Checkbox
                          id={`article-trip-${trip.id}`}
                          checked={checked}
                          onCheckedChange={() => toggleTrip(trip.id)}
                          disabled={!checked && tripIds.length >= MAX_TRIPS_PER_ARTICLE}
                        />
                        <span className="truncate">{trip.title}</span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <ResponsiveDialogFooter className="px-4 sm:px-0">
            <ResponsiveDialogClose asChild>
              <Button type="button" variant="outline">
                <X className="h-4 w-4" />
                {tc("cancel")}
              </Button>
            </ResponsiveDialogClose>
            <Button type="submit" disabled={submitting || !title.trim()}>
              <Plus className="h-4 w-4" />
              {submitting
                ? isEdit
                  ? ta("updating")
                  : ta("creating")
                : isEdit
                  ? ta("save")
                  : ta("create")}
            </Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
