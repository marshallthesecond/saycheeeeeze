"use client";

// The photographer, from the portrait to Book: the About page's main section
// since 2026-11-17 (until then it was the left column of Home, and About had
// a card with a cover photo in its place).
//
// The portrait, the name, the headline (the page's only h1), what he shoots,
// then the vertical "SHAMSHOD" running beside the bio and the details list,
// the links on one line, and Book with Telegram beside it.
//
// The same layout at every size: the portrait on the left, the words on the
// right. Below 768px it is a smaller copy (2026-11-17) that takes at most
// 40% of the screen's height: when a long bio would not fit, the bio is cut
// with a fade, and everything else stays whole. From 768px it is the full
// size, as it sits in About's middle column on a computer.
//
// The portrait is plain: the viewfinder corner marks and focus square that
// once framed it were removed on 2026-11-10 at Marshall's request.

import Link from "next/link";
import { Send } from "lucide-react";
import { useLayoutEffect, useRef } from "react";
import { useT } from "@/src/lib/i18n/LanguageProvider";
import { pfps } from "@/src/lib/pfps";
import { PROFILE } from "@/src/lib/profile";
import { CARD_SHAPE } from "@/src/components/profile/RailCards";
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
  const bio = useRef<HTMLDivElement>(null);

  // Fades the bio's last line only when it is actually cut.
  useLayoutEffect(() => {
    const el = bio.current;
    if (!el) return;
    const check = () => {
      el.dataset.cut = String(el.scrollHeight > el.clientHeight + 1);
    };
    check();
    const watch = new ResizeObserver(check);
    watch.observe(el);
    if (el.firstElementChild) watch.observe(el.firstElementChild);
    return () => watch.disconnect();
  }, []);

  // The third flag hides a row on phones: "Shoots" repeats the tags right
  // under the title, and on a small phone its two lines are the bio's room.
  const details: [string, string, boolean?][] = [
    [t("profile.basedIn"), t("profile.basedInValue")],
    [t("profile.since"), String(PROFILE.sinceYear)],
    [t("profile.shoots"), t("profile.shootsValue"), true],
    [t("profile.archive"), t("profile.archiveValue", { albums: albumsCount, photos: photosCount })],
  ];

  return (
    <section
      aria-label={t("profile.name")}
      className={
        // Phone: two columns, one row that is at most 40% of the screen.
        `grid max-h-[40dvh] grid-cols-[minmax(0,36%)_minmax(0,1fr)] grid-rows-[minmax(0,1fr)] gap-3 ${CARD_SHAPE} bg-card p-3 sm:p-4 ` +
        // 768px and up: as it was.
        "md:max-h-none md:grid-rows-[auto] md:grid-cols-[minmax(0,17rem)_minmax(0,1fr)] md:gap-6 md:p-5 lg:grid-cols-[minmax(0,19rem)_minmax(0,1fr)] xl:grid-cols-[minmax(0,16rem)_minmax(0,1fr)] 2xl:grid-cols-[minmax(0,19rem)_minmax(0,1fr)]"
      }
    >
      <ProfilePhotos
        images={pfps}
        interval={4000}
        alt={t("profile.portraitAlt")}
        progress={false}
        frameClassName="h-full w-full min-h-0 rounded-lg border-0! md:min-h-[360px] md:rounded-xl"
        sizes="(min-width: 1536px) 304px, (min-width: 1280px) 256px, (min-width: 1024px) 304px, (min-width: 768px) 272px, 36vw"
      />

      <div className="flex min-h-0 min-w-0 flex-col gap-1.5 md:gap-3.5">
        <div className="flex shrink-0 flex-col gap-1 md:gap-2">
          <p className="text-[21px] font-extrabold leading-none tracking-[-0.03em] md:text-[34px]">
            {t("profile.name")}
          </p>
          <h1 className="text-xs font-semibold leading-snug md:text-[15px]">{t("about.heroTitle")}</h1>
          <ul className="flex flex-nowrap gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {PROFILE.specialties.map((s) => (
              <li
                key={s}
                className="shrink-0 whitespace-nowrap rounded-full border border-border px-2 py-px text-[10px] text-foreground md:px-2.5 md:py-0.5 md:text-[11px]"
              >
                {t(`profile.tags.${s}`)}
              </li>
            ))}
          </ul>
        </div>

        {/* Bio and details, with the vertical name beside them. The only
            part that gives way when the phone version runs out of height. */}
        <div className="grid min-h-0 grid-cols-[1.125rem_minmax(0,1fr)] grid-rows-[minmax(0,1fr)] gap-2 md:grid-cols-[2.5rem_minmax(0,1fr)] md:grid-rows-[auto] md:gap-2.5">
          <span
            aria-hidden
            className="self-center justify-self-center overflow-hidden whitespace-nowrap text-[17px] font-extrabold uppercase leading-none tracking-[-0.01em] text-foreground md:text-[40px]"
            style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
          >
            {t("profile.name")}
          </span>

          <div className="flex min-h-0 min-w-0 flex-col gap-2 md:gap-3">
            <div
              ref={bio}
              className="min-h-0 overflow-hidden data-[cut=true]:[mask-image:linear-gradient(to_bottom,black_65%,transparent)]"
            >
              <BioTypewriter size="compact" className="max-md:leading-[1.45]! md:text-sm" />
            </div>
            <dl className="grid shrink-0 grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-2 gap-y-0.5 md:gap-x-3 md:gap-y-1">
              {details.map(([k, v, deskOnly]) => (
                <div key={k} className={deskOnly ? "hidden md:contents" : "contents"}>
                  <dt className="text-[10px] text-muted-foreground max-md:leading-tight md:text-xs">{k}</dt>
                  <dd className="text-[11px] text-foreground max-md:leading-tight md:text-[13px]">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>

        <SocialLinks
          links={PROFILE.socials}
          maxPx={12}
          spread={false}
          wrapNarrow
          label={t("profile.links")}
          className="shrink-0"
        />

        <div className="mt-auto flex shrink-0 gap-2">
          <Link
            href={`/${locale}/book`}
            className="btn-glass-primary flex h-9 min-w-0 flex-1 items-center justify-center whitespace-nowrap px-2 text-xs font-semibold md:h-11 md:text-sm"
          >
            {t("about.ctaButton")}
          </Link>
          <a
            href={PROFILE.telegram}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Telegram"
            className="btn-glass flex size-9 shrink-0 items-center justify-center md:h-11 md:w-auto md:px-4 md:text-sm md:font-semibold"
          >
            {/* An icon on a phone, where "Telegram" is also in the links just above. */}
            <Send aria-hidden className="size-4 md:hidden" />
            <span aria-hidden className="hidden md:inline">Telegram</span>
          </a>
        </div>
      </div>
    </section>
  );
}
