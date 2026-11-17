"use client";

// The photographer, from the portrait to Book: the About page's main section
// since 2026-11-17 (until then it was the left column of Home, and About had
// a card with a cover photo in its place).
//
// The portrait, the name, the headline (the page's only h1), what he shoots,
// then the vertical "SHAMSHOD" running beside the bio and the details list,
// the links on one line, and Book with Telegram beside it.
//
// On a phone it stacks: the portrait wide and not too tall, then the words.
// From 768px the portrait stands on the left and the words on the right,
// which is how it sits in About's middle column on a computer.
//
// The portrait is plain: the viewfinder corner marks and focus square that
// once framed it were removed on 2026-11-10 at Marshall's request.

import Link from "next/link";
import { useT } from "@/src/lib/i18n/LanguageProvider";
import { pfps } from "@/src/lib/pfps";
import { PROFILE } from "@/src/lib/profile";
import ProfilePhotos from "@/src/components/common/ProfilePhotos";
import BioTypewriter from "@/src/components/common/BioTypewriter";
import SocialLinks from "@/src/components/common/SocialLinks";

export default function ProfilePanel({
  albumsCount,
  photosCount,
}: {
  albumsCount: number;
  photosCount: number;
}) {
  const { t, locale } = useT();

  const details: [string, string][] = [
    [t("profile.basedIn"), t("profile.basedInValue")],
    [t("profile.since"), String(PROFILE.sinceYear)],
    [t("profile.shoots"), t("profile.shootsValue")],
    [t("profile.archive"), t("profile.archiveValue", { albums: albumsCount, photos: photosCount })],
  ];

  return (
    <section
      aria-label={t("profile.name")}
      className="grid gap-4 rounded-2xl bg-card p-4 sm:p-5 md:grid-cols-[minmax(0,17rem)_minmax(0,1fr)] md:gap-6 lg:grid-cols-[minmax(0,19rem)_minmax(0,1fr)] xl:grid-cols-[minmax(0,16rem)_minmax(0,1fr)] 2xl:grid-cols-[minmax(0,19rem)_minmax(0,1fr)]"
    >
      <ProfilePhotos
        images={pfps}
        interval={4000}
        alt={t("profile.portraitAlt")}
        progress={false}
        frameClassName="w-full h-[min(82vw,340px)] rounded-xl border-0! md:h-full md:min-h-[360px]"
        sizes="(min-width: 1536px) 304px, (min-width: 1280px) 256px, (min-width: 1024px) 304px, (min-width: 768px) 272px, 100vw"
      />

      <div className="flex min-w-0 flex-col gap-3.5">
        <div className="flex flex-col gap-2">
          <p className="text-[28px] font-extrabold leading-none tracking-[-0.03em] sm:text-[34px]">
            {t("profile.name")}
          </p>
          <h1 className="text-[15px] font-semibold leading-snug">{t("about.heroTitle")}</h1>
          <ul className="flex flex-nowrap gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {PROFILE.specialties.map((s) => (
              <li
                key={s}
                className="shrink-0 whitespace-nowrap rounded-full border border-border px-2.5 py-0.5 text-[11px] text-foreground"
              >
                {t(`profile.tags.${s}`)}
              </li>
            ))}
          </ul>
        </div>

        {/* Bio and details, with the vertical name beside them from 640px. */}
        <div className="grid gap-2.5 sm:grid-cols-[2.5rem_minmax(0,1fr)]">
          <span
            aria-hidden
            className="hidden self-center justify-self-center whitespace-nowrap text-[40px] font-extrabold uppercase leading-none tracking-[-0.01em] text-foreground sm:block"
            style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
          >
            {t("profile.name")}
          </span>

          <div className="flex min-w-0 flex-col gap-3">
            <BioTypewriter size="compact" className="text-[13px] sm:text-sm" />
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1">
              {details.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-xs text-muted-foreground">{k}</dt>
                  <dd className="text-[13px] text-foreground">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>

        <SocialLinks links={PROFILE.socials} maxPx={12} spread={false} label={t("profile.links")} />

        <div className="mt-auto flex gap-2">
          <Link
            href={`/${locale}/book`}
            className="flex h-11 flex-1 items-center justify-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground transition hover:bg-primary-hover active:scale-[0.99]"
          >
            {t("about.ctaButton")}
          </Link>
          <a
            href={PROFILE.telegram}
            target="_blank"
            rel="noopener noreferrer"
            className="flex h-11 items-center justify-center rounded-lg border border-input px-4 text-sm font-semibold text-foreground transition hover:bg-foreground/6"
          >
            Telegram
          </a>
        </div>
      </div>
    </section>
  );
}
