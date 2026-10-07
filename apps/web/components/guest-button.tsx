"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { clearClientCache } from "@/lib/sign-out";

export function GuestButton() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const t = useTranslations("auth");
  const tm = useTranslations("messages");
  const [loading, setLoading] = useState(false);

  async function handleGuest() {
    setLoading(true);
    try {
      const result = await authClient.signIn.anonymous();
      if (result.error) {
        toast.error(tm("authGuestFailed"));
        return;
      }
      // Drop any cache a previous user left behind (e.g. their session expired without
      // an explicit sign-out) so it is never shown to, or hydrated for, this account.
      await clearClientCache(queryClient);
      toast.success(tm("authGuestStarted"));
      router.push("/home");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button variant="outline" className="h-11 w-full" onClick={handleGuest} disabled={loading}>
      {loading ? t("guestCreating") : t("guestButton")}
    </Button>
  );
}
