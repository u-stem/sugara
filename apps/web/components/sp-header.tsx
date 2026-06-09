"use client";

import { useTranslations } from "next-intl";
import { AnnouncementBanner } from "@/components/announcement-banner";
import { GuestBanner } from "@/components/guest-banner";
import { SpHeaderMenu } from "@/components/header-menu";
import { InstallBanner } from "@/components/install-banner";
import { Logo } from "@/components/logo";
import { OfflineBanner } from "@/components/offline-banner";
import { SpNotificationBell } from "@/components/sp-notification-bell";

/**
 * SP-specific header: simplified for mobile.
 * Navigation is handled by SpBottomNav; notifications live here in the header.
 */
export function SpHeader() {
  const t = useTranslations("nav");
  return (
    <header className="shrink-0 z-30 select-none border-b bg-background pt-[env(safe-area-inset-top,0px)]">
      <AnnouncementBanner />
      <OfflineBanner />
      <GuestBanner />
      <InstallBanner />
      <nav aria-label={t("mainNav")} className="container flex h-14 items-center">
        <Logo href="/sp/home" />
        <div className="ml-auto flex items-center gap-1">
          <SpNotificationBell />
          <SpHeaderMenu />
        </div>
      </nav>
    </header>
  );
}
