import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Image from 'next/image';
import {
  Check, CalendarDays, Quote,
  Camera, User, Users, Baby, MapPin, Shirt, Globe, Wand2, GraduationCap,
} from 'lucide-react';
import type { LucideProps } from 'lucide-react';
import {
  getServiceBySlug,
  getAllServiceSlugs,
  pickLocale,
  pickLocaleOpt,
} from '@/src/lib/services';
import type {
  Localized,
  ResolvedAudience,
  ResolvedFAQ,
  ResolvedPackageGroup,
  ServiceData,
} from '@/src/lib/services';
import {
  formatDelivery,
  formatPhotoCount,
  packageDuration,
} from '@/src/lib/service-format';
import { getDictionary } from '@/src/lib/i18n/dictionaries';
import { isLocale, defaultLocale } from '@/src/lib/i18n/config';
import { getPhotosByPaths, getPortfolioPhotos } from '@/src/lib/albums';
import type { AlbumPhoto, PortfolioPhoto } from '@/src/lib/albums';
import { bunnyUrl } from '@/src/lib/bunny-url';
import { blurStyle, downloadSrc, fallbackSrc, hasLadder, srcSet } from '@/src/lib/ladder';
import FAQList from './FAQList';
import ServiceEventBlock from './ServiceEventBlock';
import ServicePackages from './ServicePackages';
import ServiceNotice from './ServiceNotice';
import ServiceHero from './ServiceHero';
import {
  AudienceProvider,
  AudienceText,
  AudienceToggle,
} from './ServiceAudience';
import StickyHeader from '@/src/components/common/StickyHeader';

/** The horizontal examples rail under the packages. */
const RAIL_SIZES = '(max-width: 768px) 45vw, 224px';

const iconMap: Record<string, React.ComponentType<LucideProps>> = {
  Camera, User, Users, Baby, MapPin, Shirt, Globe, Wand2, CalendarDays, GraduationCap,
};

export function generateStaticParams() {
  return getAllServiceSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; locale: string }>;
}): Promise<Metadata> {
  const { slug, locale } = await params;
  const service = getServiceBySlug(slug);
  if (!service) return { title: 'Service not found' };

  // Metadata is part of the page. A Russian search result with an English
  // title is the same bug as an English heading, except it happens before
  // anyone has arrived.
  const title = pickLocale(service.title, locale);
  const tagline = pickLocale(service.tagline, locale);
  const description = pickLocale(service.description, locale);

  // Social scrapers don't read srcset, so this has to be one plain URL, and
  // not the Optimizer's. The delivery JPEG over a WebP rung: a real JPEG that
  // every scraper accepts, at a fraction of the original.
  const cover = (await getPhotosByPaths([service.coverPath]))[service.coverPath];
  const ogImage = cover && hasLadder(cover.ladder)
    ? downloadSrc(cover.ladder)
    : bunnyUrl(service.coverPath);

  return {
    title,
    description,
    // What a student actually types. The root layout carries the site-wide
    // terms; these are this service's, in all three languages — the student
    // searches in English, their parent in Russian, plenty of both in Uzbek.
    ...(service.keywords?.length ? { keywords: service.keywords } : {}),
    openGraph: {
      title: `${title} · saycheeeeeze`,
      description: tagline,
      type: 'article',
      images: [{ url: ogImage, alt: title }],
    },
    twitter: {
      card: 'summary_large_image',
      title: `${title} · saycheeeeeze`,
      description: tagline,
      images: [ogImage],
    },
  };
}

const RAIL_COUNT = 8;

/**
 * The photographs shown under "Best picks", in order of preference:
 *
 *   1. galleryPaths     — curated frame by frame, order preserved
 *   2. galleryCategory  — everything from one Bunny folder
 *   3. an even spread of the portfolio
 *
 * Examples either argue for the service they sit under or against it; there is
 * no neutral, which is why an even spread of the whole portfolio is the last
 * resort rather than the default — it once put an espresso machine on the
 * graduation page.
 *
 * Hidden photos are skipped. `hidden` means a category excluded from the
 * portfolio in portfolio-exclude.json, and showing them here would override
 * that decision.
 *
 * The fallback is a placeholder, not a destination: a service still on it is a
 * service whose page has nothing of its own to show, which is worth noticing.
 */
async function pickExamples(
  service: ServiceData,
  pool: PortfolioPhoto[],
  cover?: AlbumPhoto,
): Promise<AlbumPhoto[]> {
  if (service.galleryPaths?.length) {
    const byPath = await getPhotosByPaths(service.galleryPaths);
    // Keep the author's order, and drop any path that no longer resolves rather
    // than rendering a hole.
    const picked = service.galleryPaths
      .map((path) => byPath[path])
      .filter(Boolean);
    if (picked.length > 0) return picked.slice(0, RAIL_COUNT);
  }

  const visible = pool.filter((p) => !p.hidden);

  if (service.galleryCategory) {
    const scoped = visible.filter((p) => p.category === service.galleryCategory);
    if (scoped.length > 0) return spread(scoped, RAIL_COUNT);
  }

  if (visible.length > 0) return spread(visible, RAIL_COUNT);
  return cover ? [cover] : [];
}

/** Up to `count` items, evenly spaced, so a long list is sampled not truncated. */
function spread<T>(items: T[], count: number): T[] {
  if (items.length <= count) return items;
  const step = items.length / count;
  return Array.from({ length: count }, (_, i) => items[Math.floor(i * step)]);
}

export default async function ServicePage({
  params,
}: {
  params: Promise<{ slug: string; locale: string }>;
}) {
  const { slug, locale } = await params;
  const service = getServiceBySlug(slug);
  if (!service) notFound();

  const dict = await getDictionary(isLocale(locale) ? locale : defaultLocale);
  const s = dict.service;

  const Icon = iconMap[service.iconName] ?? Camera;

  // Whole photo records, not URL strings — as bunnyUrl() results this rail
  // was the last place still asking the Optimizer to resize eight full-size
  // originals per page. Services without matching albums fall back to the
  // service cover so the rail is never empty.
  const albumPool = await getPortfolioPhotos();

  // A storage path, so the hero goes through the same ladder as everything
  // else rather than being a 39 MB file in public/ resized on every cold
  // request.
  const cover = (await getPhotosByPaths([service.coverPath]))[service.coverPath];
  const galleryPicks = await pickExamples(service, albumPool, cover);

  // packageGroups wins where both exist; a flat list is wrapped in one unnamed
  // group so the render path below is the same either way.
  const L = (value: Localized) => pickLocale(value, locale);

  // Every string the visitor reads, resolved once, here on the server where
  // `locale` already is. The client islands receive plain strings and never
  // learn about locales, which also keeps the dictionaries out of their
  // bundle. Miss one and /ru becomes a translated shell around an English
  // page — English FAQs, "1 hour" in the middle of a Russian price list.
  const title = L(service.title);
  const tagline = L(service.tagline);
  const description = L(service.description);
  const includes = service.includes.map(L);
  const howToPrepare = service.howToPrepare.map(L);
  const faqs: ResolvedFAQ[] = service.faqs.map((f) => ({
    question: L(f.question),
    answer: L(f.answer),
  }));
  const notice = service.notice
    ? { title: L(service.notice.title), body: L(service.notice.body) }
    : undefined;
  const proof = service.proof?.map((q) => ({
    // A name is not translated. It is their name.
    name: q.name,
    detail: pickLocaleOpt(q.detail, locale),
    quote: L(q.quote),
  }));
  // "moments" was printed raw in the photo hero's eyebrow — an English word in
  // every language, next to a heading the dictionary had already translated.
  const categoryLabel = dict.cat[service.category];
  const heroEyebrow = pickLocaleOpt(service.hero?.eyebrow, locale) ?? categoryLabel;

  const packageGroups: ResolvedPackageGroup[] = (
    service.packageGroups && service.packageGroups.length > 0
      ? service.packageGroups
      // `packages` is optional now — a service with packageGroups has none —
        // so this fallback has to tolerate its absence rather than assume it.
      : [{ key: 'default', title: '', blurb: '', packages: service.packages ?? [] }]
  ).map((g) => ({
    key: g.key,
    title: L(g.title),
    blurb: L(g.blurb),
    // The length, the frame count and the turnaround are rendered from their
    // numbers rather than read from hand-written English — see service-format.
    packages: g.packages.map((pkg) => ({
      ...pkg,
      duration: packageDuration(pkg, locale),
      photos: formatPhotoCount(pkg.photos, locale),
      delivery: formatDelivery(pkg.delivery, locale),
      perks: pkg.perks?.map((perk) => L(perk)),
      note: pickLocaleOpt(pkg.note, locale),
    })),
  }));

  // An explicit loop rather than Object.entries().map(): entries types its
  // values as `unknown` here, and the annotation that fixes that conflicts
  // with its own signature.
  let audience: ResolvedAudience | undefined;
  if (service.audience) {
    const rawGroups = service.audience.groups;
    let groups: Record<string, { title?: string; blurb?: string }> | undefined;
    if (rawGroups) {
      groups = {};
      for (const key of Object.keys(rawGroups)) {
        const v = rawGroups[key];
        groups[key] = {
          title: pickLocaleOpt(v.title, locale),
          blurb: pickLocaleOpt(v.blurb, locale),
        };
      }
    }
    audience = {
      prompt: pickLocale(service.audience.prompt, locale),
      hint: pickLocaleOpt(service.audience.hint, locale),
      eyebrow: pickLocaleOpt(service.audience.eyebrow, locale),
      description: pickLocaleOpt(service.audience.description, locale),
      groups,
    };
  }

  // The FAQs are already written and on the page; the schema is the free
  // half. Without it, a page that answers "how much is a graduation photoshoot
  // in Tashkent" exactly is invisible to the result that asks it.
  const faqSchema = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((f) => ({
      '@type': 'Question',
      name: f.question,
      acceptedAnswer: { '@type': 'Answer', text: f.answer },
    })),
  };

  return (
    // Everything inside stays a server component: a client provider can take
    // server-rendered children as a prop. Only <AudienceText> and the islands
    // reading the context are client-side.
    <AudienceProvider>
    <div className="min-h-screen bg-background text-white relative overflow-x-clip">
      {/* eslint-disable-next-line react/no-danger */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
      />

      {service.hero ? (
        // No photograph — see ServiceHero for why, and for when to drop it.
        <ServiceHero
          title={title}
          tagline={tagline}
          Icon={Icon}
          eyebrow={
            <AudienceText base={heroEyebrow} alt={audience?.eyebrow} />
          }
          accent={service.accentColor}
        />
      ) : (
        // Full-bleed cover photo melting into the page via the service's own
        // accent: no rounded card, no seam, the image is the header. A JS
        // comment rather than a JSX one because a ternary branch holds one
        // expression and {/* … */} is itself an expression.
        <div
        // A hero has to say what this is and then get out of the way. At 44vh
        // it fills the top of the screen while leaving the first section
        // visible above the fold, which is what makes someone scroll; 62vh was
        // over half a phone screen before a single word appeared. Desktop
        // keeps more height because there's more of it to spend.
        className="relative w-full h-[44vh] min-h-70 max-h-95 sm:h-[52vh] sm:max-h-130"
        style={blurStyle(cover?.thumbhash)}
      >
        {cover && hasLadder(cover.ladder) ? (
          <picture>
            <source type="image/avif" sizes="100vw" srcSet={srcSet(cover.ladder, 'avif')} />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={fallbackSrc(cover.ladder)}
              srcSet={srcSet(cover.ladder, 'webp')}
              sizes="100vw"
              alt={title}
              fetchPriority="high"
              decoding="async"
              className="absolute inset-0 h-full w-full object-cover"
            />
          </picture>
        ) : (
          <Image
            src={bunnyUrl(service.coverPath)}
            alt={title}
            fill
            sizes="100vw"
            unoptimized
            className="object-cover"
            priority
          />
        )}
        {/* Accent wash + fade to page background */}
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background: `linear-gradient(to bottom,
              rgba(0,0,0,0.35) 0%,
              ${service.accentColor}22 45%,
              ${service.accentColor}88 78%,
              rgba(0,0,0,1) 100%)`,
          }}
        />

        {/* Title block sits at the bottom of the hero, Spotify-style */}
        {/* The icon tile moved ONTO the eyebrow line rather than sitting on
            its own row above it. Stacked, the tile, the category, the title and
            the tagline were four separate blocks of vertical rhythm inside a
            hero that is now shorter — the tile and the category are one thought
            ("moments · graduation"), so they read as one line. */}
        <div className="absolute inset-x-0 bottom-0 px-4 sm:px-8 pb-5 sm:pb-6">
          <div className="mb-2.5 flex items-center gap-2">
            <span
              className="flex h-7 w-7 items-center justify-center rounded-lg shadow-lg"
              style={{ background: service.accentColor }}
            >
              <Icon className="h-3.5 w-3.5 text-white" />
            </span>
            <span className="text-[11px] font-bold uppercase tracking-widest text-white/70">
              {categoryLabel}
            </span>
          </div>
          <h1 className="text-[30px] sm:text-6xl font-extrabold tracking-tighter leading-[0.95] max-w-3xl">
            {title}
          </h1>
          <p className="text-sm sm:text-base text-white/75 mt-2.5 max-w-xl">{tagline}</p>
        </div>
      </div>
      )}

      <StickyHeader title={title} accent={service.accentColor} fadeOver={320} backHref={`/${locale}`} />

      <main className="relative z-10 px-4 sm:px-8 pt-8 pb-32">

        <div className="mb-12 sm:mb-14 max-w-2xl space-y-5">
          <p className="text-sm text-white/70 leading-relaxed">
            <AudienceText base={description} alt={audience?.description} />
          </p>

          {/* Directly under the description, before the offers: it changes how
              everything below reads, so it has to be answered before that,
              and it is the first question a WIUT student would want asked. */}
          {audience && (
            <AudienceToggle
              prompt={audience.prompt}
              hint={audience.hint}
              accent={service.accentColor}
            />
          )}

          {service.event && (
            <ServiceEventBlock
              date={service.event.date || undefined}
              label={L(service.event.label)}
              venue={pickLocaleOpt(service.event.venue, locale)}
              note={pickLocaleOpt(service.event.note, locale)}
              capacity={service.event.capacity}
              booked={service.event.booked}
              accent={service.accentColor}
              labels={{
                daysToGo: s.eventDaysToGo,
                today: s.eventToday,
                passed: s.eventPassed,
                dateTba: s.eventDateTba,
                spotsLeft: s.eventSpotsLeft,
                fullyBooked: s.eventFullyBooked,
              }}
            />
          )}
        </div>

        {/* minmax(0,1fr), not 1fr: a grid track's automatic minimum is the
            min-content width of what's inside it, so one wide child (the photo
            rail) makes the first column refuse to shrink, pushes the 380px
            packages column past the right edge, and the page's overflow clip
            hides it entirely. minmax(0,…) plus min-w-0 lets the column shrink
            and keeps the sidebar on screen. */}
        <div className="flex flex-col lg:grid lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-10 lg:items-start">

          {/* 40px between sections read as one continuous wall of text on a
              phone. At 64 the headings do the work headings are for — you can
              see where one idea stops and the next starts while scrolling past
              at speed. */}
          <div className="space-y-16 sm:space-y-20 min-w-0 order-2 lg:order-1">

            <section>
              <h2 className="text-2xl font-extrabold tracking-tight mb-4">{s.included}</h2>
              <ul className="space-y-3">
                {includes.map((item, i) => (
                  <li key={i} className="flex items-start gap-3 text-sm text-white/80">
                    <span
                      className="mt-0.5 w-5 h-5 rounded-full flex items-center justify-center shrink-0"
                      style={{ background: `${service.accentColor}33` }}
                    >
                      <Check className="w-3 h-3" style={{ color: service.accentColor }} />
                    </span>
                    {item}
                  </li>
                ))}
              </ul>
            </section>

            <section>
              <h2 className="text-2xl font-extrabold tracking-tight mb-4">{s.prepare}</h2>
              <ul className="space-y-2">
                {howToPrepare.map((tip, i) => (
                  <li key={i} className="flex items-start gap-3 text-sm text-white/70">
                    <span
                      className="shrink-0 font-bold text-xs mt-0.5"
                      style={{ color: service.accentColor }}
                    >
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    {tip}
                  </li>
                ))}
              </ul>
            </section>

            <section>
              <div className="flex items-end justify-between mb-5">
                <div>
                  <h2 className="text-2xl font-extrabold tracking-tight">{s.bestPicks}</h2>
                  <p className="text-sm text-white/40 mt-1">
                    {s.bestPicksSub}
                  </p>
                </div>
              </div>

              <div className="-mx-4 sm:-mx-8 overflow-x-auto [&::-webkit-scrollbar]:hidden">
                <div className="flex gap-3 px-4 sm:px-8 pb-2 snap-x snap-mandatory scroll-px-4 sm:scroll-px-8">
                  {galleryPicks.map((pick, i) => (
                    <div
                      key={i}
                      className="relative overflow-hidden rounded-xl shrink-0 snap-start group
                                w-44 h-60
                                md:w-52 md:h-72
                                lg:w-56 lg:h-80"
                    >
                      {hasLadder(pick.ladder) ? (
                        <picture>
                          <source type="image/avif" sizes={RAIL_SIZES} srcSet={srcSet(pick.ladder, 'avif')} />
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={fallbackSrc(pick.ladder)}
                            srcSet={srcSet(pick.ladder, 'webp')}
                            sizes={RAIL_SIZES}
                            alt={`${title} example ${i + 1}`}
                            loading="lazy"
                            decoding="async"
                            className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-105"
                          />
                        </picture>
                      ) : (
                        <Image
                          src={pick.src}
                          alt={`${title} example ${i + 1}`}
                          fill
                          sizes={RAIL_SIZES}
                          unoptimized
                          className="object-cover transition duration-500 group-hover:scale-105"
                        />
                      )}

                      <div className="absolute inset-0 bg-linear-to-t from-black/45 via-transparent to-transparent opacity-70" />

                      <div
                        className="absolute top-4 left-4 w-10 h-1 rounded-full"
                        style={{ background: service.accentColor }}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </section>

            {/* Absent, not empty. A "what clients say" heading over nothing
                is worse than no heading, and placeholder praise in a cohort
                where everyone knows everyone is worse than both. */}
            {proof && proof.length > 0 && (
              <section>
                <h2 className="text-2xl font-extrabold tracking-tight mb-4">{s.proofHeading}</h2>
                <div className="grid gap-3 sm:grid-cols-2">
                  {proof.map((quote, i) => (
                    <figure key={i} className="rounded-2xl border border-white/10 bg-white/3 p-5">
                      <Quote className="h-4 w-4" style={{ color: service.accentColor }} />
                      <blockquote className="mt-3 text-sm leading-relaxed text-white/80">
                        {quote.quote}
                      </blockquote>
                      <figcaption className="mt-3 text-xs text-white/45">
                        {quote.name}
                        {quote.detail ? ` · ${quote.detail}` : ''}
                      </figcaption>
                    </figure>
                  ))}
                </div>
              </section>
            )}

            <section>
              <h2 className="text-2xl font-extrabold tracking-tight mb-2">{s.faq}</h2>
              <FAQList faqs={faqs} accent={service.accentColor} />
            </section>
          </div>

          <div className="min-w-0 order-1 lg:order-2 mb-16 sm:mb-20 lg:mb-0 lg:mt-0">
            <div className="lg:sticky lg:top-6 space-y-4">
              {/* The notice lives HERE, not inline under the description. It
                  explains why the prices look the way they do, so it belongs
                  beside the prices — where the question occurs to someone —
                  rather than as a caveat read before they have decided they
                  want the thing at all. */}
              <div className="mb-4 -mr-2 flex items-center justify-between gap-2">
                <h2 className="text-2xl font-extrabold tracking-tight">{s.packages}</h2>
                {notice && (
                  <ServiceNotice
                    title={notice.title}
                    body={notice.body}
                    accent={service.accentColor}
                    triggerLabel={notice.title}
                    closeLabel={s.close}
                  />
                )}
              </div>

              {/* Two products under one name — a gown session you schedule, and
                  coverage on the ceremony day. Kept on ONE page rather than two
                  URLs because a student deciding "do I want graduation photos"
                  does not yet know which they want; making them choose a door
                  before they can compare is the wrong question first.

                  The toggle and the compact rows live in ServicePackages —
                  five tall cards with their own buttons ran to nearly three
                  phone screens, which is not a price list anyone can compare. */}
              <ServicePackages
                groups={packageGroups}
                audienceGroups={audience?.groups}
                accentColor={service.accentColor}
                slug={service.slug}
                category={service.category}
                locale={locale}
                labels={{
                  mostPopular: s.mostPopular,
                  perPersonShort: s.perPersonShort,
                  bookShort: s.bookShort,
                  telegramShort: s.telegramShort,
                }}
              />

              <p className="text-center text-xs text-white/40">
                {s.questions}
              </p>
            </div>
          </div>
        </div>

      </main>
    </div>
    </AudienceProvider>
  );
}