import { isShareToken, type SharedTripResponse } from "@sugara/shared";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { pageTitle } from "@/lib/constants";
import { formatDateRange } from "@/lib/format";
import { getSeason } from "@/lib/season";
import { SharedTripClient } from "./_components/shared-trip-client";

type Props = { params: Promise<{ token: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { token } = await params;
  const season = getSeason();
  const ogImage = `/icons/apple-touch-icon-${season}.png`;
  const tpt = await getTranslations("pageTitle");
  const fallback: Metadata = {
    title: pageTitle(tpt("sharedPlan")),
    openGraph: { images: [ogImage] },
    twitter: { card: "summary", images: [ogImage] },
  };

  // Never interpolate an unvalidated URL segment into the API path
  if (!isShareToken(token)) return fallback;

  try {
    const locale = await getLocale();
    const baseUrl = process.env.BETTER_AUTH_BASE_URL ?? "http://localhost:3000";
    // Cache OGP data for 60s to balance freshness with server load on social crawlers
    const res = await fetch(`${baseUrl}/api/shared/${token}`, {
      next: { revalidate: 60 },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return fallback;

    const trip = (await res.json()) as SharedTripResponse;
    const description = [
      trip.destination,
      trip.startDate && trip.endDate ? formatDateRange(trip.startDate, trip.endDate, locale) : null,
    ]
      .filter(Boolean)
      .join(" · ");

    return {
      title: pageTitle(trip.title),
      description,
      openGraph: {
        title: trip.title,
        description,
        images: [ogImage],
        type: "website",
      },
      twitter: {
        card: "summary",
        title: trip.title,
        description,
        images: [ogImage],
      },
    };
  } catch {
    return fallback;
  }
}

export default async function SharedTripPage({ params }: Props) {
  const { token } = await params;
  if (!isShareToken(token)) notFound();

  const baseUrl = process.env.BETTER_AUTH_BASE_URL ?? "http://localhost:3000";
  const res = await fetch(`${baseUrl}/api/shared/${token}`, {
    next: { revalidate: 60 },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) notFound();

  return <SharedTripClient token={token} />;
}
