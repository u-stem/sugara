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
import { Bold, Heading2, Italic, Link, List, Plus, Quote, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
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

type FormatType = "bold" | "italic" | "heading" | "list" | "quote" | "link";

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

  const textareaRef = useRef<HTMLTextAreaElement>(null);

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

  // minor-4: in edit mode also fetch shared trips so links created from trip
  // detail can be removed from the editor (otherwise those trips are invisible).
  const { data: sharedTrips = [] } = useQuery({
    queryKey: queryKeys.trips.shared(),
    queryFn: () => api<TripListItem[]>("/api/trips?scope=shared"),
    enabled: open && isEdit,
  });

  // Combine owned trips + any shared-only trip that is already linked, so the
  // user can uncheck it.  Purely additive; no owned entries are duplicated.
  const displayTrips = useMemo(() => {
    if (!isEdit) return ownedTrips;
    const ownedIds = new Set(ownedTrips.map((t) => t.id));
    const linkedIds = new Set(article?.tripIds ?? []);
    const nonOwnedLinked = sharedTrips.filter((t) => !ownedIds.has(t.id) && linkedIds.has(t.id));
    return [...ownedTrips, ...nonOwnedLinked];
  }, [ownedTrips, sharedTrips, isEdit, article]);

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

  // Apply a Markdown format to the current selection or cursor position.
  // Inline formats (bold, italic, link) wrap the selection.
  // Line-start formats (heading, list, quote) prefix each selected line.
  function applyFormat(type: FormatType) {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const before = content.slice(0, start);
    const selected = content.slice(start, end);
    const after = content.slice(end);

    let newContent: string;
    let newStart: number;
    let newEnd: number;

    if (type === "bold" || type === "italic") {
      const marker = type === "bold" ? "**" : "_";
      const m = marker.length;
      if (before.endsWith(marker) && after.startsWith(marker)) {
        // Toggle off: markers sit just outside the selection (re-click case).
        newContent = before.slice(0, -m) + selected + after.slice(m);
        newStart = start - m;
        newEnd = end - m;
      } else if (
        selected.length >= 2 * m &&
        selected.startsWith(marker) &&
        selected.endsWith(marker)
      ) {
        // Toggle off: markers are inside the selection.
        newContent = before + selected.slice(m, -m) + after;
        newStart = start;
        newEnd = end - 2 * m;
      } else {
        newContent = `${before}${marker}${selected}${marker}${after}`;
        // Keep the selection around the wrapped text (shifted by the marker).
        newStart = start + m;
        newEnd = end + m;
      }
    } else if (type === "heading" || type === "list" || type === "quote") {
      const prefix = type === "heading" ? "## " : type === "list" ? "- " : "> ";
      // Find the start of the line where the selection begins.
      const lineStart = content.lastIndexOf("\n", start - 1) + 1;
      const block = content.slice(lineStart, end);
      // Preserve a trailing newline so the empty line after it isn't prefixed.
      const trailingNewline = block.endsWith("\n") ? "\n" : "";
      const body = trailingNewline ? block.slice(0, -1) : block;
      const lines = body.split("\n");
      // Toggle off when every line in the range already has the prefix.
      const allPrefixed = lines.every((l) => l.startsWith(prefix));
      const modifiedLines = allPrefixed
        ? lines.map((l) => l.slice(prefix.length))
        : lines.map((l) => prefix + l);
      const modified = modifiedLines.join("\n") + trailingNewline;
      newContent = content.slice(0, lineStart) + modified + after;
      // Place cursor at the end of the modified block.
      newEnd = lineStart + modified.length;
      newStart = newEnd;
    } else {
      // link
      const url = "https://";
      if (selected) {
        newContent = `${before}[${selected}](${url})${after}`;
        // Select the URL placeholder so the user can type the actual URL.
        newStart = start + 1 + selected.length + 2;
        newEnd = newStart + url.length;
      } else {
        const defaultText = ta("toolbar.linkText");
        newContent = `${before}[${defaultText}](${url})${after}`;
        newStart = start + 1 + defaultText.length + 2;
        newEnd = newStart + url.length;
      }
    }

    // Don't let formatting push the body past the limit (setContent bypasses
    // the textarea's maxLength). Toggling off only shrinks, so it's never blocked.
    if (newContent.length > ARTICLE_CONTENT_MAX_LENGTH) return;

    setContent(newContent);
    // Restore cursor / selection after React re-renders the textarea.
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(newStart, newEnd);
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

            <div className="space-y-3">
              <Label>{ta("contentLabel")}</Label>
              <Tabs defaultValue="write">
                <TabsList>
                  <TabsTrigger value="write">{ta("write")}</TabsTrigger>
                  <TabsTrigger value="preview">{ta("preview")}</TabsTrigger>
                </TabsList>
                <TabsContent value="write">
                  {/* Format toolbar: lets users apply Markdown without knowing the syntax */}
                  <div className="flex flex-wrap gap-0.5 rounded-t-md border border-b-0 bg-muted/30 p-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={() => applyFormat("bold")}
                      aria-label={ta("toolbar.bold")}
                    >
                      <Bold className="h-3.5 w-3.5" aria-hidden />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={() => applyFormat("italic")}
                      aria-label={ta("toolbar.italic")}
                    >
                      <Italic className="h-3.5 w-3.5" aria-hidden />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={() => applyFormat("heading")}
                      aria-label={ta("toolbar.heading")}
                    >
                      <Heading2 className="h-3.5 w-3.5" aria-hidden />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={() => applyFormat("list")}
                      aria-label={ta("toolbar.list")}
                    >
                      <List className="h-3.5 w-3.5" aria-hidden />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={() => applyFormat("quote")}
                      aria-label={ta("toolbar.quote")}
                    >
                      <Quote className="h-3.5 w-3.5" aria-hidden />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={() => applyFormat("link")}
                      aria-label={ta("toolbar.link")}
                    >
                      <Link className="h-3.5 w-3.5" aria-hidden />
                    </Button>
                  </div>
                  <Textarea
                    ref={textareaRef}
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    placeholder={ta("contentPlaceholder")}
                    maxLength={ARTICLE_CONTENT_MAX_LENGTH}
                    rows={10}
                    className="rounded-t-none font-mono text-sm"
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
              {displayTrips.length === 0 ? (
                <p className="text-sm text-muted-foreground">{ta("tripsEmpty")}</p>
              ) : (
                <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border p-2">
                  {displayTrips.map((trip) => {
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
                        <span className="min-w-0 flex-1 truncate">{trip.title}</span>
                        {trip.memberCount > 0 && (
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {ta("sharedWithNMembers", { count: trip.memberCount })}
                          </span>
                        )}
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
