"use client";

import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { WeatherOverview } from "@/components/weather-overview";
import { pageTitle } from "@/lib/constants";

// Shared body for the desktop and SP weather overview pages; only basePath differs.
export function WeatherToolPage({ basePath }: { basePath: string }) {
  const t = useTranslations("weatherTool");

  useEffect(() => {
    document.title = pageTitle(t("title"));
  }, [t]);

  return (
    <div className="mt-4">
      <WeatherOverview basePath={basePath} />
    </div>
  );
}
