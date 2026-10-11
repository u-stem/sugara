"use client";

import { useQueryClient } from "@tanstack/react-query";
import { UserPlus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { GuestButton } from "@/components/guest-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signUp } from "@/lib/auth-client";
import {
  getPasswordRequirementsText,
  MIN_PASSWORD_LENGTH,
  validatePassword,
} from "@/lib/constants";
import { clearClientCache } from "@/lib/sign-out";

export function SignupForm() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const t = useTranslations("auth");
  const tm = useTranslations("messages");
  const te = useTranslations("authErrors");
  const tpr = useTranslations("passwordRules");
  const pwT = {
    rules: (key: string, params?: Record<string, string | number | Date>) =>
      tpr(key as "minLength", params),
    separator: tpr("separator"),
  };
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [passwordInput, setPasswordInput] = useState("");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    if (!agreed) {
      setError(tm("authSignupTermsRequired"));
      setLoading(false);
      return;
    }

    const formData = new FormData(e.currentTarget);
    const username = formData.get("username");
    const name = formData.get("name");
    const password = formData.get("password");
    const confirmPassword = formData.get("confirmPassword");
    if (
      typeof username !== "string" ||
      typeof name !== "string" ||
      typeof password !== "string" ||
      typeof confirmPassword !== "string"
    ) {
      setLoading(false);
      return;
    }

    const { valid, errors } = validatePassword(password, pwT);
    if (!valid) {
      setError(`${tm("authPasswordTooWeak")}: ${errors.join(pwT.separator)}`);
      setLoading(false);
      return;
    }

    if (password !== confirmPassword) {
      setError(tm("authSignupPasswordMismatch"));
      setLoading(false);
      return;
    }

    const result = await signUp.email({
      username,
      name,
      email: `${username}@sugara.local`,
      password,
    });
    if (result.error) {
      // 403 = signup disabled by admin
      let msg: string;
      if (result.error.status === 403) {
        msg = tm("authSignupDisabled");
      } else {
        const code = result.error.code;
        msg =
          code && (te.has as (k: string) => boolean)(code)
            ? (te as (k: string) => string)(code)
            : tm("authSignupFailed");
      }
      setError(msg);
      setLoading(false);
      return;
    }
    // Drop any cache a previous user left behind (e.g. their session expired without
    // an explicit sign-out) so it is never shown to, or hydrated for, this account.
    await clearClientCache(queryClient);
    toast.success(tm("authSignupSuccess"));
    setLoading(false);
    router.push("/home");
  }

  return (
    <Card className="w-full max-w-md border-0 shadow-none sm:border sm:shadow-sm">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">{t("signupTitle")}</CardTitle>
        <CardDescription>{t("signupDescription")}</CardDescription>
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
              pattern="^[a-zA-Z0-9_]+$"
              title={t("usernameHint")}
              minLength={3}
              maxLength={20}
              required
            />
            <p className="text-xs text-muted-foreground">{t("usernameHint")}</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="name">
              {t("displayName")} <span className="text-destructive">*</span>
            </Label>
            <Input
              id="name"
              name="name"
              type="text"
              placeholder={t("displayNamePlaceholder")}
              autoComplete="name"
              required
              minLength={1}
              maxLength={50}
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
              placeholder={t("passwordMinLength")}
              autoComplete="new-password"
              minLength={MIN_PASSWORD_LENGTH}
              required
              value={passwordInput}
              onChange={(e) => setPasswordInput(e.target.value)}
            />
            {passwordInput.length > 0 ? (
              <PasswordStrength password={passwordInput} />
            ) : (
              <p className="text-xs text-muted-foreground">{getPasswordRequirementsText(pwT)}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirmPassword">
              {t("passwordConfirm")} <span className="text-destructive">*</span>
            </Label>
            <Input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              minLength={MIN_PASSWORD_LENGTH}
              required
            />
          </div>
          <div className="flex items-start gap-2">
            <Checkbox
              id="terms"
              checked={agreed}
              onCheckedChange={(checked) => setAgreed(checked === true)}
              className="mt-0.5"
            />
            <Label
              htmlFor="terms"
              className="text-sm font-normal leading-relaxed text-muted-foreground"
            >
              <a
                href="/terms"
                target="_blank"
                rel="noopener noreferrer"
                className="text-foreground underline underline-offset-4"
              >
                {t("termsLink")}
              </a>
              {t("termsAnd")}
              <a
                href="/privacy"
                target="_blank"
                rel="noopener noreferrer"
                className="text-foreground underline underline-offset-4"
              >
                {t("privacyLink")}
              </a>
              {t("agreeTerms")}
            </Label>
          </div>
          {error && (
            <div
              role="alert"
              className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {error}
            </div>
          )}
          <Button type="submit" className="h-11 w-full" disabled={loading || !agreed}>
            <UserPlus className="h-4 w-4" />
            {loading ? t("signingUp") : t("signupTitle")}
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            {t("haveAccount")}{" "}
            <Link href="/auth/login" className="text-foreground underline underline-offset-4">
              {t("loginLink")}
            </Link>
          </p>
          <p className="text-center text-xs text-muted-foreground">
            {t("usernamePasswordWarning")}
          </p>
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

function PasswordStrength({ password }: { password: string }) {
  const t = useTranslations("auth");
  const tpr = useTranslations("passwordRules");
  const pwT = {
    rules: (key: string, params?: Record<string, string | number | Date>) =>
      tpr(key as "minLength", params),
    separator: tpr("separator"),
  };
  const { errors } = validatePassword(password, pwT);
  if (errors.length === 0) {
    return <p className="text-xs text-green-600 dark:text-green-400">{t("passwordStrengthOk")}</p>;
  }
  return (
    <p className="text-xs text-muted-foreground">
      {t("passwordStrengthFail")}: {errors.join(pwT.separator)}
    </p>
  );
}
