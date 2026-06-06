import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Logo } from "@/components/logo";
import { pageTitle } from "@/lib/constants";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("pageTitle");
  return { title: pageTitle(t("privacy")) };
}

export default async function PrivacyPage() {
  const t = await getTranslations("legal");

  return (
    <div className="flex min-h-screen flex-col">
      <header className="container flex h-14 items-center">
        <Logo href="/" />
      </header>

      <main className="container max-w-3xl flex-1 px-4 py-8">
        <h1 className="text-2xl font-bold">{t("privacyTitle")}</h1>

        <section className="mt-8 space-y-6">
          <div>
            <h2 className="text-lg font-semibold">{t("privacy.section1Title")}</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {t("privacy.section1Content")}
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold">{t("privacy.section2Title")}</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {t("privacy.section2Content")}
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold">{t("privacy.section3Title")}</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {t("privacy.section3Intro")}
            </p>
            <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-muted-foreground">
              <li>{t("privacy.section3Item1")}</li>
              <li>{t("privacy.section3Item2")}</li>
              <li>{t("privacy.section3Item3")}</li>
              <li>{t("privacy.section3Item4")}</li>
              <li>{t("privacy.section3Item5")}</li>
              <li>{t("privacy.section3Item6")}</li>
            </ul>
          </div>

          <div>
            <h2 className="text-lg font-semibold">{t("privacy.section4Title")}</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {t("privacy.section4Intro")}
            </p>
            <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-muted-foreground">
              <li>{t("privacy.section4Item1")}</li>
              <li>{t("privacy.section4Item2")}</li>
              <li>{t("privacy.section4Item3")}</li>
              <li>{t("privacy.section4Item4")}</li>
              <li>{t("privacy.section4Item5")}</li>
              <li>{t("privacy.section4Item6")}</li>
            </ul>
          </div>

          <div>
            <h2 className="text-lg font-semibold">{t("privacy.section5Title")}</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {t("privacy.section5Intro")}
            </p>
            <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-muted-foreground">
              <li>{t("privacy.section5Item1")}</li>
              <li>{t("privacy.section5Item2")}</li>
              <li>{t("privacy.section5Item3")}</li>
              <li>{t("privacy.section5Item4")}</li>
              <li>{t("privacy.section5Item5")}</li>
              <li>{t("privacy.section5Item6")}</li>
              <li>{t("privacy.section5Item7")}</li>
              <li>{t("privacy.section5Item8")}</li>
            </ul>
          </div>

          <div>
            <h2 className="text-lg font-semibold">{t("privacy.section6Title")}</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {t("privacy.section6Content")}
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold">{t("privacy.section7Title")}</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {t("privacy.section7Content")}
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold">{t("privacy.section8Title")}</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {t("privacy.section8Content")}
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold">{t("privacy.section9Title")}</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {t("privacy.section9Content")}
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold">{t("privacy.section10Title")}</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {t("privacy.section10Content")}
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold">{t("privacy.section11Title")}</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {t("privacy.section11Date1")}
              <br />
              {t("privacy.section11Date2")}
              <br />
              {t("privacy.section11Date3")}
              <br />
              {t("privacy.section11Date4")}
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
        <Link href="/terms" className="underline underline-offset-4 hover:text-foreground">
          {t("footer.terms")}
        </Link>
      </footer>
    </div>
  );
}
