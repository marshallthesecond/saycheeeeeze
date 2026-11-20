"use client";

// The Portraits session, sold the way a photographer's site sells it
// (2026-11-17): a promise in one line, what happens at the shoot, what you
// get, the three ways to book it with their prices, and one obvious button.
//
// Everything factual comes from services.ts through the server page (what is
// included, the tiers, the prices), so this cannot drift from the Portraits
// page. Only the headline and the paragraph are written for Home, in the
// dictionaries under home.pitch*.
//
// A phone gets it in reading order: photos, promise, what is included, the
// tiers, the button. When the section is 768px wide or more (a container
// query, so the same holds in Home's middle column) the photographs sit on
// the left and the words on the right.

import Link from "next/link";
import { Check } from "lucide-react";
import PhotoFrame from "@/src/components/common/PhotoFrame";
import { useT } from "@/src/lib/i18n/LanguageProvider";
import { PROFILE } from "@/src/lib/profile";
import type { AlbumPhoto } from "@/src/lib/albums";

export interface PitchTier {
  /** Bookable at this price when set. */
  id?: string;
  /** The Studio's name for it; the title when present, with the length under it. */
  name?: string;
  duration: string;
  photos: string;
  delivery: string;
  price: string;
  highlight: boolean;
}

export interface PortraitsPitchData {
  slug: string;
  title: string;
  includes: string[];
  tiers: PitchTier[];
  /** The cheapest tier's price, formatted. */
  from: string;
  photos: AlbumPhoto[];
}

export default function PortraitsPitch({ pitch }: { pitch: PortraitsPitchData }) {
  const { t, locale } = useT();
  const book = (id?: string) =>
    `/${locale}/book?service=${encodeURIComponent(pitch.slug)}` + (id ? `&package=${encodeURIComponent(id)}` : "");
  const [first, ...others] = pitch.photos;

  return (
    <section
      aria-labelledby="pitch-h"
      className="@container overflow-hidden rounded-2xl bg-card ring-1 ring-border"
    >
      <div className="@3xl:grid @3xl:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      {/* The work first: one large frame and two beside it. */}
      {first && (
        <div className="grid grid-cols-[2fr_1fr] gap-0.5 @3xl:min-h-[440px]">
          <PhotoFrame
            ladder={first.ladder}
            src={first.src}
            thumbhash={first.thumbhash}
            alt={t("home.pitchPhotoAlt", { n: 1 })}
            sizes="(min-width: 1280px) 30vw, 66vw"
            className="aspect-[4/5] @3xl:aspect-auto @3xl:h-full"
          />
          <div className="grid grid-rows-2 gap-0.5">
            {others.map((p, i) => (
              <PhotoFrame
                key={i}
                ladder={p.ladder}
                src={p.src}
                thumbhash={p.thumbhash}
                alt={t("home.pitchPhotoAlt", { n: i + 2 })}
                sizes="(min-width: 1280px) 15vw, 33vw"
                className="h-full min-h-0"
              />
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-4 p-5 @lg:p-7 @3xl:p-8">
        <div className="flex flex-col gap-2">
          <p className="text-[13px] font-semibold text-accent-warm">{pitch.title}</p>
          <h2 id="pitch-h" className="text-[26px] font-extrabold leading-[1.1] tracking-[-0.02em] @lg:text-[32px]">
            {t("home.pitchTitle")}
          </h2>
          <p className="max-w-prose text-sm leading-relaxed text-muted-foreground @lg:text-[15px]">
            {t("home.pitchBody")}
          </p>
        </div>

        <ul className="grid gap-2 @xl:grid-cols-2">
          {pitch.includes.map((line) => (
            <li key={line} className="flex items-start gap-2 text-[13px] leading-snug text-foreground">
              <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-accent-warm" strokeWidth={2.25} />
              <span>{line}</span>
            </li>
          ))}
        </ul>

        {pitch.tiers.length > 0 && (
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-bold">{t("home.pitchTiers")}</h3>
            <ul className="flex flex-col gap-2">
              {pitch.tiers.map((tier) => (
                <li key={tier.id ?? tier.duration}>
                  <Link
                    href={book(tier.id)}
                    className={`flex items-center gap-3 rounded-xl px-3.5 py-2.5 transition active:scale-[0.99] ${
                      tier.highlight
                        ? "bg-primary/8 ring-2 ring-primary hover:bg-primary/12"
                        : "ring-1 ring-border hover:bg-foreground/5"
                    }`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="text-sm font-bold text-foreground">{tier.name ?? tier.duration}</span>
                        {tier.highlight && (
                          <span className="whitespace-nowrap rounded-full bg-primary px-2 py-0.5 text-[10.5px] font-semibold text-primary-foreground">
                            {t("service.mostPopular")}
                          </span>
                        )}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {tier.name ? `${tier.duration}, ` : ""}
                        {tier.photos}, {tier.delivery.charAt(0).toLowerCase() + tier.delivery.slice(1)}
                      </span>
                    </span>
                    <span className="shrink-0 whitespace-nowrap text-sm font-bold tabular-nums text-foreground">
                      {tier.price}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex flex-col gap-2 @lg:flex-row">
          <Link
            href={book()}
            className="btn-glass-primary flex h-11 items-center justify-center px-5 sm:flex-1 text-sm font-semibold"
          >
            {t("home.pitchBook")}
          </Link>
          <Link
            href={`/${locale}/services/${pitch.slug}`}
            className="btn-glass flex h-11 items-center justify-center px-5 text-sm font-semibold text-foreground"
          >
            {t("home.pitchDetails")}
          </Link>
        </div>

        <p className="text-xs leading-relaxed text-muted-foreground">
          {t("home.pitchUnsure")}{" "}
          <a
            href={PROFILE.telegram}
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-accent-warm underline underline-offset-2"
          >
            {t("home.pitchAsk")}
          </a>
        </p>
      </div>
      </div>
    </section>
  );
}
