"use client";

import { Check, ChevronRight, CloudSun, Copy, Dices, Pencil, Vote } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { MyQrDialog } from "@/components/my-qr-dialog";
import { UnsettledSummarySection } from "@/components/unsettled-summary";
import { UserAvatar } from "@/components/user-avatar";
import { useSession } from "@/lib/auth-client";
import { copyToClipboard } from "@/lib/clipboard";
import { pageTitle } from "@/lib/constants";

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
      {children}
    </h2>
  );
}

export default function SpMyPage() {
  const tp = useTranslations("profile");
  const tm = useTranslations("messages");
  const { data: session } = useSession();
  const [idCopied, setIdCopied] = useState(false);

  useEffect(() => {
    document.title = pageTitle(tp("pageTitle"));
  }, [tp]);

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
      <div className="flex flex-col items-center gap-3 py-2">
        <UserAvatar
          name={user?.name ?? ""}
          image={user?.image}
          className="h-16 w-16"
          fallbackClassName="text-2xl"
        />
        <div className="text-center">
          <h1 className="text-lg font-semibold">{user?.name}</h1>
          {userId && (
            <button
              type="button"
              onClick={handleCopyId}
              className="mt-1 mx-auto flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
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
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/sp/my/edit"
            className="inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-full border px-4 text-sm hover:bg-accent"
          >
            <Pencil className="h-3 w-3" />
            {tp("edit")}
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
          href="/sp/polls"
          className="flex items-center gap-3 rounded-lg border px-4 py-3 text-sm hover:bg-accent transition-colors"
        >
          <Vote className="h-5 w-5 text-muted-foreground" />
          <span className="flex-1 font-medium">{tp("quickPoll")}</span>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </Link>
        <Link
          href="/sp/tools/roulette"
          className="flex items-center gap-3 rounded-lg border px-4 py-3 text-sm hover:bg-accent transition-colors"
        >
          <Dices className="h-5 w-5 text-muted-foreground" />
          <span className="flex-1 font-medium">{tp("roulette")}</span>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </Link>
        <Link
          href="/sp/tools/weather"
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
