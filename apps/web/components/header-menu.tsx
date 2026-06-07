"use client";

import { Keyboard, LogOut, Monitor, Settings, Smartphone, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import {
  ResponsiveAlertDialog,
  ResponsiveAlertDialogCancel,
  ResponsiveAlertDialogContent,
  ResponsiveAlertDialogDescription,
  ResponsiveAlertDialogFooter,
  ResponsiveAlertDialogHeader,
  ResponsiveAlertDialogTitle,
  ResponsiveAlertDialogTrigger,
} from "@/components/ui/responsive-alert-dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { authClient } from "@/lib/auth-client";
import { useShortcutHelp } from "@/lib/shortcut-help-context";
import { cn } from "@/lib/utils";
import { switchViewMode } from "@/lib/view-mode";

const ANIMATION_DURATION = 300;

function useMenuState() {
  const [expanded, setExpanded] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const animatingRef = useRef(false);
  const pathname = usePathname();

  function toggle() {
    if (animatingRef.current) return;
    animatingRef.current = true;
    setExpanded((prev) => !prev);
    setTimeout(() => {
      animatingRef.current = false;
    }, ANIMATION_DURATION);
  }

  useEffect(() => {
    setExpanded(false);
  }, [pathname]);

  useEffect(() => {
    if (!expanded) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setExpanded(false);
      }
    }
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [expanded]);

  return { expanded, toggle, ref };
}

/** Animated hamburger icon that morphs to X via CSS transitions. */
function HamburgerIcon({ open, className }: { open: boolean; className?: string }) {
  const bar =
    "absolute left-1/2 h-[2px] w-5 -translate-x-1/2 rounded-full bg-current transition-all duration-300";

  return (
    <span className={cn("relative block h-5 w-5", className)} aria-hidden>
      <span className={cn(bar, open ? "top-1/2 -translate-y-1/2 rotate-45" : "top-[3px]")} />
      <span className={cn(bar, "top-1/2 -translate-y-1/2", open && "opacity-0")} />
      <span
        className={cn(bar, open ? "top-1/2 -translate-y-1/2 -rotate-45" : "bottom-[3px] top-auto")}
      />
    </span>
  );
}

/**
 * Collapsible header menu for desktop.
 * Click the hamburger to reveal: SP toggle, theme, settings, logout.
 */
export function HeaderMenu() {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const router = useRouter();
  const { expanded, toggle, ref } = useMenuState();

  const showSpToggle = !/\/(print|export)(\/|$)/.test(pathname);
  const { open: openShortcutHelp } = useShortcutHelp();

  return (
    <div ref={ref} className="relative flex items-center">
      {expanded && (
        <div
          id="header-menu-panel"
          className="absolute right-0 top-full z-50 mt-1 flex items-center gap-1 rounded-md border bg-popover p-1 shadow-md animate-in fade-in duration-150 md:static md:z-auto md:mt-0 md:rounded-none md:border-0 md:bg-transparent md:p-0 md:shadow-none"
        >
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={t("shortcutList")}
                onClick={openShortcutHelp}
                className="group flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
              >
                <Keyboard className="h-5 w-5 transition-transform duration-200 group-hover:scale-110" />
              </button>
            </TooltipTrigger>
            <TooltipContent>{t("shortcutList")}</TooltipContent>
          </Tooltip>
          {showSpToggle && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={t("switchToSp")}
                  onClick={() => void switchViewMode("sp", (url) => router.push(url))}
                  className="group flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                >
                  <Smartphone className="h-5 w-5 transition-transform duration-200 group-hover:-rotate-12" />
                </button>
              </TooltipTrigger>
              <TooltipContent>{t("switchToSp")}</TooltipContent>
            </Tooltip>
          )}
          <LocaleSwitcher />
          <ThemeToggle />
          <Tooltip>
            <TooltipTrigger asChild>
              <Link
                href="/settings"
                aria-label={t("settings")}
                className="group flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
              >
                <Settings className="h-5 w-5 transition-transform duration-300 group-hover:rotate-90" />
              </Link>
            </TooltipTrigger>
            <TooltipContent>{t("settings")}</TooltipContent>
          </Tooltip>
          <SignOutButton />
        </div>
      )}
      <button
        type="button"
        aria-label={expanded ? t("closeMenu") : t("openMenu")}
        aria-expanded={expanded}
        aria-controls="header-menu-panel"
        onClick={toggle}
        className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
      >
        <HamburgerIcon open={expanded} />
      </button>
    </div>
  );
}

/**
 * Collapsible header menu for SP.
 * Tap the hamburger to toggle: PC toggle, theme, settings, logout.
 */
export function SpHeaderMenu() {
  const t = useTranslations("nav");
  const router = useRouter();
  const { expanded, toggle, ref } = useMenuState();

  return (
    <div ref={ref} className="relative flex items-center">
      {expanded && (
        <div
          id="sp-header-menu-panel"
          className="absolute right-0 top-full z-50 mt-1 flex items-center gap-1 rounded-md border bg-popover p-1 shadow-md animate-in fade-in duration-150"
        >
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={t("switchToPc")}
                onClick={() => void switchViewMode("desktop", (url) => router.push(url))}
                className="group flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <Monitor className="h-6 w-6 transition-transform duration-200 group-hover:scale-110" />
              </button>
            </TooltipTrigger>
            <TooltipContent>{t("switchToPc")}</TooltipContent>
          </Tooltip>
          <LocaleSwitcher />
          <ThemeToggle iconClassName="h-6 w-6" />
          <Tooltip>
            <TooltipTrigger asChild>
              <Link
                href="/sp/settings"
                aria-label={t("settings")}
                className="group flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <Settings className="h-6 w-6 transition-transform duration-300 group-hover:rotate-90" />
              </Link>
            </TooltipTrigger>
            <TooltipContent>{t("settings")}</TooltipContent>
          </Tooltip>
          <SignOutButton />
        </div>
      )}
      <button
        type="button"
        aria-label={expanded ? t("closeMenu") : t("openMenu")}
        aria-expanded={expanded}
        aria-controls="sp-header-menu-panel"
        onClick={toggle}
        className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <HamburgerIcon open={expanded} className="h-6 w-6" />
      </button>
    </div>
  );
}

function SignOutButton() {
  const t = useTranslations("nav");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSignOut() {
    setLoading(true);
    await authClient.signOut();
    window.location.href = "/auth/login";
  }

  return (
    <ResponsiveAlertDialog open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <ResponsiveAlertDialogTrigger asChild>
            <button
              type="button"
              aria-label={t("logout")}
              className="group flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            >
              <LogOut className="h-5 w-5 transition-transform duration-200 group-hover:translate-x-0.5" />
            </button>
          </ResponsiveAlertDialogTrigger>
        </TooltipTrigger>
        <TooltipContent>{t("logout")}</TooltipContent>
      </Tooltip>
      <ResponsiveAlertDialogContent>
        <ResponsiveAlertDialogHeader>
          <ResponsiveAlertDialogTitle>{t("logoutConfirm")}</ResponsiveAlertDialogTitle>
          <ResponsiveAlertDialogDescription>
            {t("logoutDescription")}
          </ResponsiveAlertDialogDescription>
        </ResponsiveAlertDialogHeader>
        <ResponsiveAlertDialogFooter>
          <ResponsiveAlertDialogCancel disabled={loading}>
            <X className="h-4 w-4" />
            {tc("cancel")}
          </ResponsiveAlertDialogCancel>
          <Button disabled={loading} onClick={handleSignOut}>
            <LogOut className="h-4 w-4" />
            {loading ? t("loggingOut") : t("logout")}
          </Button>
        </ResponsiveAlertDialogFooter>
      </ResponsiveAlertDialogContent>
    </ResponsiveAlertDialog>
  );
}
