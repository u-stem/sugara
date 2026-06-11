"use client";

import {
  BOOKMARK_LIST_NAME_MAX_LENGTH,
  type BookmarkListResponse,
  type BookmarkListVisibility,
  MAX_BOOKMARK_LISTS_PER_USER,
} from "@sugara/shared";
import { Plus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
import { api, getApiErrorMessage } from "@/lib/api";

type CreateBookmarkListDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
};

export function CreateBookmarkListDialog({
  open,
  onOpenChange,
  onCreated,
}: CreateBookmarkListDialogProps) {
  const tb = useTranslations("bookmark");
  const tm = useTranslations("messages");
  const tc = useTranslations("common");
  const tlVis = useTranslations("labels.visibility");
  const [name, setName] = useState("");
  const [visibility, setVisibility] = useState<BookmarkListVisibility>("private");
  const [submitting, setSubmitting] = useState(false);

  function handleOpenChange(isOpen: boolean) {
    onOpenChange(isOpen);
    if (!isOpen) {
      setName("");
      setVisibility("private");
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setSubmitting(true);
    try {
      await api<BookmarkListResponse>("/api/bookmark-lists", {
        method: "POST",
        body: JSON.stringify({ name: trimmed, visibility }),
      });
      toast.success(tm("bookmarkListCreated"));
      handleOpenChange(false);
      onCreated();
    } catch (err) {
      toast.error(
        getApiErrorMessage(err, tm("bookmarkListCreateFailed") as string, {
          conflict: tm("limitBookmarkLists", { max: MAX_BOOKMARK_LISTS_PER_USER }) as string,
        }),
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={handleOpenChange}>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{tb("createListTitle")}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>{tb("createListDescription")}</ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="new-list-name">
                {tb("listName")} <span className="text-destructive">*</span>
              </Label>
              <Input
                id="new-list-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={tb("listNamePlaceholder")}
                maxLength={BOOKMARK_LIST_NAME_MAX_LENGTH}
                required
              />
              <p className="text-right text-xs text-muted-foreground">
                {name.length}/{BOOKMARK_LIST_NAME_MAX_LENGTH}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-list-visibility">{tb("visibilityLabel")}</Label>
              <Select
                value={visibility}
                onValueChange={(v) => setVisibility(v as BookmarkListVisibility)}
              >
                <SelectTrigger id="new-list-visibility" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="private">{tlVis("private")}</SelectItem>
                  <SelectItem value="friends_only">{tlVis("friends_only")}</SelectItem>
                  <SelectItem value="public">{tlVis("public")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <ResponsiveDialogFooter>
            <ResponsiveDialogClose asChild>
              <Button type="button" variant="outline">
                <X className="h-4 w-4" />
                {tc("cancel")}
              </Button>
            </ResponsiveDialogClose>
            <Button type="submit" disabled={submitting || !name.trim()}>
              <Plus className="h-4 w-4" />
              {submitting ? tb("creating") : tb("create")}
            </Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
