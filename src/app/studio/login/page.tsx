// /studio/login

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { STUDIO_HOME } from "@/src/lib/studio/config";
import { getStudioDictionary, translator } from "@/src/lib/studio/i18n";
import { getStudioLocale } from "@/src/lib/studio/locale";
import { getStudioState } from "@/src/lib/studio/session";
import LocaleSwitch from "@/src/components/studio/LocaleSwitch";
import LoginForm from "./LoginForm";

export async function generateMetadata(): Promise<Metadata> {
  const t = translator(await getStudioDictionary(await getStudioLocale()));
  return { title: t("login.submit") };
}

export default async function StudioLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ e?: string }>;
}) {
  // Already signed in and a member: nothing to do here.
  const state = await getStudioState();
  if (state.kind === "ok") redirect(STUDIO_HOME);

  const locale = await getStudioLocale();
  const t = translator(await getStudioDictionary(locale));
  const { e } = await searchParams;

  return (
    <main className="grid min-h-dvh place-items-center bg-background px-4 py-10 text-foreground">
      <div className="w-full max-w-sm">
        <p className="text-sm font-semibold text-muted-foreground">
          saycheeeeeze <span className="text-foreground">{t("brand")}</span>
        </p>
        <h1 className="mt-6 text-2xl font-semibold leading-tight">{t("login.title")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("login.blurb")}</p>

        <div className="mt-8">
          <LoginForm notice={e === "no-access" || state.kind === "no-account" ? "noAccess" : undefined} />
        </div>

        <div className="mt-10 flex items-center justify-between gap-4">
          <Link href="/" className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
            {t("login.back")}
          </Link>
          <LocaleSwitch active={locale} label={t("nav.language")} />
        </div>
      </div>
    </main>
  );
}
