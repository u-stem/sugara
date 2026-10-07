"use client";

import { useQueryClient } from "@tanstack/react-query";
import { LogIn } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { GuestButton } from "@/components/guest-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signIn } from "@/lib/auth-client";
import { MIN_PASSWORD_LENGTH } from "@/lib/constants";
import { clearClientCache } from "@/lib/sign-out";

export function AuthForm() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const t = useTranslations("auth");
  const tm = useTranslations("messages");
  const te = useTranslations("authErrors");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const formData = new FormData(e.currentTarget);
    const username = formData.get("username");
    const password = formData.get("password");
    if (typeof username !== "string" || typeof password !== "string") {
      setLoading(false);
      return;
    }

    const result = await signIn.username({ username, password });
    if (result.error) {
      const code = result.error.code;
      const errorMsg =
        code && (te.has as (k: string) => boolean)(code)
          ? (te as (k: string) => string)(code)
          : tm("authLoginFailed");
      setError(errorMsg);
      setLoading(false);
      return;
    }
    // Drop any cache a previous user left behind (e.g. their session expired without
    // an explicit sign-out) so it is never shown to, or hydrated for, this account.
    await clearClientCache(queryClient);
    toast.success(tm("authLoginSuccess"));
    setLoading(false);
    router.push("/home");
  }

  return (
    <Card className="w-full max-w-md border-0 shadow-none sm:border sm:shadow-sm">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">{t("loginTitle")}</CardTitle>
        <CardDescription>{t("loginDescription")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="username">
              {t("username")} <span className="text-destructive">*</span>
            </Label>
            <Input
              id="username"
              name="username"
              type="text"
              placeholder="taro_123"
              autoComplete="username"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">
              {t("password")} <span className="text-destructive">*</span>
            </Label>
            <Input
              id="password"
              name="password"
              type="password"
              placeholder={t("password")}
              minLength={MIN_PASSWORD_LENGTH}
              autoComplete="current-password"
              required
            />
          </div>
          {error && (
            <div
              role="alert"
              className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {error}
            </div>
          )}
          <Button type="submit" className="h-11 w-full" disabled={loading}>
            <LogIn className="h-4 w-4" />
            {loading ? t("loggingIn") : t("loginTitle")}
          </Button>
          <div className="text-right">
            <Link
              href="/auth/forgot-password"
              className="text-xs text-muted-foreground hover:underline"
            >
              {t("forgotPassword")}
            </Link>
          </div>
          <p className="text-center text-sm text-muted-foreground">
            {t("noAccount")}{" "}
            <Link href="/auth/signup" className="text-foreground underline underline-offset-4">
              {t("signupLink")}
            </Link>
          </p>
          <p className="text-center text-xs text-muted-foreground">{t("usernameWarning")}</p>
        </form>
        <div className="mt-4 flex items-center gap-4">
          <div className="flex-1 border-t" />
          <span className="text-xs text-muted-foreground">{t("or")}</span>
          <div className="flex-1 border-t" />
        </div>
        <div className="mt-4">
          <GuestButton />
        </div>
      </CardContent>
    </Card>
  );
}
