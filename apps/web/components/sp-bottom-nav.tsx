"use client";

import type { FriendRequestResponse, NotificationsResponse } from "@sugara/shared";
import { useQuery } from "@tanstack/react-query";
import type { LucideIcon } from "lucide-react";
import { Bell, User } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ReactNode, useEffect, useState } from "react";
import { UserAvatar } from "@/components/user-avatar";
import { api } from "@/lib/api";
import { useSession } from "@/lib/auth-client";
import { isGuestUser } from "@/lib/guest";
import { useScrollDirection } from "@/lib/hooks/use-scroll-direction";
import { SP_NAV_LINKS } from "@/lib/nav-links";
import { queryKeys } from "@/lib/query-keys";
import { cn } from "@/lib/utils";

const NAV_LINK_CLASS =
  "relative flex flex-1 flex-col items-center justify-center gap-1 outline-none [-webkit-tap-highlight-color:transparent]";

function NavIcon({ icon: Icon, active }: { icon: LucideIcon; active: boolean }) {
  return (
    <Icon className={cn("h-6 w-6 transition-transform duration-200", active && "scale-110")} />
  );
}

function Badge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="absolute top-1.5 left-1/2 ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive text-[10px] font-medium tabular-nums text-destructive-foreground">
      {count > 9 ? "9+" : count}
    </span>
  );
}

function NavItem({
  href,
  active,
  label,
  children,
  badge,
}: {
  href: string;
  active: boolean;
  label: string;
  children: ReactNode;
  badge?: number;
}) {
  return (
    <Link
      href={href}
      className={cn(
        NAV_LINK_CLASS,
        "overflow-hidden",
        active ? "font-medium text-primary" : "text-muted-foreground",
      )}
      aria-label={label}
    >
      {children}
      <span className="max-w-full truncate whitespace-nowrap text-xs leading-none">{label}</span>
      {badge != null && <Badge count={badge} />}
    </Link>
  );
}

export function SpBottomNav() {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const { data: session } = useSession();
  const [mounted, setMounted] = useState(false);
  const navHidden = useScrollDirection();

  useEffect(() => setMounted(true), []);

  const isGuest = isGuestUser(session);

  const { data: friendRequests } = useQuery({
    queryKey: queryKeys.friends.requests(),
    queryFn: () => api<FriendRequestResponse[]>("/api/friends/requests"),
    enabled: !!session?.user && !isGuest,
    refetchInterval: 60_000,
    retry: false,
  });
  const friendRequestCount = friendRequests?.length ?? 0;

  const { data: notifications } = useQuery({
    queryKey: queryKeys.notifications.list(),
    queryFn: () => api<NotificationsResponse>("/api/notifications"),
    enabled: !!session?.user && !isGuest,
    refetchInterval: 60_000,
    retry: false,
  });
  const unreadCount = notifications?.unreadCount ?? 0;

  const friendHref = "/sp/friends";
  const bookmarkHref = "/sp/bookmarks";
  const articleHref = "/sp/articles";
  const visibleLinks = SP_NAV_LINKS.filter(
    (link) =>
      !isGuest ||
      (link.href !== bookmarkHref && link.href !== articleHref && link.href !== friendHref),
  );

  return (
    <nav
      aria-label={t("bottomNav")}
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 select-none border-t bg-background print:hidden transition-transform duration-300",
        navHidden && "translate-y-full",
      )}
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      <ul className="flex h-16 items-stretch">
        {visibleLinks.map((link) => {
          const active = pathname === link.href;
          return (
            <li key={link.href} className="flex flex-1">
              <NavItem
                href={link.href}
                active={active}
                label={t(link.labelKey)}
                badge={link.href === friendHref ? friendRequestCount : undefined}
              >
                <NavIcon icon={link.icon} active={active} />
              </NavItem>
            </li>
          );
        })}
        {mounted && session?.user && !isGuest && (
          <li className="flex flex-1">
            <NavItem
              href="/sp/notifications"
              active={pathname === "/sp/notifications"}
              label={t("notifications")}
              badge={unreadCount}
            >
              <NavIcon icon={Bell} active={pathname === "/sp/notifications"} />
            </NavItem>
          </li>
        )}
        <li className="flex flex-1">
          <NavItem href="/sp/my" active={pathname === "/sp/my"} label={t("profile")}>
            {mounted && session?.user ? (
              <UserAvatar
                name={session.user.name ?? ""}
                image={session.user.image}
                className="h-6 w-6"
              />
            ) : (
              <User className="h-6 w-6" />
            )}
          </NavItem>
        </li>
      </ul>
    </nav>
  );
}
