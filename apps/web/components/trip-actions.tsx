"use client";

import type { MemberRole, TripResponse, TripStatus } from "@sugara/shared";
import { canEdit, isOwner } from "@sugara/shared";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpDown,
  Bookmark,
  CalendarCheck,
  Check,
  CheckCircle,
  FileDown,
  FileText,
  History,
  Link,
  Map as MapIcon,
  MoreHorizontal,
  Pencil,
  PenLine,
  Plane,
  Printer,
  RefreshCw,
  Trash2,
  Users,
  X,
} from "lucide-react";
import dynamic from "next/dynamic";
import NextLink from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { type ReactNode, useState } from "react";
import { FaDiscord } from "react-icons/fa";
import { toast } from "sonner";

const MemberDialog = dynamic(() =>
  import("@/components/member-dialog").then((mod) => mod.MemberDialog),
);

const ShareDialog = dynamic(() =>
  import("@/components/share-dialog").then((mod) => mod.ShareDialog),
);

const DiscordWebhookDialog = dynamic(() =>
  import("@/components/discord-webhook-dialog").then((mod) => mod.DiscordWebhookDialog),
);

import { ActionSheet } from "@/components/action-sheet";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/api";
import { useSession } from "@/lib/auth-client";
import { copyToClipboard } from "@/lib/clipboard";
import { formatDateFromISO } from "@/lib/format";
import { isGuestUser } from "@/lib/guest";
import { useMobile } from "@/lib/hooks/use-is-mobile";
import { queryKeys } from "@/lib/query-keys";

type TripActionsProps = {
  tripId: string;
  tripTitle: string;
  status: TripStatus;
  role: MemberRole;
  pollId?: string | null;
  onStatusChange?: () => void;
  onEdit?: () => void;
  disabled?: boolean;
  memberLimitReached?: boolean;
  compact?: boolean;
  onOpenBookmarks?: () => void;
  onOpenActivity?: () => void;
  onOpenArticles?: () => void;
  onOpenMap?: () => void;
};

const MANUAL_STATUSES: TripStatus[] = ["draft", "planned", "active", "completed"];

const STATUS_ICONS: Record<string, ReactNode> = {
  draft: <PenLine className="h-4 w-4" />,
  planned: <CalendarCheck className="h-4 w-4" />,
  active: <Plane className="h-4 w-4" />,
  completed: <CheckCircle className="h-4 w-4" />,
};

export function TripActions({
  tripId,
  tripTitle,
  status,
  role,
  pollId,
  onStatusChange,
  onEdit,
  disabled,
  memberLimitReached,
  compact,
  onOpenBookmarks,
  onOpenActivity,
  onOpenArticles,
  onOpenMap,
}: TripActionsProps) {
  const locale = useLocale();
  const tm = useTranslations("messages");
  const tt = useTranslations("trip");
  const tc = useTranslations("common");
  const td = useTranslations("discord");
  const tlStatus = useTranslations("labels.status");
  const { data: session } = useSession();
  const isGuest = isGuestUser(session);
  const isOwnerRole = isOwner(role);
  const canEditRole = canEdit(role);
  const queryClient = useQueryClient();
  const cacheKey = queryKeys.trips.detail(tripId);
  const router = useRouter();
  const isMobile = useMobile();
  const [deleting, setDeleting] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [memberOpen, setMemberOpen] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareExpiresAt, setShareExpiresAt] = useState<string | null>(null);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [discordOpen, setDiscordOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [statusSheetOpen, setStatusSheetOpen] = useState(false);
  const menuTriggerId = compact
    ? `trip-menu-trigger-mobile-${tripId}`
    : `trip-menu-trigger-desktop-${tripId}`;

  async function handleStatusChange(newStatus: string) {
    if (newStatus === status) return;

    queryClient.cancelQueries({ queryKey: cacheKey });
    const prev = queryClient.getQueryData<TripResponse>(cacheKey);
    if (prev) {
      queryClient.setQueryData(cacheKey, { ...prev, status: newStatus });
    }
    toast.success(tm("tripStatusChanged"));

    try {
      await api(`/api/trips/${tripId}`, {
        method: "PATCH",
        body: JSON.stringify({ status: newStatus }),
      });
      onStatusChange?.();
    } catch {
      if (prev) queryClient.setQueryData(cacheKey, prev);
      toast.error(tm("tripStatusChangeFailed"));
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      await api(`/api/trips/${tripId}`, { method: "DELETE" });
      toast.success(tm("tripDeleted"));
      router.push("/home");
    } catch {
      toast.error(tm("tripDeleteFailed"));
    } finally {
      setDeleting(false);
    }
  }

  type ShareResponse = { shareToken: string; shareTokenExpiresAt: string | null };

  async function handleShare() {
    setSharing(true);
    try {
      let url: string;
      if (status === "scheduling" && pollId) {
        const result = await api<ShareResponse>(`/api/polls/${pollId}/share`, {
          method: "POST",
        });
        url = `${window.location.origin}/polls/shared/${result.shareToken}`;
        setShareExpiresAt(result.shareTokenExpiresAt);
      } else {
        const result = await api<ShareResponse>(`/api/trips/${tripId}/share`, {
          method: "POST",
        });
        url = `${window.location.origin}/shared/${result.shareToken}`;
        setShareExpiresAt(result.shareTokenExpiresAt);
      }
      setShareUrl(url);
      setShareDialogOpen(true);
      try {
        await copyToClipboard(url);
        toast.success(tm("shareLinkCopied"));
      } catch {
        // Clipboard may not be available
      }
    } catch {
      toast.error(tm("shareLinkFailed"));
    } finally {
      setSharing(false);
    }
  }

  async function handleRegenerate() {
    setRegenerating(true);
    try {
      let result: ShareResponse;
      let url: string;
      if (status === "scheduling" && pollId) {
        result = await api<ShareResponse>(`/api/polls/${pollId}/share`, { method: "PUT" });
        url = `${window.location.origin}/polls/shared/${result.shareToken}`;
      } else {
        result = await api<ShareResponse>(`/api/trips/${tripId}/share`, { method: "PUT" });
        url = `${window.location.origin}/shared/${result.shareToken}`;
      }
      setShareExpiresAt(result.shareTokenExpiresAt);
      setShareUrl(url);
      try {
        await copyToClipboard(url);
        toast.success(tm("shareLinkRegenerated"));
      } catch {
        toast.success(tm("shareLinkRegeneratedNoCopy"));
      }
    } catch {
      toast.error(tm("shareLinkRegenerateFailed"));
    } finally {
      setRegenerating(false);
    }
  }

  const sheetActions = [
    ...(onOpenMap
      ? [
          {
            label: tt("map"),
            icon: <MapIcon className="h-4 w-4" />,
            onClick: onOpenMap,
          },
        ]
      : []),
    ...(onOpenBookmarks
      ? [
          {
            label: tt("bookmarks"),
            icon: <Bookmark className="h-4 w-4" />,
            onClick: onOpenBookmarks,
          },
        ]
      : []),
    ...(onOpenActivity
      ? [
          {
            label: tt("history"),
            icon: <History className="h-4 w-4" />,
            onClick: onOpenActivity,
          },
        ]
      : []),
    ...(onOpenArticles
      ? [
          {
            label: tt("articles"),
            icon: <FileText className="h-4 w-4" />,
            onClick: onOpenArticles,
          },
        ]
      : []),
    ...(canEditRole && status !== "scheduling"
      ? [
          {
            label: `${tt("status")}: ${tlStatus(status)}`,
            icon: <ArrowUpDown className="h-4 w-4" />,
            onClick: () => setStatusSheetOpen(true),
          },
        ]
      : []),
    ...(!isGuest
      ? [
          {
            label: tt("members"),
            icon: <Users className="h-4 w-4" />,
            onClick: () => {
              if (isMobile) {
                router.push(`/sp/trips/${tripId}/members`);
              } else {
                setMemberOpen(true);
              }
            },
          },
        ]
      : []),
    ...(isOwnerRole && !isGuest
      ? [
          {
            label: sharing ? tt("generating") : tt("shareLink"),
            icon: <Link className="h-4 w-4" />,
            onClick: handleShare,
          },
        ]
      : []),
    ...(canEditRole && !isGuest
      ? [
          {
            label: td("title"),
            icon: <FaDiscord className="h-4 w-4" />,
            onClick: () => setDiscordOpen(true),
          },
        ]
      : []),
    ...(canEditRole
      ? [
          {
            label: tt("printPdf"),
            icon: <Printer className="h-4 w-4" />,
            href: isMobile ? `/sp/trips/${tripId}/print` : `/trips/${tripId}/print`,
          },
        ]
      : []),
    {
      label: tt("export"),
      icon: <FileDown className="h-4 w-4" />,
      href: isMobile ? `/sp/trips/${tripId}/export` : `/trips/${tripId}/export`,
    },
    ...(onEdit
      ? [
          {
            label: tc("edit"),
            icon: <Pencil className="h-4 w-4" />,
            onClick: onEdit,
          },
        ]
      : []),
    ...(isOwnerRole
      ? [
          {
            label: deleting ? tt("deleting") : tc("delete"),
            icon: <Trash2 className="h-4 w-4" />,
            onClick: () => setDeleteOpen(true),
            variant: "destructive" as const,
          },
        ]
      : []),
  ];

  return (
    <div className="flex flex-wrap items-center gap-2">
      {!compact && (
        <>
          {canEditRole && status !== "scheduling" ? (
            <Select value={status} onValueChange={handleStatusChange} disabled={disabled}>
              <SelectTrigger className="h-8 w-[130px] text-xs" aria-label={tt("statusChange")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MANUAL_STATUSES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {tlStatus(value)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <span className="text-xs text-muted-foreground">{tlStatus(status)}</span>
          )}
          {/* Desktop inline buttons (sm+) */}
          {!isGuest && (
            <Button
              variant="outline"
              size="sm"
              className="hidden sm:inline-flex"
              onClick={() => setMemberOpen(true)}
              disabled={disabled}
            >
              <Users className="h-4 w-4" />
              {tt("members")}
            </Button>
          )}
          {isOwnerRole && !isGuest && (
            <Button
              variant="outline"
              size="sm"
              className="hidden sm:inline-flex"
              onClick={handleShare}
              disabled={disabled || sharing}
            >
              <Link className="h-4 w-4" />
              {sharing ? tt("generating") : tt("shareLink")}
            </Button>
          )}
          {/* Share expiry + regenerate */}
          {isOwnerRole && shareUrl && (
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleRegenerate}
                disabled={disabled || regenerating}
                aria-label={tt("regenerateShareLink")}
              >
                <RefreshCw className={`h-3.5 w-3.5 ${regenerating ? "animate-spin" : ""}`} />
              </Button>
              {shareExpiresAt && (
                <span className="text-xs text-muted-foreground">
                  {new Date(shareExpiresAt) < new Date()
                    ? tt("expired")
                    : tt("expiresAt", { date: formatDateFromISO(shareExpiresAt, { locale }) })}
                </span>
              )}
            </div>
          )}
        </>
      )}
      {isMobile ? (
        <>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            disabled={disabled}
            onClick={() => setSheetOpen(true)}
          >
            <MoreHorizontal className="h-4 w-4" />
            <span className="sr-only">{tt("tripMenu")}</span>
          </Button>
          <ActionSheet open={sheetOpen} onOpenChange={setSheetOpen} actions={sheetActions} />
        </>
      ) : (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              id={menuTriggerId}
              variant="outline"
              size="icon"
              className="h-8 w-8"
              disabled={disabled}
            >
              <MoreHorizontal className="h-4 w-4" />
              <span className="sr-only">{tt("tripMenu")}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {compact && (
              <>
                {onOpenMap && (
                  <DropdownMenuItem onClick={onOpenMap}>
                    <MapIcon />
                    {tt("map")}
                  </DropdownMenuItem>
                )}
                {onOpenBookmarks && (
                  <DropdownMenuItem onClick={onOpenBookmarks}>
                    <Bookmark />
                    {tt("bookmarks")}
                  </DropdownMenuItem>
                )}
                {onOpenActivity && (
                  <DropdownMenuItem onClick={onOpenActivity}>
                    <History />
                    {tt("history")}
                  </DropdownMenuItem>
                )}
                {onOpenArticles && (
                  <DropdownMenuItem onClick={onOpenArticles}>
                    <FileText />
                    {tt("articles")}
                  </DropdownMenuItem>
                )}
                {canEditRole && status !== "scheduling" ? (
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      <ArrowUpDown />
                      {tt("status")}: {tlStatus(status)}
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      {MANUAL_STATUSES.map((value) => (
                        <DropdownMenuItem key={value} onClick={() => handleStatusChange(value)}>
                          {STATUS_ICONS[value]}
                          {tlStatus(value)}
                          {value === status && <Check className="ml-auto h-4 w-4" />}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                ) : (
                  <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                    {tlStatus(status)}
                  </DropdownMenuLabel>
                )}
                <DropdownMenuSeparator />
              </>
            )}
            {!isGuest && (
              <DropdownMenuItem
                className={compact ? "" : "sm:hidden"}
                onClick={() => setMemberOpen(true)}
              >
                <Users />
                {tt("members")}
              </DropdownMenuItem>
            )}
            {isOwnerRole && !isGuest && (
              <DropdownMenuItem
                className={compact ? "" : "sm:hidden"}
                onClick={handleShare}
                disabled={sharing}
              >
                <Link />
                {sharing ? tt("generating") : tt("shareLink")}
              </DropdownMenuItem>
            )}
            {canEditRole && !isGuest && (
              <DropdownMenuItem onClick={() => setDiscordOpen(true)}>
                <FaDiscord />
                {td("title")}
              </DropdownMenuItem>
            )}
            {canEditRole && (
              <DropdownMenuItem asChild>
                <NextLink href={isMobile ? `/sp/trips/${tripId}/print` : `/trips/${tripId}/print`}>
                  <Printer />
                  {tt("printPdf")}
                </NextLink>
              </DropdownMenuItem>
            )}
            <DropdownMenuItem asChild>
              <NextLink href={isMobile ? `/sp/trips/${tripId}/export` : `/trips/${tripId}/export`}>
                <FileDown />
                {tt("export")}
              </NextLink>
            </DropdownMenuItem>
            {onEdit && (
              <DropdownMenuItem onClick={onEdit}>
                <Pencil />
                {tc("edit")}
              </DropdownMenuItem>
            )}
            {isOwnerRole && (
              <DropdownMenuItem
                className="text-destructive"
                disabled={deleting}
                onClick={() => setDeleteOpen(true)}
              >
                <Trash2 />
                {deleting ? tt("deleting") : tc("delete")}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <MemberDialog
        tripId={tripId}
        isOwner={isOwnerRole}
        open={memberOpen}
        onOpenChange={setMemberOpen}
        memberLimitReached={memberLimitReached}
      />
      <DiscordWebhookDialog
        tripId={tripId}
        open={discordOpen}
        onOpenChange={setDiscordOpen}
        canEdit={canEditRole}
      />
      {shareUrl && (
        <ShareDialog
          open={shareDialogOpen}
          onOpenChange={setShareDialogOpen}
          shareUrl={shareUrl}
          expiresAt={shareExpiresAt}
        />
      )}
      <Drawer open={statusSheetOpen} onOpenChange={setStatusSheetOpen}>
        <DrawerContent>
          <DrawerTitle className="sr-only">{tt("statusChange")}</DrawerTitle>
          <DrawerDescription className="sr-only">{tt("statusChangeSelect")}</DrawerDescription>
          <div className="flex flex-col gap-2 pb-4 pt-2">
            {MANUAL_STATUSES.map((value) => (
              <Button
                key={value}
                variant={value === status ? "default" : "outline"}
                className="h-12 w-full justify-start text-base"
                onClick={() => {
                  handleStatusChange(value);
                  setStatusSheetOpen(false);
                }}
              >
                <span className="mr-2">{STATUS_ICONS[value]}</span>
                {tlStatus(value)}
                {value === status && <Check className="ml-auto h-4 w-4" />}
              </Button>
            ))}
            <Button
              variant="outline"
              className="mt-1 h-12 w-full justify-start text-base"
              onClick={() => setStatusSheetOpen(false)}
            >
              <X className="mr-2 h-4 w-4" />
              {tc("cancel")}
            </Button>
          </div>
        </DrawerContent>
      </Drawer>
      <ResponsiveAlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <ResponsiveAlertDialogContent>
          <ResponsiveAlertDialogHeader>
            <ResponsiveAlertDialogTitle>{tt("deleteConfirmTitle")}</ResponsiveAlertDialogTitle>
            <ResponsiveAlertDialogDescription>
              {tt("deleteConfirmDescription", { title: tripTitle })}
            </ResponsiveAlertDialogDescription>
          </ResponsiveAlertDialogHeader>
          <ResponsiveAlertDialogFooter>
            <ResponsiveAlertDialogCancel>
              <X className="h-4 w-4" />
              {tc("cancel")}
            </ResponsiveAlertDialogCancel>
            <ResponsiveAlertDialogDestructiveAction onClick={handleDelete}>
              <Trash2 className="h-4 w-4" />
              {tc("deletConfirm")}
            </ResponsiveAlertDialogDestructiveAction>
          </ResponsiveAlertDialogFooter>
        </ResponsiveAlertDialogContent>
      </ResponsiveAlertDialog>
    </div>
  );
}
