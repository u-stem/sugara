"use client";

import type { NotificationsResponse } from "@sugara/shared";
import { useQuery } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { useSession } from "@/lib/auth-client";
import { isGuestUser } from "@/lib/guest";
import { queryKeys } from "@/lib/query-keys";
import { cn } from "@/lib/utils";

// Notification entry point for the SP header. Moved off the bottom nav to keep
// the bottom bar uncrowded once the articles tab was added.
export function SpNotificationBell() {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const { data: session } = useSession();
  const isGuest = isGuestUser(session);
  const enabled = !!session?.user && !isGuest;

  const { data: notifications } = useQuery({
    queryKey: queryKeys.notifications.list(),
    queryFn: () => api<NotificationsResponse>("/api/notifications"),
    enabled,
    refetchInterval: 60_000,
    retry: false,
  });
  const unreadCount = notifications?.unreadCount ?? 0;

  if (!enabled) return null;

  const active = pathname === "/sp/notifications";

  return (
    <Link
      href="/sp/notifications"
      aria-label={
        unreadCount > 0 ? t("notificationsUnread", { count: unreadCount }) : t("notifications")
      }
      className={cn(
        "relative inline-flex h-9 w-9 items-center justify-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 [-webkit-tap-highlight-color:transparent]",
        active ? "text-primary" : "text-muted-foreground",
      )}
    >
      <Bell className="h-5 w-5" />
      {unreadCount > 0 && (
        <span className="absolute top-1 right-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-0.5 text-[10px] font-medium tabular-nums text-destructive-foreground">
          {unreadCount > 9 ? "9+" : unreadCount}
        </span>
      )}
    </Link>
  );
}
