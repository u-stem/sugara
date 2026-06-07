import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { pageTitle } from "@/lib/constants";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("pageTitle");
  return { title: pageTitle(t("articles")) };
}

export default function ArticlesLayout({ children }: { children: React.ReactNode }) {
  return children;
}
