"use client";

// The Home page's profile panel — the "Viewfinder" (Marshall's pick, 2026-11-10).
//
// From 1280px (xl) it is the left column: a 4:5 portrait framed as a camera
// viewfinder, the name, the headline, what he shoots, then the vertical
// "SHAMSHOD" running beside the bio and the details list, the links on one
// line, the next free day and the Book button.
//
// The portrait is 312px tall where the screen allows and gives way first on a
// short laptop screen (down to 200px at 780px tall), so the Book button at the bottom of the
// column is on screen without scrolling the column at 768px and up. The bio is
// the typed variant alone, without the "Welcome to my page" line — the page
// itself is the welcome, and those three lines are what kept Book below the
// fold on a 1440×900 screen.
//
// Below 1280px the same markup reflows into a compact header: a round portrait
// beside the name, the bio and details full width, no vertical name. One set
// of elements on purpose — the page has a single <h1>, and it is in here.

import Link from "next/link";
import { useT } from "@/src/lib/i18n/LanguageProvider";
import { pfps } from "@/src/lib/pfps";
import { PROFILE } from "@/src/lib/profile";
import ProfilePhotos from "@/src/components/common/ProfilePhotos";
import BioTypewriter from "@/src/components/common/BioTypewriter";
import SocialLinks from "@/src/components/common/SocialLinks";
import FreeDays from "./FreeDays";

/** Corner marks and the focus square. Decorative: aria-hidden throughout. */
function Viewfinder() {
  const corner = "absolute size-5.5 border-white/95";
  return (
    <span aria-hidden className="pointer-events-none absolute inset-0 hidden xl:block">
      <span className={`${corner} top-3.5 left-3.5 border-t-2 border-l-2`} />
      <span className={`${corner} top-3.5 right-3.5 border-t-2 border-r-2`} />
      <span className={`${corner} bottom-3.5 left-3.5 border-b-2 border-l-2`} />
      <span className={`${corner} bottom-3.5 right-3.5 border-b-2 border-r-2`} />
      {/* The focus point sits on the upper third, where a face is in a 4:5 portrait. */}
      <span className="absolute left-1/2 top-[30%] size-11 -translate-x-1/2 rounded-[2px] border-[1.5px] border-[#ED6E82]" />
      {/* A soft vignette so the white marks read on a bright frame too. */}
      <span className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_55%,rgba(0,0,0,0.28))]" />
    </span>
  );
}

export default function ProfilePanel({
  freeDays,
  albumsCount,
  photosCount,
}: {
  freeDays: string[];
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
    <div className="flex flex-col gap-3 xl:rounded-2xl xl:bg-card xl:p-4">
      {/* Portrait + name. A row on a phone, stacked in the column. */}
      <div className="flex items-center gap-3.5 xl:flex-col xl:items-stretch xl:gap-3">
        <ProfilePhotos
          images={pfps}
          interval={4000}
          alt={t("profile.portraitAlt")}
          progress={false}
          frameClassName="size-16 rounded-full xl:size-auto xl:w-full xl:h-[clamp(200px,calc(100dvh-580px),312px)] xl:rounded-[10px] xl:border-0"
          sizes="(min-width: 1280px) 268px, 64px"
        >
          <Viewfinder />
        </ProfilePhotos>

        <div className="flex min-w-0 flex-col gap-1.5 xl:gap-2">
          <p className="text-xl font-extrabold leading-none tracking-[-0.03em] xl:text-[32px]">
            {t("profile.name")}
          </p>
          <h1 className="text-sm font-semibold leading-snug xl:text-[15px]">{t("about.heroTitle")}</h1>
          <ul className="flex flex-nowrap gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {PROFILE.specialties.map((s) => (
              <li
                key={s}
                className="shrink-0 whitespace-nowrap rounded-full border border-border px-2 py-0.5 text-[10px] text-foreground"
              >
                {t(`profile.tags.${s}`)}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Bio and details, with the vertical name beside them in the column. */}
      <div className="grid gap-2.5 xl:grid-cols-[2.5rem_minmax(0,1fr)]">
        <span
          aria-hidden
          className="hidden self-center justify-self-center whitespace-nowrap text-[40px] font-extrabold uppercase leading-none tracking-[-0.01em] text-foreground xl:block"
          style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
        >
          {t("profile.name")}
        </span>

        <div className="flex min-w-0 flex-col gap-3">
          <BioTypewriter size="compact" className="max-xl:text-[13px]" />
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-2.5 gap-y-1">
            {details.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-muted-foreground">{k}</dt>
                <dd className="text-xs text-foreground">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>

      <SocialLinks links={PROFILE.socials} maxPx={11} label={t("profile.links")} />

      <div className="flex flex-col gap-2.5 xl:mt-auto">
        <FreeDays days={freeDays} variant="line" />
        <div className="flex gap-2">
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
            className="flex h-11 items-center justify-center rounded-lg border border-input px-4 text-sm font-semibold text-foreground transition hover:bg-foreground/6 xl:hidden"
          >
            Telegram
          </a>
        </div>
      </div>
    </div>
  );
}
