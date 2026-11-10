"use client";

// The cards in the right-hand column of Home (and in About's booking card):
// albums, the private-gallery door, and the session types with their prices.

import Link from "next/link";
import Image from "next/image";
import { ChevronRight } from "lucide-react";
import { useT } from "@/src/lib/i18n/LanguageProvider";
import type { AlbumData, AlbumPhoto } from "@/src/lib/albums";
import type { SessionSummary } from "@/src/lib/session-summaries";
import { blurStyle, fallbackSrc, hasLadder, srcSet } from "@/src/lib/ladder";

export const CARD = "rounded-2xl bg-card p-4";
export const CARD_TITLE = "text-lg font-bold tracking-tight";

/** A small square thumbnail from the ladder when there is one. */
function Thumb({
  src,
  ladder,
  thumbhash,
  alt,
  size = 56,
}: {
  src: string;
  ladder?: AlbumPhoto["ladder"];
  thumbhash?: string;
  alt: string;
  size?: number;
}) {
  const sizes = `${size}px`;
  return (
    <span
      className="relative block shrink-0 overflow-hidden rounded-lg bg-foreground/6"
      style={{ width: size, height: size, ...blurStyle(thumbhash) }}
    >
      {hasLadder(ladder) ? (
        <picture>
          <source type="image/avif" sizes={sizes} srcSet={srcSet(ladder, "avif")} />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={fallbackSrc(ladder)}
            srcSet={srcSet(ladder, "webp")}
            sizes={sizes}
            alt={alt}
            loading="lazy"
            decoding="async"
            className="absolute inset-0 h-full w-full object-cover"
          />
        </picture>
      ) : (
        <Image src={src} alt={alt} fill sizes={sizes} unoptimized className="object-cover" />
      )}
    </span>
  );
}

export function GalleriesCard({ albums, limit = 4 }: { albums: AlbumData[]; limit?: number }) {
  const { t, locale } = useT();
  if (albums.length === 0) return null;
  return (
    <section aria-labelledby="rail-galleries" className={`${CARD} flex flex-col gap-3`}>
      <h2 id="rail-galleries" className={CARD_TITLE}>{t("about.galleries")}</h2>
      <ul className="flex flex-col gap-2.5">
        {albums.slice(0, limit).map((a) => (
          <li key={a.slug}>
            <Link
              href={`/${locale}/albums/${a.slug}`}
              className="group flex items-center gap-3 rounded-lg -m-1 p-1 transition hover:bg-foreground/5"
            >
              <Thumb src={a.cover} ladder={a.coverLadder} thumbhash={a.coverThumbhash} alt="" />
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-foreground">{a.title}</span>
                <span className="block text-xs text-muted-foreground">
                  {t("portfolio.photoCount", { n: a.photoCount })}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {albums.length > limit && (
        <Link
          href={`/${locale}/portfolio`}
          className="text-[13px] font-semibold text-accent-warm hover:underline underline-offset-2"
        >
          {t("home.allAlbums", { n: albums.length })} →
        </Link>
      )}
    </section>
  );
}

export function PrivateGalleryCard({ onOpen }: { onOpen: () => void }) {
  const { t } = useT();
  return (
    <section aria-labelledby="rail-private" className={`${CARD} flex flex-col gap-2.5`}>
      <h2 id="rail-private" className={CARD_TITLE}>{t("home.privateTitle")}</h2>
      <p className="text-[13px] leading-snug text-muted-foreground">{t("home.privateBody")}</p>
      <button
        type="button"
        onClick={onOpen}
        className="h-10 rounded-lg border border-input text-[13px] font-semibold text-foreground transition hover:bg-foreground/6 active:scale-[0.99]"
      >
        {t("home.enterPasskey")}
      </button>
    </section>
  );
}

/** The session types as a list. `bare` drops the card, for use inside another. */
export function SessionsList({
  sessions,
  title,
  bare = false,
}: {
  sessions: SessionSummary[];
  title?: string;
  bare?: boolean;
}) {
  const { t, locale } = useT();
  if (sessions.length === 0) return null;
  // The short name ("Graduation") where the dictionary has one; the service
  // page's full title ("Graduation Photography") otherwise.
  const sessionName = (s: SessionSummary) => {
    const key = `profile.sessionNames.${s.slug}`;
    const short = t(key);
    return short === key ? s.title : short;
  };
  const list = (
    <ul className="flex flex-col">
      {sessions.map((s, i) => (
        <li key={s.slug} className={i > 0 ? "border-t border-border" : ""}>
          <Link
            href={`/${locale}/services/${s.slug}`}
            className="group flex items-center gap-3 py-2.5 transition hover:text-accent-warm"
          >
            {s.photo && <Thumb src={s.photo.src} ladder={s.photo.ladder} thumbhash={s.photo.thumbhash} alt="" size={36} />}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">{sessionName(s)}</span>
              {s.fromPrice && (
                <span className="block text-xs text-muted-foreground">{t("home.fromPrice", { price: s.fromPrice })}</span>
              )}
            </span>
            <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground transition group-hover:text-accent-warm" />
          </Link>
        </li>
      ))}
    </ul>
  );
  if (bare) return list;
  return (
    <section aria-labelledby="rail-sessions" className={`${CARD} flex flex-col gap-1`}>
      <h2 id="rail-sessions" className={CARD_TITLE}>{title ?? t("home.sessions")}</h2>
      {list}
    </section>
  );
}
