"use client";

import { Check, ChevronRight, CloudSun, Copy, Dices, Pencil, Vote } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { toast } from "sonner";
import { MyQrDialog } from "@/components/my-qr-dialog";
import type { ShortcutGroup } from "@/components/shortcut-help-dialog";
import { UnsettledSummarySection } from "@/components/unsettled-summary";
import { UserAvatar } from "@/components/user-avatar";
import { useSession } from "@/lib/auth-client";
import { copyToClipboard } from "@/lib/clipboard";
import { pageTitle } from "@/lib/constants";
import { isDialogOpen } from "@/lib/hotkeys";
import { useRegisterShortcuts, useShortcutHelp } from "@/lib/shortcut-help-context";

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
      {children}
    </h2>
  );
}

export default function MyPage() {
  const tp = useTranslations("profile");
  const tm = useTranslations("messages");
  const { data: session } = useSession();
  const router = useRouter();
  const [idCopied, setIdCopied] = useState(false);

  const { open: openShortcutHelp } = useShortcutHelp();
  const shortcuts: ShortcutGroup[] = useMemo(
    () => [
      {
        group: tp("shortcutGeneral"),
        items: [{ key: "e", description: tp("shortcutEditProfile") }],
      },
    ],
    [tp],
  );
  useRegisterShortcuts(shortcuts);

  useEffect(() => {
    document.title = pageTitle(tp("pageTitle"));
  }, [tp]);

  useHotkeys("?", () => openShortcutHelp(), { useKey: true, preventDefault: true });
  useHotkeys(
    "e",
    () => {
      if (!isDialogOpen()) router.push("/my/edit");
    },
    { preventDefault: true },
  );

  const user = session?.user;
  const userId = user?.id;

  async function handleCopyId() {
    if (!userId) return;
    await copyToClipboard(userId);
    setIdCopied(true);
    toast.success(tm("settingsUserIdCopied"));
    setTimeout(() => setIdCopied(false), 2000);
  }

  return (
    <div className="mt-4 mx-auto max-w-2xl space-y-6">
      {/* Profile header */}
      <div className="flex items-center gap-4">
        <UserAvatar
          name={user?.name ?? ""}
          image={user?.image}
          className="h-14 w-14 shrink-0"
          fallbackClassName="text-xl"
        />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold">{user?.name}</h1>
          {userId && (
            <button
              type="button"
              onClick={handleCopyId}
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
              aria-label={tp("copyUserId")}
            >
              <span className="sr-only" data-testid="user-id">
                {userId}
              </span>
              <span>ID:</span>
              <code className="font-mono">{userId.slice(0, 8)}...</code>
              {idCopied ? (
                <Check className="h-3.5 w-3.5 text-green-500" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </button>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Link
            href="/my/edit"
            className="inline-flex h-8 items-center gap-1.5 rounded-full border px-4 text-sm hover:bg-accent"
          >
            <Pencil className="h-3 w-3" />
            {tp("edit")}
            <span className="hidden text-xs text-muted-foreground lg:inline">(E)</span>
          </Link>
          {userId && <MyQrDialog userId={userId} />}
        </div>
      </div>

      {/* Unsettled summary */}
      {userId && <UnsettledSummarySection userId={userId} isOwnProfile />}

      {/* Tools */}
      <div className="space-y-2">
        <SectionHeading>{tp("tools")}</SectionHeading>
        <Link
          href="/polls"
          className="flex items-center gap-3 rounded-lg border px-4 py-3 text-sm hover:bg-accent transition-colors"
        >
          <Vote className="h-5 w-5 text-muted-foreground" />
          <span className="flex-1 font-medium">{tp("quickPoll")}</span>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </Link>
        <Link
          href="/tools/roulette"
          className="flex items-center gap-3 rounded-lg border px-4 py-3 text-sm hover:bg-accent transition-colors"
        >
          <Dices className="h-5 w-5 text-muted-foreground" />
          <span className="flex-1 font-medium">{tp("roulette")}</span>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </Link>
        <Link
          href="/tools/weather"
          className="flex items-center gap-3 rounded-lg border px-4 py-3 text-sm hover:bg-accent transition-colors"
        >
          <CloudSun className="h-5 w-5 text-muted-foreground" />
          <span className="flex-1 font-medium">{tp("weather")}</span>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </Link>
      </div>
    </div>
  );
}
