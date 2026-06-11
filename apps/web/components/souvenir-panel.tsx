"use client";

import type { SouvenirItem, SouvenirPriority } from "@sugara/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpDown,
  ChevronDown,
  ExternalLink,
  Flame,
  Heart,
  MapPin,
  Pencil,
  Plus,
  ShoppingBag,
  SquareMousePointer,
  Star,
  StickyNote,
  Trash2,
  User,
  X,
} from "lucide-react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { Collapsible as CollapsiblePrimitive } from "radix-ui";
import { useState } from "react";
import { toast } from "sonner";
import { ActionSheet } from "@/components/action-sheet";
import { ItemMenuButton } from "@/components/item-menu-button";
import { EmptyState } from "@/components/ui/empty-state";
import { useSession } from "@/lib/auth-client";
import { useMobile } from "@/lib/hooks/use-is-mobile";

const SouvenirDialog = dynamic(() =>
  import("@/components/souvenir-dialog").then((mod) => mod.SouvenirDialog),
);

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LoadingBoundary } from "@/components/ui/loading-boundary";
import {
  ResponsiveAlertDialog,
  ResponsiveAlertDialogCancel,
  ResponsiveAlertDialogContent,
  ResponsiveAlertDialogDescription,
  ResponsiveAlertDialogDestructiveAction,
  ResponsiveAlertDialogFooter,
  ResponsiveAlertDialogHeader,
  ResponsiveAlertDialogTitle,
} from "@/components/ui/responsive-alert-dialog";
import { SelectionIndicator } from "@/components/ui/selection-indicator";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ApiError, api, apiVoid, getApiErrorMessage } from "@/lib/api";
import { SELECTED_RING } from "@/lib/colors";
import { isSafeUrl, stripProtocol } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import { buildMapsSearchUrl } from "@/lib/transport-link";
import { cn } from "@/lib/utils";

const PRIORITY_ORDER: Record<SouvenirPriority, number> = { high: 0, medium: 1 };

type SouvenirPanelProps = {
  tripId: string;
  addOpen?: boolean;
  onAddOpenChange?: (open: boolean) => void;
};

export function SouvenirPanel({ tripId, addOpen, onAddOpenChange }: SouvenirPanelProps) {
  const tm = useTranslations("messages");
  const ts = useTranslations("souvenir");
  const tc = useTranslations("common");
  const isMobile = useMobile();
  const { data: session } = useSession();
  const currentUserId = session?.user?.id;
  const queryClient = useQueryClient();
  const [internalDialogOpen, setInternalDialogOpen] = useState(false);
  const dialogOpen = addOpen ?? internalDialogOpen;
  const setDialogOpen = onAddOpenChange ?? setInternalDialogOpen;
  const [editingItem, setEditingItem] = useState<SouvenirItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SouvenirItem | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [purchasedOpen, setPurchasedOpen] = useState(false);
  const [sortBy, setSortBy] = useState<"priority" | "created">("priority");

  const { data, isLoading, isError } = useQuery({
    queryKey: queryKeys.souvenirs.list(tripId),
    queryFn: () => api<{ items: SouvenirItem[] }>(`/api/trips/${tripId}/souvenirs`),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, isPurchased }: { id: string; isPurchased: boolean }) =>
      api(`/api/trips/${tripId}/souvenirs/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ isPurchased }),
      }),
    onSettled: () => {
      // Refresh even on failure: a 404 means the item was deleted in another
      // session and the stale row must drop out of the list
      queryClient.invalidateQueries({ queryKey: queryKeys.souvenirs.list(tripId) });
    },
    onError: (err) => {
      toast.error(getApiErrorMessage(err, tm("souvenirSaveFailed")));
    },
  });

  // A 404 means the item was already deleted in another tab/session — the
  // desired end state is reached, so treat it as success instead of showing
  // a failure toast for a row that is about to disappear from the list
  const deleteSouvenir = async (id: string) => {
    try {
      await apiVoid(`/api/trips/${tripId}/souvenirs/${id}`, { method: "DELETE" });
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return;
      throw err;
    }
  };

  const deleteMutation = useMutation({
    mutationFn: deleteSouvenir,
    onSuccess: () => {
      setDeleteTarget(null);
    },
    onError: (err) => {
      toast.error(getApiErrorMessage(err, tm("souvenirDeleteFailed")));
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.souvenirs.list(tripId) });
    },
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: (ids: string[]) => Promise.all(ids.map(deleteSouvenir)),
    onSuccess: () => {
      setSelectedIds(new Set());
      setSelectMode(false);
      setBulkDeleteOpen(false);
    },
    onError: (err) => {
      toast.error(getApiErrorMessage(err, tm("souvenirDeleteFailed")));
    },
    onSettled: () => {
      // Promise.all rejects on the first failure while sibling deletes may
      // have already succeeded; invalidate on settle so the list reflects
      // whatever was actually removed. Selection stays so the user can retry
      queryClient.invalidateQueries({ queryKey: queryKeys.souvenirs.list(tripId) });
    },
  });

  const handleSaved = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.souvenirs.list(tripId) });
    setEditingItem(null);
  };

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedIds(new Set());
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const items = data?.items ?? [];
  const ownItems = items.filter((i) => i.userId === currentUserId);

  const sortItems = (list: SouvenirItem[]) => {
    if (sortBy === "created") return list;
    return [...list].sort((a, b) => {
      const pa = a.priority != null ? PRIORITY_ORDER[a.priority] : 2;
      const pb = b.priority != null ? PRIORITY_ORDER[b.priority] : 2;
      return pa !== pb ? pa - pb : a.createdAt.localeCompare(b.createdAt);
    });
  };

  const isOwn = (i: SouvenirItem) => i.userId === currentUserId;
  // Show purchase state for own items and for other members' items unless recommend-style
  const showPurchased = (i: SouvenirItem) =>
    i.isPurchased && (isOwn(i) || i.shareStyle !== "recommend");
  const purchased = sortItems(items.filter((i) => showPurchased(i)));
  const remaining = sortItems(items.filter((i) => !showPurchased(i)));
  const selectedCount = selectedIds.size;

  return (
    <LoadingBoundary
      isLoading={isLoading}
      skeleton={<Skeleton className="min-h-24 w-full rounded-md" />}
    >
      {isError ? (
        <p className="py-8 text-center text-sm text-muted-foreground">{ts("fetchFailed")}</p>
      ) : (
        <div>
          {selectMode ? (
            <div className="mb-2 flex items-center gap-1.5 rounded-lg bg-muted px-1.5 py-1">
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={exitSelectMode}>
                <X className="h-3.5 w-3.5" />
              </Button>
              <span className="text-xs font-medium">
                {tc("selectedCount", { count: selectedCount })}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2 text-xs"
                onClick={() =>
                  selectedCount === ownItems.length
                    ? setSelectedIds(new Set())
                    : setSelectedIds(new Set(ownItems.map((i) => i.id)))
                }
              >
                {selectedCount === ownItems.length ? tc("deselectAll") : tc("selectAll")}
              </Button>
              <div className="ml-auto">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2 text-xs text-destructive hover:text-destructive"
                  disabled={selectedCount === 0 || bulkDeleteMutation.isPending}
                  onClick={() => setBulkDeleteOpen(true)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {tc("delete")}
                </Button>
              </div>
            </div>
          ) : (
            <div className="mb-2 flex items-center gap-1.5">
              {items.length > 0 && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    className={cn(isMobile && "flex-1 h-9")}
                    aria-pressed={sortBy === "priority"}
                    aria-label={
                      sortBy === "priority" ? ts("switchToCreated") : ts("switchToPriority")
                    }
                    onClick={() => setSortBy(sortBy === "priority" ? "created" : "priority")}
                  >
                    <ArrowUpDown className="h-4 w-4" />
                    {sortBy === "priority" ? ts("sortPriority") : ts("sortCreated")}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className={cn(isMobile && "flex-1 h-9")}
                    onClick={() => setSelectMode(true)}
                  >
                    <SquareMousePointer className="h-4 w-4" />
                    {tc("select")}
                  </Button>
                </>
              )}
              {!isMobile && (
                <Button
                  variant="outline"
                  size="sm"
                  className="ml-auto"
                  onClick={() => setDialogOpen(true)}
                >
                  <Plus className="h-4 w-4" />
                  {ts("addSouvenir")}
                  <span className="hidden text-xs text-muted-foreground lg:inline">(S)</span>
                </Button>
              )}
            </div>
          )}

          {items.length === 0 ? (
            <EmptyState message={tm("emptySouvenir")} variant="box" />
          ) : (
            <div>
              {remaining.length > 0 && (
                <div className="space-y-1">
                  {remaining.map((item) => (
                    <SouvenirItemRow
                      key={item.id}
                      item={item}
                      isOwnItem={item.userId === currentUserId}
                      isMobile={isMobile}
                      selectMode={selectMode}
                      selected={selectedIds.has(item.id)}
                      onSelect={() => toggleSelect(item.id)}
                      onToggle={(isPurchased) =>
                        toggleMutation.mutate({ id: item.id, isPurchased })
                      }
                      onEdit={() => {
                        setEditingItem(item);
                        setDialogOpen(true);
                      }}
                      onDelete={() => setDeleteTarget(item)}
                    />
                  ))}
                </div>
              )}
              {purchased.length > 0 && (
                <CollapsiblePrimitive.Root
                  open={purchasedOpen || selectMode}
                  onOpenChange={(open) => !selectMode && setPurchasedOpen(open)}
                  className={cn("rounded-md border bg-muted/50", remaining.length > 0 && "mt-2")}
                >
                  <CollapsiblePrimitive.Trigger
                    disabled={selectMode}
                    className="flex w-full items-center gap-1 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted/80 disabled:pointer-events-none [&[data-state=open]>svg]:rotate-180"
                  >
                    <ChevronDown className="h-3 w-3 transition-transform duration-200" />
                    {ts("purchased", { count: purchased.length })}
                  </CollapsiblePrimitive.Trigger>
                  <CollapsiblePrimitive.Content className="data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down overflow-hidden">
                    <div className="space-y-1 border-t p-2">
                      {purchased.map((item) => (
                        <SouvenirItemRow
                          key={item.id}
                          item={item}
                          isOwnItem={item.userId === currentUserId}
                          isMobile={isMobile}
                          selectMode={selectMode}
                          selected={selectedIds.has(item.id)}
                          onSelect={() => toggleSelect(item.id)}
                          onToggle={(isPurchased) =>
                            toggleMutation.mutate({ id: item.id, isPurchased })
                          }
                          onEdit={() => {
                            setEditingItem(item);
                            setDialogOpen(true);
                          }}
                          onDelete={() => setDeleteTarget(item)}
                        />
                      ))}
                    </div>
                  </CollapsiblePrimitive.Content>
                </CollapsiblePrimitive.Root>
              )}
            </div>
          )}

          <SouvenirDialog
            tripId={tripId}
            open={dialogOpen}
            onOpenChange={(open) => {
              setDialogOpen(open);
              if (!open) setEditingItem(null);
            }}
            item={editingItem}
            onSaved={handleSaved}
          />

          <ResponsiveAlertDialog
            open={deleteTarget !== null}
            onOpenChange={(v) => !v && setDeleteTarget(null)}
          >
            <ResponsiveAlertDialogContent>
              <ResponsiveAlertDialogHeader>
                <ResponsiveAlertDialogTitle>{ts("deleteTitle")}</ResponsiveAlertDialogTitle>
                <ResponsiveAlertDialogDescription>
                  {ts("deleteDescription", { name: deleteTarget?.name ?? "" })}
                </ResponsiveAlertDialogDescription>
              </ResponsiveAlertDialogHeader>
              <ResponsiveAlertDialogFooter>
                <ResponsiveAlertDialogCancel>
                  <X className="h-4 w-4" />
                  {tc("cancel")}
                </ResponsiveAlertDialogCancel>
                <ResponsiveAlertDialogDestructiveAction
                  onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
                  disabled={deleteMutation.isPending}
                >
                  {tc("deletConfirm")}
                </ResponsiveAlertDialogDestructiveAction>
              </ResponsiveAlertDialogFooter>
            </ResponsiveAlertDialogContent>
          </ResponsiveAlertDialog>

          <ResponsiveAlertDialog
            open={bulkDeleteOpen}
            onOpenChange={(v) => !v && setBulkDeleteOpen(false)}
          >
            <ResponsiveAlertDialogContent>
              <ResponsiveAlertDialogHeader>
                <ResponsiveAlertDialogTitle>{ts("bulkDeleteTitle")}</ResponsiveAlertDialogTitle>
                <ResponsiveAlertDialogDescription>
                  {ts("bulkDeleteDescription", { count: selectedCount })}
                </ResponsiveAlertDialogDescription>
              </ResponsiveAlertDialogHeader>
              <ResponsiveAlertDialogFooter>
                <ResponsiveAlertDialogCancel>
                  <X className="h-4 w-4" />
                  {tc("cancel")}
                </ResponsiveAlertDialogCancel>
                <ResponsiveAlertDialogDestructiveAction
                  onClick={() => bulkDeleteMutation.mutate([...selectedIds])}
                  disabled={bulkDeleteMutation.isPending}
                >
                  {tc("deletConfirm")}
                </ResponsiveAlertDialogDestructiveAction>
              </ResponsiveAlertDialogFooter>
            </ResponsiveAlertDialogContent>
          </ResponsiveAlertDialog>
        </div>
      )}
    </LoadingBoundary>
  );
}

function SouvenirItemRow({
  item,
  isOwnItem,
  isMobile,
  selectMode,
  selected,
  onSelect,
  onToggle,
  onEdit,
  onDelete,
}: {
  item: SouvenirItem;
  isOwnItem: boolean;
  isMobile: boolean;
  selectMode: boolean;
  selected: boolean;
  onSelect: () => void;
  onToggle: (isPurchased: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const ts = useTranslations("souvenir");
  const tc = useTranslations("common");
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-md border p-3",
        (isOwnItem || item.shareStyle !== "recommend") && item.isPurchased && !selected
          ? "opacity-50"
          : "",
        selectMode &&
          isOwnItem &&
          "cursor-pointer transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selectMode && selected && SELECTED_RING,
      )}
      {...(selectMode && isOwnItem
        ? {
            onClick: onSelect,
            onKeyDown: (e: React.KeyboardEvent) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect();
              }
            },
            role: "button" as const,
            tabIndex: 0,
            "aria-pressed": selected,
          }
        : {})}
    >
      {selectMode ? (
        isOwnItem ? (
          <SelectionIndicator checked={selected} />
        ) : (
          <div className="h-5 w-5 shrink-0" />
        )
      ) : isOwnItem ? (
        <Checkbox
          checked={item.isPurchased}
          onCheckedChange={(checked) => onToggle(checked === true)}
          className="shrink-0"
          aria-label={item.isPurchased ? ts("unmarkPurchased") : ts("markPurchased")}
        />
      ) : null}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p
            className={`text-sm font-medium ${(isOwnItem || item.shareStyle !== "recommend") && item.isPurchased && !selected ? "line-through" : ""}`}
            translate="yes"
          >
            {item.name}
          </p>
          {item.priority && (
            <IconBadgeWithTooltip
              label={ts(item.priority === "high" ? "priorityHigh" : "priorityMedium")}
              isMobile={isMobile}
              className={
                item.priority === "high"
                  ? "border-rose-300 bg-rose-100 text-rose-800 dark:border-rose-700 dark:bg-rose-900 dark:text-rose-200"
                  : "border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-700 dark:bg-amber-900 dark:text-amber-200"
              }
            >
              {item.priority === "high" ? (
                <Flame className="h-3 w-3" />
              ) : (
                <Star className="h-3 w-3" />
              )}
            </IconBadgeWithTooltip>
          )}
          {(isOwnItem ? item.isShared : true) && item.shareStyle != null && (
            <IconBadgeWithTooltip
              label={ts(
                item.shareStyle === "recommend" ? "shareStyleRecommend" : "shareStyleErrand",
              )}
              isMobile={isMobile}
              className={
                item.shareStyle === "errand"
                  ? "border-sky-300 bg-sky-100 text-sky-800 dark:border-sky-700 dark:bg-sky-900 dark:text-sky-200"
                  : "border-pink-300 bg-pink-100 text-pink-800 dark:border-pink-700 dark:bg-pink-900 dark:text-pink-200"
              }
            >
              {item.shareStyle === "errand" ? (
                <ShoppingBag className="h-3 w-3" />
              ) : (
                <Heart className="h-3 w-3" />
              )}
            </IconBadgeWithTooltip>
          )}
        </div>
        {!isOwnItem && (
          <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
            <User className="h-3 w-3 shrink-0" />
            <span translate="yes">{item.userName}</span>
          </div>
        )}
        {(item.recipient || item.addresses.length > 0 || item.urls.length > 0 || item.memo) && (
          <div className={cn("mt-1 space-y-1", selectMode && "pointer-events-none")}>
            {item.recipient && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <User className="h-3 w-3 shrink-0 text-muted-foreground/70" />
                <span translate="yes">{item.recipient}</span>
              </div>
            )}
            {item.addresses.map((addr) => (
              <a
                key={addr}
                href={buildMapsSearchUrl(addr)}
                target="_blank"
                rel="noopener noreferrer"
                className="flex w-fit max-w-full items-center gap-1.5 text-xs text-blue-600 hover:underline dark:text-blue-400"
              >
                <MapPin className="h-3 w-3 shrink-0 text-muted-foreground/70" />
                <span className="truncate" translate="yes">
                  {addr}
                </span>
              </a>
            ))}
            {item.urls.filter(isSafeUrl).map((url) => (
              <a
                key={url}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex w-fit max-w-full items-center gap-1.5 text-xs text-blue-600 hover:underline dark:text-blue-400"
              >
                <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground/70" />
                <span className="truncate">{stripProtocol(url)}</span>
              </a>
            ))}
            {item.memo && (
              <div className="flex items-start gap-1.5 text-xs text-muted-foreground/70">
                <StickyNote className="mt-0.5 h-3 w-3 shrink-0" />
                <p className="whitespace-pre-line" translate="yes">
                  {item.memo}
                </p>
              </div>
            )}
          </div>
        )}
      </div>
      {!selectMode &&
        isOwnItem &&
        (isMobile ? (
          <>
            <ItemMenuButton
              ariaLabel={`${item.name} ${tc("menu")}`}
              onClick={() => setSheetOpen(true)}
            />
            <ActionSheet
              open={sheetOpen}
              onOpenChange={setSheetOpen}
              actions={[
                {
                  label: tc("edit"),
                  icon: <Pencil className="h-4 w-4" />,
                  onClick: onEdit,
                },
                {
                  label: tc("delete"),
                  icon: <Trash2 className="h-4 w-4" />,
                  onClick: onDelete,
                  variant: "destructive" as const,
                },
              ]}
            />
          </>
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <ItemMenuButton ariaLabel={`${item.name} ${tc("menu")}`} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onEdit}>
                <Pencil />
                {tc("edit")}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={onDelete}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 />
                {tc("delete")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ))}
    </div>
  );
}

function IconBadgeWithTooltip({
  label,
  isMobile,
  className,
  children,
}: {
  label: string;
  isMobile: boolean;
  className: string;
  children: React.ReactNode;
}) {
  const badge = (
    <Badge variant="outline" className={cn("shrink-0 px-1 py-0", className)} aria-label={label}>
      {children}
    </Badge>
  );

  if (isMobile) return badge;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="shrink-0">{badge}</span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
