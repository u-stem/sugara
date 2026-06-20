"use client";

import { useLocale, useTranslations } from "next-intl";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { OFFICE_CENTER, WEATHER_GROUPS } from "@/lib/weather-area-i18n";
import { WEATHER_MAP_PATHS } from "@/lib/weather-map-paths";
import { centerNameForOffice, officeName } from "@/lib/weather-names";

const CC_BY_URL = "https://creativecommons.org/licenses/by/4.0/";
const MAP_SOURCE_URL = "https://geoshape.ex.nii.ac.jp/jma/resource/AreaForecastLocalM_1saibun/";

type BBox = { minX: number; minY: number; maxX: number; maxY: number };

// BBox of a path's largest sub-polygon, in viewBox units. Framing the map by the
// largest part keeps far-flung islands (Tokyo's Ogasawara, Kagoshima's outer
// isles) from blowing the viewBox out to mostly-ocean. Accepts both "Z" and "z"
// close commands so future regenerated data with relative paths stays correct.
function largestPartBBox(d: string): BBox | null {
  let best: (BBox & { count: number }) | null = null;
  for (const part of d.split(/[Zz]/)) {
    const nums = part.match(/-?\d+(?:\.\d+)?/g);
    if (!nums || nums.length < 4) continue;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i + 1 < nums.length; i += 2) {
      const x = Number(nums[i]);
      const y = Number(nums[i + 1]);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const count = nums.length / 2;
    if (!best || count > best.count) best = { count, minX, minY, maxX, maxY };
  }
  return best;
}

type MapLayout = {
  codes: string[];
  viewBox: string;
  maxWidthPx: number;
  aspectRatio: number;
};

// Geometry for the active area's center-region map, shared by the map and its
// loading skeleton so both occupy the identical box (no layout shift on load).
function weatherMapLayout(officeCode: string): MapLayout | null {
  if (!Object.hasOwn(WEATHER_MAP_PATHS, officeCode)) return null;

  const centerCode = OFFICE_CENTER[officeCode];
  const group = WEATHER_GROUPS.find((g) => g.centerCode === centerCode);
  const codes = (group?.officeCodes ?? [officeCode]).filter((c) =>
    Object.hasOwn(WEATHER_MAP_PATHS, c),
  );

  // Frame the viewBox to the center region's mainland extent, with padding.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const code of codes) {
    const b = largestPartBBox(WEATHER_MAP_PATHS[code]);
    if (!b) continue;
    if (b.minX < minX) minX = b.minX;
    if (b.minY < minY) minY = b.minY;
    if (b.maxX > maxX) maxX = b.maxX;
    if (b.maxY > maxY) maxY = b.maxY;
  }
  const w = maxX - minX;
  const h = maxY - minY;
  if (!(w > 0) || !(h > 0)) return null;

  const pad = Math.max(w, h) * 0.06;
  const boxW = w + pad * 2;
  const boxH = h + pad * 2;
  // Cap width so a tall center region (Tohoku, Hokuriku) doesn't render too tall:
  // bound height to ~18rem (288px) and width to ~24rem (384px), preserving aspect
  // with no letterboxing (width-only constraint keeps the SVG's intrinsic ratio).
  return {
    codes,
    viewBox: `${minX - pad} ${minY - pad} ${boxW} ${boxH}`,
    maxWidthPx: Math.min(384, 288 * (w / h)),
    aspectRatio: boxW / boxH,
  };
}

// Region map for the weather detail page: a static SVG zoomed to the active
// area's center region (北海道地方 → Hokkaido, 東北地方 → Tohoku, ...), drawing
// only that region's offices and filling the active one. Zooming to the center
// region keeps subdivided areas (Hokkaido's 8 offices, Okinawa, Amami) legible
// instead of pixel-sized on a full-country map. No external map API — paths ship
// as static data, so this renders offline and stays cheap.
export function JapanWeatherMap({ officeCode }: { officeCode: string }) {
  const t = useTranslations("weatherTool");
  const locale = useLocale();

  // Unknown office (e.g. a new area added before the map is regenerated): skip
  // the map rather than render an empty frame.
  const layout = weatherMapLayout(officeCode);
  if (!layout) return null;

  const center = centerNameForOffice(officeCode, locale);
  const name = center
    ? locale === "en"
      ? `${officeName(officeCode, locale)} (${center})`
      : `${officeName(officeCode, locale)}（${center}）`
    : officeName(officeCode, locale);

  return (
    <svg
      role="img"
      aria-label={t("mapLabel", { name })}
      viewBox={layout.viewBox}
      className="mx-auto h-auto w-full"
      style={{ maxWidth: `${layout.maxWidthPx}px` }}
    >
      {layout.codes.map((code) => (
        <path
          key={code}
          data-office={code}
          d={WEATHER_MAP_PATHS[code]}
          className={cn(
            "stroke-background [stroke-width:1.5] [vector-effect:non-scaling-stroke]",
            code === officeCode ? "fill-chart-1 stroke-chart-1" : "fill-muted",
          )}
        />
      ))}
    </svg>
  );
}

// Loading placeholder that matches the rendered map's box exactly (same max width
// and aspect ratio) so swapping in the map causes no layout shift.
export function JapanWeatherMapSkeleton({ officeCode }: { officeCode: string }) {
  const layout = weatherMapLayout(officeCode);
  if (!layout) return null;
  return (
    <div className="flex justify-center">
      <Skeleton
        className="w-full rounded-md"
        style={{ maxWidth: `${layout.maxWidthPx}px`, aspectRatio: layout.aspectRatio }}
      />
    </div>
  );
}

// Attribution for the map data. Kept separate from JapanWeatherMap so the credit
// can sit at the bottom of the page (under the table) rather than directly below
// the map. Renders nothing when there is no map to credit.
export function WeatherMapCredit({ officeCode }: { officeCode: string }) {
  const t = useTranslations("weatherTool");
  if (!Object.hasOwn(WEATHER_MAP_PATHS, officeCode)) return null;
  return (
    <p className="text-center text-[0.6875rem] leading-relaxed text-muted-foreground/80">
      <span className="block">
        {t.rich("mapCredit", {
          source: (chunks) => (
            <a
              href={MAP_SOURCE_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={t("mapCreditSourceAria")}
              className="underline-offset-2 hover:text-foreground hover:underline"
            >
              {chunks}
            </a>
          ),
        })}
      </span>
      <a
        href={CC_BY_URL}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={t("mapCreditLicenseAria")}
        className="inline-block underline-offset-2 hover:text-foreground hover:underline"
      >
        {t("mapCreditLicense")}
      </a>
    </p>
  );
}
