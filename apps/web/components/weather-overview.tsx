"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Search } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { LoadingBoundary } from "@/components/ui/loading-boundary";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import { WEATHER_GROUPS } from "@/lib/weather-area-i18n";
import { formatReportTime } from "@/lib/weather-format";
import { centerName, centerShort, officeName } from "@/lib/weather-names";
import { WEATHER_SEARCH_INDEX } from "@/lib/weather-search-index";

const CHIP_SKELETONS = ["c1", "c2", "c3", "c4", "c5", "c6"];
const CARD_SKELETONS = ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8"];

// The regions/offices are static, but the list is gated on the (freshness) query
// so the page matches the app's skeleton-until-ready convention rather than
// popping the freshness line in afterwards. basePath differs between desktop
// (/tools/weather) and SP (/sp/tools/weather).
export function WeatherOverview({ basePath }: { basePath: string }) {
  const t = useTranslations("weatherTool");
  const locale = useLocale();
  const [query, setQuery] = useState("");
  const [selectedCenters, setSelectedCenters] = useState<Set<string>>(new Set());
  const { data, isLoading, isError } = useQuery({
    queryKey: queryKeys.weather.overview(),
    queryFn: () => api<{ reportDatetime: string | null }>("/api/weather/overview"),
  });

  function toggleCenter(centerCode: string) {
    setSelectedCenters((prev) => {
      const next = new Set(prev);
      if (next.has(centerCode)) next.delete(centerCode);
      else next.add(centerCode);
      return next;
    });
  }

  const q = query.trim();
  const needle = q.toLowerCase();
  // Match against the search index (region + every descendant city name, kana,
  // and English name), case-insensitively.
  const matches = (officeCode: string) =>
    (WEATHER_SEARCH_INDEX[officeCode] ?? officeName(officeCode, locale).toLowerCase()).includes(
      needle,
    );

  const visibleGroups = WEATHER_GROUPS.filter(
    (g) => selectedCenters.size === 0 || selectedCenters.has(g.centerCode),
  )
    .map((g) => ({
      centerCode: g.centerCode,
      officeCodes: q ? g.officeCodes.filter(matches) : g.officeCodes,
    }))
    .filter((g) => g.officeCodes.length > 0);

  return (
    <LoadingBoundary
      isLoading={isLoading}
      error={isError ? new Error("weather overview") : null}
      errorFallback={<p className="text-sm text-muted-foreground">{t("loadError")}</p>}
      skeleton={
        <div className="space-y-4">
          <Skeleton className="h-5 w-72 max-w-full" />
          <Skeleton className="h-9 w-full" />
          <div className="space-y-2">
            <Skeleton className="h-5 w-40" />
            <div className="flex flex-wrap gap-1.5">
              {CHIP_SKELETONS.map((c) => (
                <Skeleton key={c} className="h-8 w-20 rounded-full" />
              ))}
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {CARD_SKELETONS.map((s) => (
              <Skeleton key={s} className="h-11 w-full rounded-lg" />
            ))}
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {t("subtitle")}
          {data?.reportDatetime &&
            t("freshness", { datetime: formatReportTime(data.reportDatetime, locale) })}
        </p>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("searchPlaceholder")}
            aria-label={t("searchPlaceholder")}
            className="pl-9"
          />
        </div>

        <div className="space-y-5">
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">{t("regionFilter")}</p>
            <div className="flex flex-wrap gap-1.5">
              {WEATHER_GROUPS.map((group) => {
                const selected = selectedCenters.has(group.centerCode);
                return (
                  <button
                    key={group.centerCode}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => toggleCenter(group.centerCode)}
                    className={cn(
                      "rounded-full border px-3 py-1 text-sm font-medium transition-colors",
                      selected
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-input bg-background text-muted-foreground hover:bg-accent",
                    )}
                  >
                    {centerShort(group.centerCode, locale)}
                  </button>
                );
              })}
            </div>
          </div>

          {visibleGroups.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noResults", { query: q })}</p>
          ) : (
            visibleGroups.map((group) => (
              <section key={group.centerCode} className="space-y-2">
                <h2 className="text-sm font-semibold text-muted-foreground">
                  {centerName(group.centerCode, locale)}
                </h2>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {group.officeCodes.map((officeCode) => (
                    <Link
                      key={officeCode}
                      href={`${basePath}/${officeCode}`}
                      className="flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm transition-colors hover:bg-accent"
                    >
                      <span className="flex-1 truncate font-medium">
                        {officeName(officeCode, locale)}
                      </span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                    </Link>
                  ))}
                </div>
              </section>
            ))
          )}
        </div>
      </div>
    </LoadingBoundary>
  );
}
