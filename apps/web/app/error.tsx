"use client";

import { Home, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { reportError } from "@/lib/report-error";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("error");
  const tc = useTranslations("common");
  useEffect(() => {
    reportError(error);
  }, [error]);
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4">
      <h1 className="text-2xl font-bold">{t("title")}</h1>
      <p className="text-muted-foreground">{t("description")}</p>
      <div className="flex gap-4">
        <Button onClick={reset}>
          <RotateCcw className="h-4 w-4" />
          {tc("retry")}
        </Button>
        <Button variant="outline" asChild>
          <Link href="/home">
            <Home className="h-4 w-4" />
            {tc("returnHome")}
          </Link>
        </Button>
      </div>
    </div>
  );
}
