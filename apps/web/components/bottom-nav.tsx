"use client";

import type { FriendRequestResponse } from "@sugara/shared";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import type React from "react";
import { api } from "@/lib/api";
import { useSession } from "@/lib/auth-client";
import { isGuestUser } from "@/lib/guest";
import { NAV_LINKS } from "@/lib/nav-links";
import { queryKeys } from "@/lib/query-keys";
import { cn } from "@/lib/utils";

type NavLink = {
  href: string;
  labelKey: "home" | "bookmarks" | "articles" | "friends";
  icon: React.ComponentType<{ className?: string }>;
};

type BottomNavBaseProps = {
  className?: string;
  links: readonly NavLink[];
  friendHref: string;
};

export function BottomNavBase({ className, links, friendHref }: BottomNavBaseProps) {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const { data: session } = useSession();

  const { data: friendRequests } = useQuery({
    queryKey: queryKeys.friends.requests(),
    queryFn: () => api<FriendRequestResponse[]>("/api/friends/requests"),
    enabled: !!session?.user && !isGuestUser(session),
    refetchInterval: 60_000,
    // Cookie cache may return session without isAnonymous, causing a 403 before fresh session arrives
    retry: false,
  });
  const friendRequestCount = friendRequests?.length ?? 0;

  const isGuest = isGuestUser(session);
  const bookmarkHref = friendHref.replace("/friends", "/bookmarks");
  const visibleLinks = links.filter(
    (link) => !isGuest || (link.href !== bookmarkHref && link.href !== friendHref),
  );

  return (
    <nav
      aria-label={t("bottomNav")}
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 select-none border-t bg-background print:hidden",
        className,
      )}
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      <ul className="flex h-12 items-stretch">
        {visibleLinks.map((link) => {
          const active = pathname === link.href;
          const showBadge = link.href === friendHref && friendRequestCount > 0;
          return (
            <li key={link.href} className="flex flex-1">
              <Link
                href={link.href}
                // Fold the unread count into the link's accessible name so screen
                // readers announce it; the visual badge alone is silent to AT.
                aria-label={showBadge ? `${t(link.labelKey)} (${friendRequestCount})` : undefined}
                className={cn(
                  "relative flex flex-1 flex-col items-center justify-center gap-0.5 text-xs transition-[colors,transform] active:bg-accent",
                  active ? "font-medium text-primary" : "text-muted-foreground",
                )}
              >
                <link.icon
                  className={cn("h-5 w-5 transition-transform duration-200", active && "scale-110")}
                />
                <span className="sr-only">{t(link.labelKey)}</span>
                {showBadge && (
                  <span
                    aria-hidden="true"
                    className="absolute top-1.5 left-1/2 ml-2 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive text-[10px] font-medium tabular-nums text-destructive-foreground"
                  >
                    {friendRequestCount}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function BottomNav() {
  return <BottomNavBase links={NAV_LINKS} friendHref="/friends" className="sm:hidden" />;
}
