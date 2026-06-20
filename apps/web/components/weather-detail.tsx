"use client";

import { getWeatherForCode, jstToday, type WeatherDetailResponse } from "@sugara/shared";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import {
  JapanWeatherMap,
  JapanWeatherMapSkeleton,
  WeatherMapCredit,
} from "@/components/japan-weather-map";
import { LoadingBoundary } from "@/components/ui/loading-boundary";
import { Skeleton } from "@/components/ui/skeleton";
import { WeatherIcon } from "@/components/weather-icon";
import { WeatherTemps } from "@/components/weather-temps";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/weather-format";
import { centerNameForOffice, officeName } from "@/lib/weather-names";

const SKELETON_ROWS = ["s1", "s2", "s3", "s4", "s5", "s6", "s7"];

export function WeatherDetail({ officeCode, basePath }: { officeCode: string; basePath: string }) {
  const t = useTranslations("weatherTool");
  const locale = useLocale();
  const { data, isLoading, isError, isFetching } = useQuery({
    queryKey: queryKeys.weather.detail(officeCode),
    queryFn: () => api<WeatherDetailResponse>(`/api/weather/${officeCode}`),
  });
  const today = jstToday();

  const backLink = (
    <Link
      href={basePath}
      className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" />
      {t("back")}
    </Link>
  );

  return (
    <LoadingBoundary
      isLoading={isLoading}
      error={isError ? new Error("weather detail") : null}
      errorFallback={
        <div className="space-y-3">
          {backLink}
          <p className="text-sm text-muted-foreground">{t("loadError")}</p>
        </div>
      }
      skeleton={
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            {backLink}
            <Skeleton className="h-6 w-44" />
          </div>
          <JapanWeatherMapSkeleton officeCode={officeCode} />
          <div className="space-y-2">
            {SKELETON_ROWS.map((row) => (
              <Skeleton key={row} className="h-12 w-full rounded-lg" />
            ))}
          </div>
        </div>
      }
    >
      {data && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {backLink}
            <h1 className="text-lg font-semibold leading-tight">
              {officeName(officeCode, locale)}
              <span className="ml-1 text-sm font-normal text-muted-foreground">
                {locale === "en"
                  ? ` (${centerNameForOffice(officeCode, locale)})`
                  : `（${centerNameForOffice(officeCode, locale)}）`}
              </span>
            </h1>
          </div>

          <JapanWeatherMap officeCode={officeCode} />

          {data.days.length === 0 ? (
            // Suppress the empty notice while a (background) refetch is in flight
            // so it doesn't flash before the forecast arrives.
            isFetching ? null : (
              <p className="text-sm text-muted-foreground">{t("detailEmpty")}</p>
            )
          ) : (
            <div className="overflow-hidden rounded-lg border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30 text-xs text-muted-foreground">
                    <th scope="col" className="px-4 py-2 text-left font-normal">
                      {t("colDate")}
                    </th>
                    <th scope="col" className="px-2 py-2 text-left font-normal">
                      {t("colWeather")}
                    </th>
                    <th scope="col" className="whitespace-nowrap px-2 py-2 text-right font-normal">
                      {t("colTemp")}
                    </th>
                    <th scope="col" className="whitespace-nowrap px-4 py-2 text-right font-normal">
                      {t("colPop")}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {data.days.map((day) => {
                    const { label, labelEn } = getWeatherForCode(day.weatherCode);
                    const weatherLabel = locale === "en" ? labelEn : label;
                    return (
                      <tr key={day.date} className={cn(day.date === today && "bg-accent/40")}>
                        <td className="whitespace-nowrap px-4 py-3 font-medium tabular-nums">
                          {formatDate(day.date, locale)}
                        </td>
                        <td className="px-2 py-3">
                          <span className="flex items-center gap-2">
                            <WeatherIcon
                              weatherCode={day.weatherCode}
                              label={weatherLabel}
                              className="h-5 w-5"
                            />
                            <span className="text-muted-foreground">{weatherLabel}</span>
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-2 py-3 text-right">
                          <WeatherTemps tempMax={day.tempMax} tempMin={day.tempMin} />
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-muted-foreground">
                          {day.pop == null ? "--" : `${day.pop}%`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <WeatherMapCredit officeCode={officeCode} />
        </div>
      )}
    </LoadingBoundary>
  );
}
