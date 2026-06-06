import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Logo } from "@/components/logo";
import { pageTitle } from "@/lib/constants";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("pageTitle");
  return { title: pageTitle(t("terms")) };
}

export default async function TermsPage() {
  const t = await getTranslations("legal");

  return (
    <div className="flex min-h-screen flex-col">
      <header className="container flex h-14 items-center">
        <Logo href="/" />
      </header>

      <main className="container max-w-3xl flex-1 px-4 py-8">
        <h1 className="text-2xl font-bold">{t("termsTitle")}</h1>

        <section className="mt-8 space-y-6">
          <div>
            <h2 className="text-lg font-semibold">{t("terms.article1Title")}</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {t("terms.article1Content")}
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold">{t("terms.article2Title")}</h2>
            <ol className="mt-2 list-inside list-decimal space-y-1 text-sm text-muted-foreground">
              <li>{t("terms.article2Item1")}</li>
              <li>{t("terms.article2Item2")}</li>
              <li>{t("terms.article2Item3")}</li>
              <li>{t("terms.article2Item4")}</li>
            </ol>
          </div>

          <div>
            <h2 className="text-lg font-semibold">{t("terms.article3Title")}</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {t("terms.article3Intro")}
            </p>
            <ol className="mt-2 list-inside list-decimal space-y-1 text-sm text-muted-foreground">
              <li>{t("terms.article3Item1")}</li>
              <li>{t("terms.article3Item2")}</li>
              <li>{t("terms.article3Item3")}</li>
              <li>{t("terms.article3Item4")}</li>
              <li>{t("terms.article3Item5")}</li>
              <li>{t("terms.article3Item6")}</li>
              <li>{t("terms.article3Item7")}</li>
            </ol>
          </div>

          <div>
            <h2 className="text-lg font-semibold">{t("terms.article4Title")}</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {t("terms.article4Content")}
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold">{t("terms.article5Title")}</h2>
            <ol className="mt-2 list-inside list-decimal space-y-1 text-sm text-muted-foreground">
              <li>{t("terms.article5Item1")}</li>
              <li>{t("terms.article5Item2")}</li>
              <li>{t("terms.article5Item3")}</li>
              <li>{t("terms.article5Item4")}</li>
            </ol>
          </div>

          <div>
            <h2 className="text-lg font-semibold">{t("terms.article6Title")}</h2>
            <ol className="mt-2 list-inside list-decimal space-y-1 text-sm text-muted-foreground">
              <li>{t("terms.article6Item1")}</li>
              <li>{t("terms.article6Item2")}</li>
            </ol>
          </div>

          <div>
            <h2 className="text-lg font-semibold">{t("terms.article7Title")}</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {t("terms.article7Content")}
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold">{t("terms.article8Title")}</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {t("terms.article8Content")}
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold">{t("terms.article9Title")}</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {t("terms.article9Content")}
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold">{t("terms.article10Title")}</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {t("terms.article10Date1")}
              <br />
              {t("terms.article10Date2")}
              <br />
              {t("terms.article10Date3")}
              <br />
              {t("terms.article10Date4")}
            </p>
          </div>
        </section>
      </main>

      <footer className="container flex flex-wrap items-center justify-center gap-x-4 gap-y-1 py-4 text-sm text-muted-foreground">
        <Link href="/faq" className="underline underline-offset-4 hover:text-foreground">
          {t("footer.faq")}
        </Link>
        <Link href="/news" className="underline underline-offset-4 hover:text-foreground">
          {t("footer.news")}
        </Link>
        <Link href="/privacy" className="underline underline-offset-4 hover:text-foreground">
          {t("footer.privacy")}
        </Link>
      </footer>
    </div>
  );
}
