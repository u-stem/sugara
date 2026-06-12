"use client";

import {
  MAX_ADDRESSES_PER_SOUVENIR,
  MAX_SOUVENIRS_PER_USER_PER_TRIP,
  MAX_URLS_PER_SOUVENIR,
  SOUVENIR_ADDRESS_MAX_LENGTH,
  SOUVENIR_NAME_MAX_LENGTH,
  SOUVENIR_RECIPIENT_MAX_LENGTH,
  SOUVENIR_URL_MAX_LENGTH,
  type SouvenirItem,
  type SouvenirPriority,
  type SouvenirShareStyle,
} from "@sugara/shared";
import { Check, Flame, Heart, Minus, Plus, ShoppingBag, Star, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { api, getApiErrorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";

type SouvenirDialogProps = {
  tripId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item?: SouvenirItem | null;
  onSaved: () => void;
};

function useStringArrayField(initial: string[], open: boolean) {
  const displayValues = initial.length > 0 ? initial : [""];
  const nextKeyRef = useRef(displayValues.length);
  const [keys, setKeys] = useState<number[]>(() => displayValues.map((_, i) => i));

  // Reset keys when dialog opens or array length changes to prevent key drift
  // across item switches where both items have the same number of entries.
  useEffect(() => {
    nextKeyRef.current = displayValues.length;
    setKeys(Array.from({ length: displayValues.length }, (_, i) => i));
  }, [open, displayValues.length]);

  const addKey = useCallback(() => {
    const key = nextKeyRef.current++;
    setKeys((prev) => [...prev, key]);
  }, []);

  const removeKey = useCallback((index: number) => {
    setKeys((prev) => prev.filter((_, i) => i !== index));
  }, []);

  return { keys, addKey, removeKey };
}

export function SouvenirDialog({ tripId, open, onOpenChange, item, onSaved }: SouvenirDialogProps) {
  const isEdit = !!item;
  const tm = useTranslations("messages");
  const ts = useTranslations("souvenir");
  const tc = useTranslations("common");
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState("");
  const [recipient, setRecipient] = useState("");
  const [urls, setUrls] = useState<string[]>([]);
  const [addresses, setAddresses] = useState<string[]>([]);
  const [memo, setMemo] = useState("");
  const [priority, setPriority] = useState<SouvenirPriority | null>(null);
  const [isShared, setIsShared] = useState(false);
  const [shareStyle, setShareStyle] = useState<SouvenirShareStyle | null>(null);

  useEffect(() => {
    if (!open) return;
    if (item) {
      setName(item.name);
      setRecipient(item.recipient ?? "");
      setUrls(item.urls);
      setAddresses(item.addresses);
      setMemo(item.memo ?? "");
      setPriority(item.priority);
      setIsShared(item.isShared);
      setShareStyle(item.shareStyle);
    } else {
      setName("");
      setRecipient("");
      setUrls([]);
      setAddresses([]);
      setMemo("");
      setPriority(null);
      setIsShared(false);
      setShareStyle(null);
    }
  }, [open, item]);

  const displayUrls = urls.length > 0 ? urls : [""];
  const displayAddresses = addresses.length > 0 ? addresses : [""];

  const urlField = useStringArrayField(urls, open);
  const addressField = useStringArrayField(addresses, open);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setLoading(true);
    try {
      const body = {
        name: name.trim(),
        recipient: recipient.trim() || null,
        urls: urls.filter((u) => u.trim()),
        addresses: addresses.filter((a) => a.trim()),
        memo: memo.trim() || null,
        priority,
        isShared,
        shareStyle: isShared ? shareStyle : null,
      };

      if (isEdit) {
        await api(`/api/trips/${tripId}/souvenirs/${item.id}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
      } else {
        await api(`/api/trips/${tripId}/souvenirs`, {
          method: "POST",
          body: JSON.stringify(body),
        });
      }
      toast.success(tm(isEdit ? "souvenirUpdated" : "souvenirAdded"));
      onOpenChange(false);
      onSaved();
    } catch (err) {
      toast.error(
        getApiErrorMessage(err, tm("souvenirSaveFailed"), {
          // 409 is only returned by the create route (per-trip souvenir limit)
          conflict: tm("limitSouvenirs", { max: MAX_SOUVENIRS_PER_USER_PER_TRIP }),
        }),
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="sm:max-w-md">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{isEdit ? ts("editTitle") : ts("addTitle")}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {isEdit ? ts("editDescription") : ts("addDescription")}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="souvenir-name">
              {ts("nameLabel")} <span className="text-destructive">*</span>
            </Label>
            <Input
              id="souvenir-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={ts("namePlaceholder")}
              maxLength={SOUVENIR_NAME_MAX_LENGTH}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="souvenir-recipient">{ts("recipientLabel")}</Label>
            <Input
              id="souvenir-recipient"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder={ts("recipientPlaceholder")}
              maxLength={SOUVENIR_RECIPIENT_MAX_LENGTH}
            />
          </div>
          <div className="space-y-2">
            <Label>{ts("addressLabel")}</Label>
            {displayAddresses.map((addr, index) => (
              <div key={addressField.keys[index]} className="flex items-center gap-1">
                <Input
                  value={addr}
                  onChange={(e) => {
                    const next = [...displayAddresses];
                    next[index] = e.target.value;
                    setAddresses(next);
                  }}
                  placeholder={ts("addressPlaceholder")}
                  maxLength={SOUVENIR_ADDRESS_MAX_LENGTH}
                />
                {index > 0 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    onClick={() => {
                      addressField.removeKey(index);
                      setAddresses(displayAddresses.filter((_, i) => i !== index));
                    }}
                    aria-label={ts("deleteAddress")}
                  >
                    <Minus className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ))}
            {displayAddresses.length < MAX_ADDRESSES_PER_SOUVENIR && (
              <button
                type="button"
                className="text-xs text-muted-foreground hover:text-foreground"
                onClick={() => {
                  addressField.addKey();
                  setAddresses([...displayAddresses, ""]);
                }}
              >
                <Plus className="inline h-3 w-3" /> {ts("addAddress")}
              </button>
            )}
          </div>
          <div className="space-y-2">
            <Label>URL</Label>
            {displayUrls.map((url, index) => (
              <div key={urlField.keys[index]} className="flex items-center gap-1">
                <Input
                  type="url"
                  value={url}
                  onChange={(e) => {
                    const next = [...displayUrls];
                    next[index] = e.target.value;
                    setUrls(next);
                  }}
                  placeholder="https://..."
                  maxLength={SOUVENIR_URL_MAX_LENGTH}
                />
                {index > 0 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    onClick={() => {
                      urlField.removeKey(index);
                      setUrls(displayUrls.filter((_, i) => i !== index));
                    }}
                    aria-label={ts("deleteUrl")}
                  >
                    <Minus className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ))}
            {displayUrls.length < MAX_URLS_PER_SOUVENIR && (
              <button
                type="button"
                className="text-xs text-muted-foreground hover:text-foreground"
                onClick={() => {
                  urlField.addKey();
                  setUrls([...displayUrls, ""]);
                }}
              >
                <Plus className="inline h-3 w-3" /> {ts("addUrl")}
              </button>
            )}
          </div>
          <div className="space-y-2">
            <Label>{ts("priorityLabel")}</Label>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className={cn("flex-1", priority === null && "bg-muted")}
                onClick={() => setPriority(null)}
              >
                <Minus className="h-3.5 w-3.5" />
                {ts("priorityUnset")}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className={cn(
                  "flex-1",
                  priority === "high" &&
                    "border-rose-300 bg-rose-100 text-rose-800 hover:bg-rose-100 dark:border-rose-700 dark:bg-rose-900 dark:text-rose-200 dark:hover:bg-rose-900",
                )}
                onClick={() => setPriority("high")}
              >
                <Flame className="h-3.5 w-3.5" />
                {ts("priorityHigh")}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className={cn(
                  "flex-1",
                  priority === "medium" &&
                    "border-amber-300 bg-amber-100 text-amber-800 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-900 dark:text-amber-200 dark:hover:bg-amber-900",
                )}
                onClick={() => setPriority("medium")}
              >
                <Star className="h-3.5 w-3.5" />
                {ts("priorityMedium")}
              </Button>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="souvenir-memo">{ts("memoLabel")}</Label>
            <Textarea
              id="souvenir-memo"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder={ts("memoPlaceholder")}
              rows={2}
            />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between rounded-md border px-3 py-2">
              <Label htmlFor="souvenir-shared" className="cursor-pointer font-normal">
                {ts("shareWithMembers")}
              </Label>
              <Switch
                id="souvenir-shared"
                checked={isShared}
                onCheckedChange={(checked) => {
                  setIsShared(checked);
                  if (!checked) {
                    setShareStyle(null);
                  }
                }}
              />
            </div>
            {isShared && (
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className={cn("flex-1", shareStyle === null && "bg-muted")}
                  onClick={() => setShareStyle(null)}
                >
                  <Minus className="h-3.5 w-3.5" />
                  {ts("shareStyleUnset")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className={cn(
                    "flex-1",
                    shareStyle === "recommend" &&
                      "border-pink-300 bg-pink-100 text-pink-800 hover:bg-pink-100 dark:border-pink-700 dark:bg-pink-900 dark:text-pink-200 dark:hover:bg-pink-900",
                  )}
                  onClick={() => setShareStyle("recommend")}
                >
                  <Heart className="h-3.5 w-3.5" />
                  {ts("shareStyleRecommend")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className={cn(
                    "flex-1",
                    shareStyle === "errand" &&
                      "border-sky-300 bg-sky-100 text-sky-800 hover:bg-sky-100 dark:border-sky-700 dark:bg-sky-900 dark:text-sky-200 dark:hover:bg-sky-900",
                  )}
                  onClick={() => setShareStyle("errand")}
                >
                  <ShoppingBag className="h-3.5 w-3.5" />
                  {ts("shareStyleErrand")}
                </Button>
              </div>
            )}
          </div>
          <ResponsiveDialogFooter>
            <ResponsiveDialogClose asChild>
              <Button type="button" variant="outline">
                <X className="h-4 w-4" />
                {tc("cancel")}
              </Button>
            </ResponsiveDialogClose>
            <Button type="submit" disabled={loading || !name.trim()}>
              {isEdit ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
              {loading
                ? isEdit
                  ? ts("updating")
                  : ts("adding")
                : isEdit
                  ? ts("updateButton")
                  : ts("addButton")}
            </Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
