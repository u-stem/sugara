import { isShareToken, type QuickPollResponse } from "@sugara/shared";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { pageTitle } from "@/lib/constants";
import { getSeason } from "@/lib/season";
import { QuickPollClient } from "./_components/quick-poll-client";

type Props = { params: Promise<{ token: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { token } = await params;
  const tp = await getTranslations("poll");
  const season = getSeason();
  const ogImage = `/icons/apple-touch-icon-${season}.png`;
  const fallback: Metadata = {
    title: pageTitle(tp("pageTitle")),
    openGraph: { images: [ogImage] },
    twitter: { card: "summary", images: [ogImage] },
  };

  // Never interpolate an unvalidated URL segment into the API path
  if (!isShareToken(token)) return fallback;

  try {
    const baseUrl = process.env.BETTER_AUTH_BASE_URL ?? "http://localhost:3000";
    // API returns Cache-Control: private (per-user vote state), but Next.js
    // Data Cache handles server-side caching independently via revalidate
    const res = await fetch(`${baseUrl}/api/shared/quick-polls/${token}`, {
      next: { revalidate: 60 },
    });
    if (!res.ok) return fallback;

    const poll = (await res.json()) as QuickPollResponse;
    const description = tp("optionsCount", { count: poll.options.length });

    return {
      title: pageTitle(poll.question),
      description,
      openGraph: {
        title: poll.question,
        description,
        images: [ogImage],
        type: "website",
      },
      twitter: {
        card: "summary",
        title: poll.question,
        description,
        images: [ogImage],
      },
    };
  } catch {
    return fallback;
  }
}

export default async function QuickPollPage({ params }: Props) {
  const { token } = await params;
  if (!isShareToken(token)) notFound();

  const baseUrl = process.env.BETTER_AUTH_BASE_URL ?? "http://localhost:3000";
  const res = await fetch(`${baseUrl}/api/shared/quick-polls/${token}`, {
    next: { revalidate: 60 },
  });
  if (!res.ok) notFound();

  return <QuickPollClient token={token} />;
}
