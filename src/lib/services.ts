/**
 * A string written once, or once per language. A bare string means "the same
 * everywhere", so fields convert one at a time. `en` is required because it is
 * the fallback — a missing translation renders English, never nothing.
 */
export type Localized = string | ({ en: string } & Partial<Record<'ru' | 'uz', string>>);

/**
 * Two plain functions rather than one with overloads. The overloaded version
 * type-checks and then fails to BUILD — Turbopack cannot see an export whose
 * only body sits below two type-only signatures. Do not "tidy" these into one.
 */
/** Every package a service sells, grouped or flat, in display order. */
export function allPackages(service: ServiceData): ServicePackage[] {
  if (service.packageGroups?.length) return service.packageGroups.flatMap((g) => g.packages);
  return service.packages ?? [];
}

/** The one to quote a "from" price against — the cheapest thing on offer. */
export function entryPackage(service: ServiceData): ServicePackage | undefined {
  const all = allPackages(service);
  if (all.length === 0) return undefined;
  return all.reduce((cheapest, p) => (p.priceUzs < cheapest.priceUzs ? p : cheapest));
}

/**
 * Finds one bookable package by its id, across every service.
 *
 * This is what makes a package on a service page the same object the booking
 * form and the API route resolve — the fix for the two systems that used to
 * quote different prices for the same click.
 */
export function findServicePackage(
  id: string,
): { service: ServiceData; pkg: ServicePackage } | undefined {
  for (const service of servicesData) {
    const pkg = allPackages(service).find((p) => p.id === id);
    if (pkg) return { service, pkg };
  }
  return undefined;
}

export function pickLocale(value: Localized, locale: string): string {
  if (typeof value === 'string') return value;
  const key = locale as 'ru' | 'uz';
  return value[key] ?? value.en;
}

/** The same, for fields that may be absent. */
export function pickLocaleOpt(
  value: Localized | undefined,
  locale: string,
): string | undefined {
  return value === undefined ? undefined : pickLocale(value, locale);
}

/**
 * How many finished frames. Numbers rather than a sentence, so it renders in
 * whichever language is being read. `max` omitted means "and up".
 */
export interface PhotoCount {
  min: number;
  max?: number;
  /** Portrait services count portraits, not photos. Defaults to photos. */
  of?: 'photos' | 'portraits';
}

/** When the set arrives, for the same reason PhotoCount exists. */
export interface DeliverySpec {
  /** Working days until the full set. */
  days: number;
  /** A few finished frames the same evening, ahead of the full set. */
  sameDayPreview?: boolean;
}

export interface ServicePackage {
  /**
   * Stable id, and the id the booking form and the server use for this exact
   * package. Optional: a package without one is marketing only, and its service
   * falls back to the four generic session packages in packages.ts.
   *
   * NEVER reuse or renumber one. It is written into `bookings` rows, so a
   * recycled id silently relabels somebody's past booking.
   */
  id?: string;
  /**
   * Overrides the rendered length, for the packages where the WORD is the
   * point: "Full day" says something "10 hours" does not.
   *
   * Normally absent. The old field was a hand-written English copy of
   * durationMinutes that appeared beside it on every package — free to drift,
   * impossible to translate, and the reason a Russian reader saw "1 hour" in
   * the middle of a Russian price list. formatDuration() renders it now.
   */
  duration?: Localized;
  /**
   * The same length as a number, for the calendar.
   *
   * The booking form has to know how long a session blocks out to work out the
   * last legal start time of the day. Deriving it by parsing "2.5 hours" would
   * put a regex between a client and a valid time slot; this is the length,
   * stated once.
   */
  durationMinutes: number;
  photos: PhotoCount;
  delivery: DeliverySpec;
  /**
   * Price in so'm, as a number. formatSom() handles display and the currency
   * word per locale, and the server can verify a booking against it — none of
   * which a display string could do.
   */
  priceUzs: number;
  highlight?: boolean;
  /**
   * Extra lines shown when the package is opened.
   *
   * Anything the duration and photo count do not already say — printed photos,
   * a second location, a same-evening preview. These are what a package is
   * tiered ON: things a client can perceive and choose between, as opposed to
   * which camera body was used, which they cannot.
   */
  perks?: Localized[];
  /** A short qualifier after the duration — "group session", "up to 5". */
  note?: Localized;
  /**
   * Ask how many people are coming, and record it.
   *
   * NOT a pricing input — the group session is one price whatever the head
   * count, which is the whole reason it stopped dividing by four. This is so a
   * shoot for six is not planned as a shoot for two.
   */
  asksPeople?: { min: number; max: number };
  /**
   * A fixed head count this package is priced for, when it genuinely has one.
   *
   * Graduation does NOT use it: a group turns up as two, three or five, and
   * dividing by a hardcoded four printed a per-person figure that would be
   * wrong for most of them. Left in the type for a service that really does
   * sell a fixed-size session.
   */
  groupSize?: number;
}

/**
 * For a service selling more than one KIND of thing. Graduation is two
 * products under one name — a session you schedule, and coverage on the day —
 * kept on one page because a visitor does not yet know which they want.
 *
 * Unset and `packages` renders as before.
 */
export interface ServicePackageGroup {
  key: string;
  title: Localized;
  blurb: Localized;
  /**
   * The locations this kind of session actually happens in, in order — the
   * first is preselected.
   *
   * A campus gown session happens on campus, optionally with a studio. Offering
   * the ceremony venue there was the form asking a question the client's own
   * choice had already answered, and answering it wrongly. The full list is
   * still one tap away behind "somewhere else".
   */
  locationIds?: string[];
  packages: ServicePackage[];
}

/** The same, after pickLocale() has run — what the client components receive. */
export interface ResolvedPackage
  extends Omit<ServicePackage, 'perks' | 'note' | 'duration' | 'photos' | 'delivery'> {
  /** Rendered from durationMinutes (or the override) in the page's locale. */
  duration: string;
  photos: string;
  delivery: string;
  perks?: string[];
  note?: string;
}

export interface ResolvedPackageGroup {
  key: string;
  title: string;
  blurb: string;
  locationIds?: string[];
  packages: ResolvedPackage[];
}

/** A dated event the client is buying FOR. Drives the countdown and the copy. */
export interface ServiceEvent {
  /** ISO date, "2026-11-21". Edit this once a year; nothing else changes. */
  date: string;
  label: Localized;
  venue?: Localized;
  /** Anything a client would be glad you knew — slot times, registration cut-offs. */
  note?: Localized;
  /**
   * Sessions you will take around the date, and how many are gone.
   *
   * Real numbers only. Scarcity is the strongest lever on a page like this
   * precisely because it is true here — one ceremony, one day, one of you. The
   * moment it is decoration it stops working, and in a cohort where everyone
   * knows everyone it gets found out.
   */
  capacity?: number;
  booked?: number;
}

/**
 * Copy for one audience, behind a toggle. Same offers, same prices, same order
 * — only the wording changes ("At campus" → "At WIUT"). Anything omitted keeps
 * the default, so a variant can be one group title.
 */
export interface ServiceAudience {
  /** The switch's label — a question, because the visitor answers it. */
  prompt: Localized;
  /**
   * Bunny STORAGE PATH for the photograph behind the switch — the place this
   * audience recognises on sight. There is no explanatory line under the label
   * any more: a band that visibly lights up when you tap it is the receipt, and
   * a sentence telling you what just happened to a page you are looking at was
   * reading homework for a control that had already answered itself.
   *
   * Resolved through the derivative ladder like every other photograph and
   * CAPPED at the grid rungs — see AUDIENCE_BACKDROP_MAX in the page. A path
   * with no ladder row renders no image at all rather than falling back to the
   * original, which for these files is a multi-megabyte PNG sitting behind one
   * line of text.
   */
  backdropPath?: string;
  eyebrow?: Localized;
  description?: Localized;
  /** Keyed by ServicePackageGroup.key. */
  groups?: Record<string, { title?: Localized; blurb?: Localized }>;
}

/** The same, after pickLocale() has run. */
export interface ResolvedAudience {
  prompt: string;
  eyebrow?: string;
  description?: string;
  groups?: Record<string, { title?: string; blurb?: string }>;
}

/** A short highlighted block: honest positioning, or a seasonal notice. */
export interface ServiceNotice {
  title: Localized;
  body: Localized;
}

export interface ServiceProofQuote {
  /** A person's name is not translated. It is their name. */
  name: string;
  /** "BSc Business Management, 2025" — placing the person makes the quote real. */
  detail?: Localized;
  quote: Localized;
}

export interface ServiceFAQ {
  question: Localized;
  answer: Localized;
}

/** A ServiceFAQ after pickLocale() — FAQList and the JSON-LD both want strings. */
export interface ResolvedFAQ {
  question: string;
  answer: string;
}

export interface ServiceData {
  slug: string;
  category: 'commercial' | 'moments' | 'fashion';
  /**
   * Localized, not plain strings: a translated shell around English content
   * looks like a finished translation and is worse than an English page.
   * Graduation is done; the other fifteen convert one at a time.
   */
  title: Localized;
  tagline: Localized;
  description: Localized;
  iconName: string;
  /**
   * Bunny STORAGE PATH, not a URL and not a local file.
   *
   * These were files in public/ — img1.png through img5.JPG, up to 39.6 MB
   * each, shared between sixteen services and resized by Next on every cold
   * request. As paths they go through the same derivative ladder as every
   * other photograph, and the resolver turns them into URLs at render time.
   */
  coverPath: string;
  /**
   * Where the example rail's photographs come from — "My best picks" at the
   * bottom of the page. Without it every service showed the same eight
   * portfolio images.
   *
   * THREE SOURCES, IN THIS ORDER:
   *
   *   1. `galleryPaths`     curated frame by frame, order preserved. This is
   *                         the one to use. A path with no row is skipped
   *                         rather than rendering a hole, so a typo costs one
   *                         photograph, not the rail.
   *   2. `galleryCategory`  one top-level Bunny folder, sampled evenly. What
   *                         you get by default, and why the rail looks
   *                         arbitrary: nothing chose those frames.
   *   3. neither            an even spread of the whole portfolio. A service
   *                         still on this has nothing of its own to show —
   *                         it once put an espresso machine on the graduation
   *                         page.
   *
   * On a service with `hero.graphic: 'stack'` the FIRST THREE also become the
   * hero's fan, and the rail starts from the fourth. So the order here is the
   * order of importance: best frame first.
   *
   * These are Bunny STORAGE PATHS, the same shape as `coverPath`. To see every
   * path you have:
   *
   *     node --env-file=.env.local scripts/list-photos.mjs
   *     node --env-file=.env.local scripts/list-photos.mjs --folder Portraits
   */
  galleryPaths?: string[];
  galleryCategory?: string;
  /**
   * What that rail is CALLED, per service. Default `'bestPicks'` — "My best
   * picks" / "Лучшие работы" / "Eng yaxshi ishlarim".
   *
   * `'references'` retitles it "References" / "Референсы" / "Referenslar" and
   * changes the line under it, because the two headings promise different
   * things: "my best picks" is the photographer showing off, "references" is an
   * invitation to point at one and say *that one*. Use it where the rail is
   * there to be chosen FROM rather than admired — a page whose visitor is
   * deciding what they want their own photographs to look like.
   *
   * Strings live in the dictionaries under `service.references` /
   * `service.referencesSub`; this only picks which pair is read, so adding a
   * third heading means a third dictionary pair and a third case here.
   */
  galleryHeading?: 'bestPicks' | 'references';
  /**
   * Search terms specific to THIS service, in the languages the search happens
   * in. The root layout already carries the site-wide set; this is the page's
   * own. For graduation that means English, Russian and Uzbek — the student
   * searches in one, the parent paying for it often searches in another.
   */
  keywords?: string[];
  /**
   * Replaces the plain full-bleed cover photo with a composed hero.
   *
   *   'mortarboard'  drawn only. For a service with no representative
   *                  photographs yet — a stand-in frame of something else says
   *                  "photography" and nothing about WHICH kind.
   *   'stack'        a darkened ground photograph with real frames fanned over
   *                  it, drawn from the same pool as the examples rail. Use it
   *                  once the service's folder holds work worth leading with.
   *
   * `coverPath` is still the social preview image under either, and is the
   * default ground for 'stack'.
   */
  hero?: {
    graphic: 'mortarboard' | 'stack';
    /** Overrides the category line. "GRADUATION · TASHKENT" beats "moments". */
    eyebrow?: Localized;
    /**
     * The ground photograph for 'stack'. Bunny STORAGE PATH. Defaults to
     * `coverPath` — override when the frame that works as a 1200×630 social
     * card is not the one that works pushed to near-black behind three others,
     * which is most of the time: the social card wants a subject, this wants a
     * place.
     */
    groundPath?: string;
  };
  includes: Localized[];
  howToPrepare: Localized[];
  /**
   * The flat list, for services that sell one kind of thing.
   *
   * Optional now: a service with `packageGroups` would otherwise have to
   * duplicate its first group here, and a hand-copied duplicate of a price list
   * is a price list that will eventually disagree with itself. Read it through
   * entryPackage() rather than directly.
   */
  packages?: ServicePackage[];
  /** When set, replaces `packages` entirely. See ServicePackageGroup. */
  packageGroups?: ServicePackageGroup[];
  event?: ServiceEvent;
  audience?: ServiceAudience;
  notice?: ServiceNotice;
  proof?: ServiceProofQuote[];
  faqs: ServiceFAQ[];
  accentColor: string;
}

/**
 * The standard ladder. Every service except graduation's ceremony-day pair
 * sells the same three sessions at the same three prices.
 *
 *     1 hour     250 000 so'm    25-40 frames, next day
 *     1.5 hours  400 000 so'm    40-60 frames, two days     <- recommended
 *     2.5 hours  700 000 so'm    80-120 frames, three days
 *
 * ONE FUNCTION, NOT FIFTEEN COPIES. These prices move together by definition,
 * and a price list duplicated fifteen times is a price list that will
 * eventually disagree with itself. Change a number here and every service page
 * changes with it.
 *
 * `id` is what makes a tier bookable AT THIS PRICE. Without one the booking
 * form falls through SERVICE_TO_PACKAGE to the four generic session packages
 * in packages.ts - which is how a page advertising 250 000 hands somebody a
 * form quoting 800 000. Pass `bookable: false` only where that fallthrough is
 * deliberate: a wedding is not a ninety-minute slot you click a button for.
 *
 * Ids are written into `bookings` rows, so never renumber one.
 *
 * To give one service prices of its own, replace the call with a literal
 * array - the field takes either.
 *
 * Exported because booking-catalog.ts builds the generic ladder from it too —
 * the one a visitor sees at /book having arrived from the navigation rather
 * than a service page. Same function, so that ladder cannot drift from the
 * fifteen it mirrors.
 */
export function standardTiers(
  slug: string,
  opts: { bookable?: boolean; of?: PhotoCount['of'] } = {},
): ServicePackage[] {
  const { bookable = true, of } = opts;
  // Spread rather than `id: undefined`: catalogForService() filters on
  // `p.id` being truthy, and "not bookable" has to mean the key is absent
  // rather than present and empty.
  const id = (suffix: string) => (bookable ? { id: `${slug}-${suffix}` } : {});
  const noun = of ? { of } : {};

  return [
    {
      ...id('1h'),
      durationMinutes: 60,
      photos: { min: 25, max: 40, ...noun },
      delivery: { days: 1 },
      priceUzs: 250000,
    },
    {
      ...id('90m'),
      durationMinutes: 90,
      photos: { min: 40, max: 60, ...noun },
      delivery: { days: 2 },
      priceUzs: 400000,
      highlight: true,
    },
    {
      ...id('150m'),
      durationMinutes: 150,
      photos: { min: 80, max: 120, ...noun },
      delivery: { days: 3 },
      priceUzs: 700000,
    },
  ];
}

export const servicesData: ServiceData[] = [
  // COMMERCIAL
  {
    slug: 'brand-product',
    category: 'commercial',
    title: {
      en: 'Brand & Product Photography',
      ru: 'Предметная и бренд-съёмка',
      uz: 'Mahsulot va brend suratga olish',
    },
    tagline: {
      en: 'Make your product impossible to scroll past.',
      ru: 'Чтобы ваш товар не пролистали.',
      uz: 'Mahsulotingizni aylantirib o‘tib ketishmasin.',
    },
    description: {
      en: 'Clean, intentional images that put your product front and center. Whether you need e-commerce flats, lifestyle context shots, or a full brand campaign, we build a visual story around what you sell.',
      ru: 'Чистые, продуманные кадры, где товар — главный герой. Нужны фото для маркетплейса, лайфстайл-съёмка в интерьере или целая кампания для бренда — выстраиваем визуальную историю вокруг того, что вы продаёте.',
      uz: 'Mahsulot bosh qahramon bo‘lgan toza, o‘ylangan kadrlar. Marketpleys uchun suratlarmi, interyerdagi laifstayl suratmi yoki brend uchun butun kampaniyami — sotayotgan narsangiz atrofida vizual hikoya quramiz.',
    },
    iconName: 'Camera',
    coverPath: 'Random/espressomachine.jpg',
    // "My best picks", in this order. EMPTY = the page picks for you.
    // Bunny storage paths, same shape as coverPath above.
    //   node --env-file=.env.local scripts/list-photos.mjs   lists them all.
    galleryPaths: [],
    galleryCategory: 'Random',
    includes: [
      {
        en: 'Full pre-shoot mood board & concept call',
        ru: 'Мудборд и созвон по концепции до съёмки',
        uz: 'Suratdan oldin mudbord va konsepsiya bo‘yicha qo‘ng‘iroq',
      },
      {
        en: 'Professional lighting setup (studio or on-location)',
        ru: 'Профессиональный свет — в студии или на локации',
        uz: 'Professional yorug‘lik — studiyada yoki lokatsiyada',
      },
      {
        en: 'Up to 3 product variations per session',
        ru: 'До 3 вариаций товара за съёмку',
        uz: 'Bir suratga olishda 3 tagacha mahsulot variatsiyasi',
      },
      {
        en: 'High-resolution exports optimised for web and print',
        ru: 'Файлы в высоком разрешении — под веб и печать',
        uz: 'Yuqori aniqlikdagi fayllar — veb va bosma uchun',
      },
    ],
    howToPrepare: [
      {
        en: 'Bring products clean and polished — no fingerprints or dust',
        ru: 'Принесите товар чистым — без отпечатков и пыли',
        uz: 'Mahsulotni toza olib keling — barmoq izi va changsiz',
      },
      {
        en: 'Have a rough idea of where the images will be used (Instagram, website, ads)',
        ru: 'Прикиньте, где будут жить эти кадры: Instagram, сайт, реклама',
        uz: 'Kadrlar qayerda ishlatilishini o‘ylab qo‘ying: Instagram, sayt, reklama',
      },
      {
        en: 'Share any reference images or brand guidelines beforehand',
        ru: 'Заранее пришлите референсы или брендбук',
        uz: 'Referenslar yoki brendbukni oldindan yuboring',
      },
    ],
    packages: standardTiers('brand-product'),
    faqs: [
      { question: {
        en: 'Do you shoot events, weddings or editorial?',
        ru: 'Снимаете мероприятия, свадьбы, editorial?',
        uz: 'Tadbirlar, to‘ylar yoki editorial suratga olasizmi?',
      }, answer: {
        en: 'Yes, on request. There is no fixed package for those — message me on Telegram and we will scope it together.',
        ru: 'Да, под запрос. Отдельных пакетов на них нет — напишите в Telegram, обсудим и посчитаем.',
        uz: 'Ha, so‘rov bo‘yicha. Ular uchun tayyor paket yo‘q — Telegramda yozing, birga kelishamiz.',
      } },
      { question: {
        en: 'Can I bring multiple products?',
        ru: 'Можно принести несколько товаров?',
        uz: 'Bir nechta mahsulot olib kelsam bo‘ladimi?',
      }, answer: {
        en: 'Yes — up to 3 variations are included. Additional products can be added for a small fee.',
        ru: 'Да — до 3 вариаций входит в стоимость. Остальное добавляется за небольшую доплату.',
        uz: 'Ha — 3 tagacha variatsiya narxga kiradi. Qolgani kichik qo‘shimcha to‘lov bilan.',
      } },
      { question: {
        en: 'Do you offer video too?',
        ru: 'Видео снимаете?',
        uz: 'Video ham olasizmi?',
      }, answer: {
        en: 'Short Reels-style clips can be added to any package. Ask about pricing when booking.',
        ru: 'Короткие ролики в формате Reels можно добавить к любому пакету. Спросите про цену при брони.',
        uz: 'Reels formatidagi qisqa roliklarni istalgan paketga qo‘shsa bo‘ladi. Band qilishda narxini so‘rang.',
      } },
      { question: {
        en: 'What if I need a specific aesthetic?',
        ru: 'А если нужна конкретная эстетика?',
        uz: 'Aniq bir estetika kerak bo‘lsa-chi?',
      }, answer: {
        en: 'Share your references and I will replicate the lighting style and colour palette.',
        ru: 'Пришлите референсы — повторю схему света и цветовую палитру.',
        uz: 'Referenslarni yuboring — yorug‘lik sxemasi va rang palitrasini takrorlayman.',
      } },
    ],
    accentColor: '#1500FF',
  },
  {
    slug: 'portraits',
    category: 'moments',
    title: {
      en: 'Portrait Sessions',
      ru: 'Портретная съёмка',
      uz: 'Portret suratga olish',
    },
    tagline: {
      en: 'Studio polish or street spontaneity — portraits made your way.',
      ru: 'Студийная выверенность или уличная спонтанность — как вам ближе.',
      uz: 'Studiya aniqligi yoki ko‘cha erkinligi — qaysi biri yaqin bo‘lsa.',
    },
    description: {
      en: "Solo, a couple, a friend group or the whole family — and a LinkedIn headshot when you need one. Shot in-studio or as a relaxed photowalk through Tashkent's best backdrops instead of a fixed location. One flexible service built around however you want to show up on camera.",
      ru: 'Соло, вдвоём, компанией или всей семьёй — и портрет для LinkedIn, если он нужен. В студии или на спокойной фотопрогулке по лучшим местам Ташкента вместо одной фиксированной локации. Одна гибкая съёмка, выстроенная под то, как вы хотите оказаться в кадре.',
      uz: 'Yakka, juftlik, do‘stlar davrasi yoki butun oila — kerak bo‘lsa LinkedIn uchun portret ham. Studiyada yoki bitta qat’iy lokatsiya o‘rniga Toshkentning eng yaxshi joylari bo‘ylab tinch fotosayrda. Kadrda qanday ko‘rinishni xohlasangiz, shunga moslangan bitta moslashuvchan suratga olish.',
    },
    iconName: 'User',
    coverPath: 'Portraits/Radmir/3M0A0772.png',
    // "My best picks", in this order. EMPTY = the page picks for you.
    // Bunny storage paths, same shape as coverPath above.
    //   node --env-file=.env.local scripts/list-photos.mjs   lists them all.
    galleryPaths: [],
    galleryCategory: 'Portraits',
    includes: [
      {
        en: 'Choice of studio session or on-location / photowalk format',
        ru: 'Формат на выбор: студия или выезд / фотопрогулка',
        uz: 'Format tanlovi: studiya yoki chiqish / fotosayr',
      },
      {
        en: 'Solo, pair, or group compositions — mix and match on the day',
        ru: 'Соло, парные и групповые кадры — можно смешивать прямо на съёмке',
        uz: 'Yakka, juft va guruh kadrlar — suratga olish paytida aralashtirsa bo‘ladi',
      },
      {
        en: 'Posing guidance for individuals and groups alike',
        ru: 'Работа с позами — и для одного человека, и для группы',
        uz: 'Pozalar ustida ishlash — yakka odam uchun ham, guruh uchun ham',
      },
      {
        en: 'Families and children — the pace follows the youngest, not the clock',
        ru: 'Семьи и дети — темп под самого младшего, а не под часы',
        uz: 'Oilalar va bolalar — sur’at eng kichigiga qarab, soatga emas',
      },
      {
        en: 'Business headshots for LinkedIn and press, with background and expression coaching',
        ru: 'Деловые портреты для LinkedIn и прессы — с выбором фона и работой над мимикой',
        uz: 'LinkedIn va matbuot uchun biznes portretlar — fon tanlovi va mimika ustida ish bilan',
      },
      {
        en: 'Retouched final selects, delivered as a private online gallery',
        ru: 'Отретушированные кадры в закрытой онлайн-галерее',
        uz: 'Retush qilingan kadrlar yopiq onlayn galereyada',
      },
    ],
    howToPrepare: [
      {
        en: 'Bring 2–3 outfit options — solid colours and textures photograph best',
        ru: 'Возьмите 2–3 комплекта — однотонное и фактурное снимается лучше всего',
        uz: '2–3 komplekt oling — bir rangli va fakturali eng yaxshi chiqadi',
      },
      {
        en: 'For groups, coordinate (not match) colours across everyone',
        ru: 'Для группы — согласуйте цвета между всеми (не одинаковые)',
        uz: 'Guruh uchun — ranglarni hamma bilan kelishing (bir xil emas)',
      },
      {
        en: 'Choosing the photowalk format? Wear comfortable shoes',
        ru: 'Выбрали фотопрогулку? Обувь — удобная',
        uz: 'Fotosayrni tanladingizmi? Poyabzal — qulay bo‘lsin',
      },
      {
        en: 'With young children, book around nap time and bring a snack',
        ru: 'С маленькими детьми — подбирайте время под дневной сон и возьмите перекус',
        uz: 'Kichkina bolalar bilan — kunduzgi uyquga moslab vaqt oling va yegulik oling',
      },
    ],
    packages: standardTiers('portraits', { of: 'portraits' }),
    faqs: [
      { question: {
        en: 'Studio or outdoors — which should I pick?',
        ru: 'Студия или улица — что выбрать?',
        uz: 'Studiya yoki ko‘cha — qaysi birini tanlash kerak?',
      }, answer: {
        en: 'Studio gives full lighting control; a photowalk through Tashkent adds movement and real backdrops. Tell me your vibe and I will recommend a spot.',
        ru: 'В студии полный контроль над светом; фотопрогулка по Ташкенту добавляет движение и живой фон. Расскажите, какое настроение хотите, — подскажу место.',
        uz: 'Studiyada yorug‘lik to‘liq nazoratda; Toshkent bo‘ylab fotosayr harakat va jonli fon qo‘shadi. Qanday kayfiyat xohlayotganingizni ayting — joyni men maslahat beraman.',
      } },
      { question: {
        en: "What if the kids won't cooperate?",
        ru: 'А если дети не будут слушаться?',
        uz: 'Bolalar gapga kirmasa-chi?',
      }, answer: {
        en: 'It happens. Buffer time is built into every session with children for exactly this.',
        ru: 'Так и бывает. В съёмке с детьми у меня всегда заложен запас времени именно на это.',
        uz: 'Shunday bo‘ladi. Bolalar bilan suratga olishda men doim aynan shunga vaqt zaxirasi qoldiraman.',
      } },
      { question: {
        en: 'Can I get a LinkedIn headshot out of this?',
        ru: 'Можно получить портрет для LinkedIn?',
        uz: 'Bundan LinkedIn uchun portret olsam bo‘ladimi?',
      }, answer: {
        en: 'Yes — say so when booking and we will shoot a clean, neutral-background set alongside the rest.',
        ru: 'Да — скажите при брони, и мы отснимем отдельную серию на нейтральном фоне вместе с остальным.',
        uz: 'Ha — band qilishda ayting, qolganlari bilan birga neytral fonda alohida seriya olamiz.',
      } },
      { question: {
        en: 'How many people can join?',
        ru: 'Сколько человек может участвовать?',
        uz: 'Necha kishi qatnashishi mumkin?',
      }, answer: {
        en: 'Solo sessions to full friend groups — just let me know the headcount when booking so I can plan timing.',
        ru: 'От соло до большой компании — скажите количество при брони, чтобы я рассчитал время.',
        uz: 'Yakkadan katta kompaniyagacha — vaqtni hisoblashim uchun band qilishda sonini ayting.',
      } },
      { question: {
        en: 'Can we split time between two locations?',
        ru: 'Можно разделить время между двумя локациями?',
        uz: 'Vaqtni ikkita lokatsiyaga bo‘lsa bo‘ladimi?',
      }, answer: {
        en: 'Yes — this is common for 2–3 hour sessions, for example half studio, half photowalk.',
        ru: 'Да — для съёмок на 2–3 часа это обычное дело: половина в студии, половина на прогулке.',
        uz: 'Ha — 2–3 soatlik suratga olishlarda bu odatiy hol: yarmi studiyada, yarmi sayrda.',
      } },
    ],
    accentColor: '#2a6045',
  },
  {
    slug: 'graduation',
    category: 'moments',
    title: {
      en: 'Graduation Photography',
      ru: 'Фотосъёмка выпускного',
      uz: 'Bitiruv fotosessiyasi',
    },
    tagline: {
      en: 'Cap, gown, and the people who got you there.',
      ru: 'Мантия, шапочка и те, благодаря кому вы здесь.',
      uz: 'Mantiya, bitiruv shapkasi va sizni shu kunga yetkazgan odamlar.',
    },
    description: {
      en: 'Four years, one afternoon. Most of these happen on the WIUT campus with a gown borrowed for the day — solo portraits, your friends, and your parents, who have been waiting for this longer than you have. If you also want someone at the ceremony itself, that is a separate booking below.',
      ru: 'Четыре года — и один день. Чаще всего съёмка проходит на кампусе WIUT, с мантией, взятой на день: портреты соло, друзья и родители, которые ждали этого дольше вас. Если фотограф нужен и на самой церемонии — это отдельная съёмка ниже.',
      uz: 'To‘rt yil — va bitta kun. Ko‘pincha suratga olish WIUT kampusida, bir kunga olingan mantiyada bo‘ladi: yakka portretlar, do‘stlar va bu kunni sizdan ham ko‘proq kutgan ota-onangiz. Marosimning o‘zida ham fotograf kerak bo‘lsa — bu quyida alohida buyurtma.',
    },
    iconName: 'GraduationCap',
    coverPath: 'WIUT/5Y2A4401.png',
    // "My best picks", in this order. EMPTY = the page picks for you.
    // Bunny storage paths, same shape as coverPath above.
    //   node --env-file=.env.local scripts/list-photos.mjs   lists them all.
    galleryPaths: [
      'Portraits/ShirinGrad.png',
      'Portraits/RadmirGrad.png',
      'Portraits/DiyoraGrad.png',
    ],
    galleryCategory: 'WIUT',
    // "References", not "My best picks" — a graduating student arrives knowing
    // they want graduation photographs and not what they should look like, so
    // the rail is a menu to choose from rather than a portfolio to admire.
    // Graduation only; every other service keeps the default heading.
    galleryHeading: 'references',
    hero: {
      // The drawn cap stays, demoted to a watermark behind the photographs.
      // Its own comment said to drop it the moment there was real work to lead
      // with; this is that, one step early — the frames are portrait work
      // rather than gown work, which is honest about what it is and still
      // shows a person rather than a rhombus.
      graphic: 'stack',
      // The campus, not the cover. coverPath is chosen to survive being cropped
      // to a social card; the ground is chosen to survive being taken to 55%
      // opacity under two gradients, which is a different job.
      groundPath: 'WIUT/5I9A3029.png',
      eyebrow: {
        en: 'Graduation · Tashkent',
        ru: 'Выпускной · Ташкент',
        uz: 'Bitiruv · Toshkent',
      },
    },
    keywords: [
      'WIUT graduation photographer',
      'graduation photoshoot Tashkent',
      'graduation photographer Tashkent',
      'фотограф на выпускной Ташкент',
      'фотосессия выпускной Ташкент',
      'bitiruv fotosessiya Toshkent',
      'bitiruv uchun fotograf',
    ],

    // TODO(marshall): fill in `date` once WIUT announces it — check
    // wiut.uz/events in October. Empty on purpose rather than guessed: 2023 was
    // 18 Nov and 2024 was 22 Nov, but "probably" is not printable on a page
    // someone books from. Venue and slots render regardless; a countdown
    // appears the moment a real date lands here.
    event: {
      date: '',
      label: {
        en: 'WIUT Graduation Ceremony',
        ru: 'Церемония вручения дипломов WIUT',
        uz: 'WIUT diplom topshirish marosimi',
      },
      venue: {
        en: 'Alisher Navoi Cinema Palace (Panorama), Navoi 15',
        ru: 'Дворец кино имени Алишера Навои («Панорама»), Навои 15',
        uz: 'Alisher Navoiy nomidagi kino saroyi («Panorama»), Navoiy 15',
      },
      note: {
        en: 'Held off campus, in two slots — Business Management and Business Information Systems in the morning, every other course in the afternoon. Registration has closed about a week and a half beforehand in past years.',
        ru: 'Проходит не на кампусе, в двух потоках: Business Management и Business Information Systems утром, остальные направления днём. В прошлые годы регистрация закрывалась примерно за полторы недели до церемонии.',
        uz: 'Kampusda emas, ikki bosqichda o‘tadi: ertalab Business Management va Business Information Systems, tushdan keyin qolgan yo‘nalishlar. O‘tgan yillarda ro‘yxatdan o‘tish taxminan bir yarim hafta oldin yopilgan.',
      },
      // Real numbers only. Raise `booked` as sessions fill; the page says
      // nothing about scarcity until there is something true to say.
      capacity: 12,
      booked: 0,
    },

    audience: {
      // "Are you a WIUTerian?" — what the cohort calls itself, kept as a proper
      // noun in all three languages rather than translated. "Студент WIUT?" is
      // a category a form would put you in; WIUTerian is a thing people call
      // themselves, and the point of this switch is that the visitor recognises
      // themselves in it before they read anything else on the page.
      prompt: {
        en: 'Are you a WIUTerian?',
        ru: 'Вы WIUTerian?',
        uz: 'Siz WIUTerianmisiz?',
      },
      // The campus itself, behind the switch. A WIUT student identifies the
      // building faster than they read the question above it.
      backdropPath: 'WIUT/5I9A3029.png',
      eyebrow: {
        en: 'WIUT Graduation · Tashkent',
        ru: 'Выпускной WIUT · Ташкент',
        uz: 'WIUT bitiruvi · Toshkent',
      },
      description: {
        en: 'Four years, one afternoon. Most WIUT graduates borrow a gown and shoot on campus — solo portraits, your friends, and your parents, who have been waiting for this longer than you have. The ceremony itself is at Panorama on Navoi, and that is a separate booking below.',
        ru: 'Четыре года — и один день. Большинство выпускников WIUT берут мантию и снимаются на кампусе: портреты, друзья и родители, которые ждали этого дольше вас. Сама церемония проходит в «Панораме» на Навои — это отдельная съёмка ниже.',
        uz: 'To‘rt yil — va bitta kun. WIUT bitiruvchilarining ko‘pi mantiya olib, kampusda suratga tushadi: yakka portretlar, do‘stlar va bu kunni sizdan ham ko‘proq kutgan ota-onangiz. Marosimning o‘zi Navoiydagi «Panorama»da bo‘ladi — bu quyida alohida buyurtma.',
      },
      groups: {
        session: {
          title: { en: 'At WIUT', ru: 'В WIUT', uz: 'WIUTda' },
          blurb: {
            en: 'On the WIUT campus, on a day that suits you — gown borrowed, no ceremony crowd, no rush.',
            ru: 'На кампусе WIUT, в удобный вам день — мантия взята заранее, без толпы и без спешки.',
            uz: 'WIUT kampusida, sizga qulay kunda — mantiya oldindan olinadi, olomon ham, shoshilish ham yo‘q.',
          },
        },
        ceremony: {
          title: { en: 'At the ceremony', ru: 'На церемонии', uz: 'Marosimda' },
          blurb: {
            en: 'Coverage at Panorama — walking up, the moment itself, and your family straight afterwards.',
            ru: 'Съёмка в «Панораме» — выход, сам момент и семья сразу после.',
            uz: '«Panorama»da suratga olish — sahnaga chiqish, o‘sha lahza va darhol keyin oilangiz.',
          },
        },
      },
    },

    notice: {
      title: {
        en: 'My first graduation season',
        ru: 'Мой первый сезон выпускных',
        uz: 'Bitiruvlar bo‘yicha birinchi mavsumim',
      },
      body: {
        en: 'I have not shot a WIUT graduation before, and the pricing says so rather than pretending otherwise. What you get instead of a long client list: portrait work you can look at on this page right now, a campus I know well, and far more attention than a photographer running six sessions a day in November.',
        ru: 'Я ещё не снимал выпускной WIUT, и цена говорит об этом честно, а не делает вид, что всё наоборот. Вместо длинного списка клиентов вы получаете портретные работы, которые можно посмотреть прямо на этой странице, кампус, который я хорошо знаю, и куда больше внимания, чем у фотографа с шестью съёмками в день в ноябре.',
        uz: 'Men hali WIUT bitiruvini suratga olmaganman, va narx buni yashirmay aytadi. Uzun mijozlar ro‘yxati o‘rniga sizga shu sahifada hozir ko‘rib chiqsa bo‘ladigan portret ishlari, men yaxshi biladigan kampus va noyabrda kuniga oltita suratga olish o‘tkazadigan fotografnikidan ancha ko‘proq e’tibor beriladi.',
      },
    },

    // Empty until real quotes exist. The section renders nothing rather than
    // showing placeholder praise \u2014 invented testimonials in a cohort where
    // everyone knows everyone is the fastest way to lose the cohort.
    proof: [],


    includes: [
      {
        en: 'Solo portraits, your friend group, and your family — all in one session',
        ru: 'Портреты соло, компания друзей и семья — всё за одну съёмку',
        uz: 'Yakka portretlar, do‘stlar davrasi va oila — hammasi bitta suratga olishda',
      },
      {
        en: 'On the WIUT campus, or anywhere in Tashkent you would rather be',
        ru: 'На кампусе WIUT или в любом другом месте Ташкента, где вам приятнее',
        uz: 'WIUT kampusida yoki Toshkentning siz xohlagan istalgan joyida',
      },
      {
        en: 'Your own private gallery link, with download sizes for posting and for printing',
        ru: 'Личная ссылка на галерею — с размерами и для публикации, и для печати',
        uz: 'Shaxsiy galereya havolasi — ijtimoiy tarmoq va bosma uchun alohida o‘lchamlar bilan',
      },
      {
        en: 'A few finished frames within hours, so you have something to post the same day',
        ru: 'Несколько готовых кадров уже через пару часов — будет что выложить в тот же день',
        uz: 'Bir necha soatdayoq bir nechta tayyor kadr — o‘sha kuniyoq joylashingiz uchun',
      },
    ],
    howToPrepare: [
      {
        en: 'Sort the gown first — the university has a limited number and they go quickly the closer you get to the ceremony',
        ru: 'Сначала решите вопрос с мантией — их в университете ограниченное число, и ближе к церемонии они разбираются быстро',
        uz: 'Avval mantiyani hal qiling — universitetda ular soni cheklangan va marosimga yaqinlashgan sari tez tugaydi',
      },
      {
        en: 'Late afternoon is the light you want; in November that means around 3–4pm',
        ru: 'Лучший свет — ближе к вечеру; в ноябре это примерно 15:00–16:00',
        uz: 'Eng yaxshi yorug‘lik — kunning ikkinchi yarmida; noyabrda bu taxminan 15:00–16:00',
      },
      {
        en: 'Bring whoever is coming. Parents and friends are part of the session, not an extra',
        ru: 'Берите с собой всех, кто хочет прийти. Родители и друзья — часть съёмки, а не доплата',
        uz: 'Kelmoqchi bo‘lgan hammani olib keling. Ota-ona va do‘stlar — suratga olishning bir qismi, qo‘shimcha to‘lov emas',
      },
      {
        en: 'Flat shoes for walking between spots, and carry the ones you want to be photographed in',
        ru: 'Удобная обувь для переходов между точками, а ту, в которой хотите сниматься, возьмите с собой',
        uz: 'Joydan joyga yurish uchun qulay poyabzal, suratga tushmoqchi bo‘lganingizni esa o‘zingiz bilan olib yuring',
      },
    ],

    packageGroups: [
      {
        key: 'session',
        locationIds: ['wiut', 'studio'],
        title: { en: 'At campus', ru: 'На кампусе', uz: 'Kampusda' },
        blurb: {
          en: 'On campus or a location you pick, on a day that suits you — no ceremony crowd, no rush.',
          ru: 'На кампусе или в месте, которое выберете вы, в удобный день — без толпы и без спешки.',
          uz: 'Kampusda yoki o‘zingiz tanlagan joyda, qulay kunda — olomonsiz va shoshilinchsiz.',
        },
        packages: [
          { id: 'grad-campus-1h', durationMinutes: 60, photos: { min: 25, max: 40 }, delivery: { days: 1 }, priceUzs: 250000 },
          {
            id: 'grad-campus-90m', durationMinutes: 90, photos: { min: 40, max: 60 }, delivery: { days: 2 },
            priceUzs: 400000, highlight: true,
            perks: [
              { en: 'Two locations on campus', ru: 'Две локации на кампусе', uz: 'Kampusda ikkita joy' },
              { en: '2 printed photos, 20×30 cm', ru: '2 напечатанных фото, 20×30 см', uz: '2 ta bosma surat, 20×30 sm' },
            ],
          },
          {
            id: 'grad-campus-group', durationMinutes: 150, photos: { min: 80, max: 120 }, delivery: { days: 3 },
            priceUzs: 700000,
            // Short on purpose: this sits after the duration on one truncating
            // line ("2,5 часа · группа"). The long Russian and Uzbek wordings
            // ran past the row and were cut mid-word on any phone under 360px.
            note: { en: 'group', ru: 'группа', uz: 'guruh' },
            asksPeople: { min: 2, max: 8 },
            perks: [
              { en: 'One price for the whole group, however many of you come', ru: 'Одна цена за всю группу, сколько бы вас ни было', uz: 'Butun guruh uchun bitta narx, nechta bo‘lsangiz ham' },
              { en: 'Solo portraits for everyone, not only group shots', ru: 'Сольные портреты для каждого, не только общие кадры', uz: 'Har kimga yakka portret, faqat guruh kadrlari emas' },
              // 15x21 rather than 20x30 here: two prints EACH is eight prints,
              // and at 20x30 that is 200 000 so'm — 29% of the booking.
              { en: '2 printed photos each, 15×21 cm (up to 5 people)', ru: 'По 2 напечатанных фото каждому, 15×21 см (до 5 человек)', uz: 'Har biriga 2 tadan bosma surat, 15×21 sm (5 kishigacha)' },
            ],
          },
        ],
      },
      {
        key: 'ceremony',
        locationIds: ['panorama', 'studio'],
        title: { en: 'On the day', ru: 'В день церемонии', uz: 'Marosim kuni' },
        blurb: {
          en: 'Coverage at the ceremony — walking up, the moment itself, and your family straight afterwards.',
          ru: 'Съёмка на самой церемонии — выход, момент вручения и семья сразу после.',
          uz: 'Marosimning o‘zida suratga olish — sahnaga chiqish, topshirish lahzasi va darhol keyin oilangiz.',
        },
        packages: [
          {
            id: 'grad-ceremony-2h', durationMinutes: 120, photos: { min: 60, max: 90 },
            delivery: { days: 3, sameDayPreview: true }, priceUzs: 500000,
            perks: [
              { en: 'A few finished frames the same evening', ru: 'Несколько готовых кадров в тот же вечер', uz: 'O‘sha oqshomning o‘zida bir nechta tayyor kadr' },
              { en: '2 printed photos, 20×30 cm', ru: '2 напечатанных фото, 20×30 см', uz: '2 ta bosma surat, 20×30 sm' },
            ],
          },
          {
            id: 'grad-ceremony-4h', durationMinutes: 240, photos: { min: 150, max: 200 },
            delivery: { days: 4, sameDayPreview: true }, priceUzs: 900000, highlight: true,
            perks: [
              { en: 'Before, during and after the ceremony', ru: 'До, во время и после церемонии', uz: 'Marosimdan oldin, davomida va keyin' },
              { en: 'A few finished frames the same evening', ru: 'Несколько готовых кадров в тот же вечер', uz: 'O‘sha oqshomning o‘zida bir nechta tayyor kadr' },
              { en: '4 printed photos, 20×30 cm', ru: '4 напечатанных фото, 20×30 см', uz: '4 ta bosma surat, 20×30 sm' },
            ],
          },
        ],
      },
    ],

    faqs: [
      {
        question: {
          en: 'Can we shoot on the WIUT campus?',
          ru: 'Можно снимать на кампусе WIUT?',
          uz: 'WIUT kampusida suratga tushish mumkinmi?',
        },
        answer: {
          en: 'Yes — that is where most of these happen. Students can get a gown for a photoshoot, and we pick a time when the light is good and the campus is quiet rather than fighting the crowd on ceremony day.',
          ru: 'Да — там и проходит большинство таких съёмок. Студенты могут взять мантию для фотосессии, а время мы выбираем такое, когда свет хороший, а на кампусе спокойно, — вместо толпы в день церемонии.',
          uz: 'Ha — bunday suratga olishlarning ko‘pi aynan o‘sha yerda bo‘ladi. Talabalar fotosessiya uchun mantiya olishlari mumkin, vaqtni esa yorug‘lik yaxshi va kampus tinch bo‘lgan paytga qo‘yamiz — marosim kunidagi olomon o‘rniga.',
        },
      },
      {
        question: {
          en: 'Where is the ceremony itself held?',
          ru: 'Где проходит сама церемония?',
          uz: 'Marosimning o‘zi qayerda o‘tadi?',
        },
        answer: {
          en: 'Not on campus. WIUT holds it at the Alisher Navoi Cinema Palace (Panorama) on Navoi Street, in two slots — Business Management and Business Information Systems in the morning, every other course in the afternoon. If you want photographs there, book the ceremony-day package.',
          ru: 'Не на кампусе. WIUT проводит её во Дворце кино имени Алишера Навои («Панорама») на улице Навои, в двух потоках: Business Management и Business Information Systems утром, остальные направления днём. Если нужны фотографии оттуда — берите пакет на день церемонии.',
          uz: 'Kampusda emas. WIUT uni Navoiy ko‘chasidagi Alisher Navoiy nomidagi kino saroyida («Panorama») ikki bosqichda o‘tkazadi: ertalab Business Management va Business Information Systems, tushdan keyin qolgan yo‘nalishlar. O‘sha yerdan suratlar kerak bo‘lsa — marosim kuni paketini tanlang.',
        },
      },
      {
        question: {
          en: 'Can I split a session with friends?',
          ru: 'Можно разделить съёмку с друзьями?',
          uz: 'Suratga olishni do‘stlar bilan bo‘lishsa bo‘ladimi?',
        },
        answer: {
          en: 'Yes, and it is the option most people want once they hear it. The 2.5-hour group session is 700,000 so\'m for the whole group — two of you or five, the price is the same — and everyone gets their own solo portraits as well as the group shots.',
          ru: 'Да, и, услышав про этот вариант, большинство выбирает именно его. Групповая съёмка на 2,5 часа стоит 700 000 сум за всю группу — вдвоём или впятером, цена одна, — и каждый получает свои сольные портреты, а не только общие кадры.',
          uz: 'Ha, va bu variantni eshitgach ko‘pchilik aynan shuni tanlaydi. 2,5 soatlik guruh suratga olish butun guruh uchun 700 000 so‘m — ikki kishimisiz yoki besh, narx bir xil — va har kim guruh kadrlaridan tashqari o‘z yakka portretlarini ham oladi.',
        },
      },
      {
        question: {
          en: 'How soon can I post something?',
          ru: 'Как скоро я смогу что-нибудь выложить?',
          uz: 'Qachon birinchi suratni joylay olaman?',
        },
        answer: {
          en: 'A few finished frames the same evening, every time. The full set follows within a day or three depending on the package.',
          ru: 'Несколько готовых кадров в тот же вечер — всегда. Полный набор приходит через один-три дня, в зависимости от пакета.',
          uz: 'Bir nechta tayyor kadr o‘sha oqshomning o‘zida — har doim. To‘liq to‘plam paketga qarab bir-uch kun ichida keladi.',
        },
      },
      {
        question: {
          en: 'You have not shot a graduation before — why book you?',
          ru: 'Вы раньше не снимали выпускной — почему тогда вы?',
          uz: 'Siz ilgari bitiruv suratga olmagansiz — nega aynan siz?',
        },
        answer: {
          en: 'Fair question, and the honest answer is on this page: the portrait work above is mine, and a gown does not change how a portrait is made. What it does change is the price — this is my first season and it costs a fraction of what it will next year. You are trading a track record for a better rate and a photographer with time for you.',
          ru: 'Справедливый вопрос, и честный ответ — на этой странице: портреты выше сняты мной, а мантия не меняет того, как делается портрет. Что она меняет — это цену: это мой первый сезон, и он стоит малую долю от того, что будет стоить в следующем году. Вы меняете послужной список на цену получше и на фотографа, у которого есть на вас время.',
          uz: 'O‘rinli savol, halol javob esa shu sahifada: yuqoridagi portretlar meniki, mantiya esa portret qanday olinishini o‘zgartirmaydi. U o‘zgartiradigani — narx: bu mening birinchi mavsumim va u kelasi yilgining kichik bir ulushiga turadi. Siz tajriba ro‘yxatini yaxshiroq narxga va sizga vaqt ajrata oladigan fotografga almashtiryapsiz.',
        },
      },
      {
        question: {
          en: 'What if it rains, or the date moves?',
          ru: 'А если дождь или дата сдвинется?',
          uz: 'Yomg‘ir yog‘sa yoki sana siljisa-chi?',
        },
        answer: {
          en: 'We move the session, no charge. November in Tashkent is unpredictable and I would rather reshoot than hand you something grey.',
          ru: 'Переносим съёмку без доплаты. Ноябрь в Ташкенте непредсказуем, и мне проще переснять, чем отдать вам серые кадры.',
          uz: 'Suratga olishni qo‘shimcha to‘lovsiz ko‘chiramiz. Toshkentda noyabr oldindan aytib bo‘lmaydigan oy, menga esa kulrang kadrlar berishdan ko‘ra qayta suratga olish osonroq.',
        },
      },
    ],
    // Westminster blue, one step brighter than WIUT's own #0143A3.
    //
    // Deliberately NOT their exact swatch. This page names WIUT throughout and
    // is a commercial page by someone the university has nothing to do with;
    // adopting their brand hex as well edges it toward looking official. Same
    // family, clearly its own — and no crest, no logo, no lettermark anywhere.
    accentColor: '#1B4F9C',
  },
  {
    slug: 'models',
    category: 'fashion',
    title: {
      en: 'Model Portfolio',
      ru: 'Портфолио модели',
      uz: 'Model portfoliosi',
    },
    tagline: {
      en: 'Your book, built to open agency doors.',
      ru: 'Портфолио, которое открывает двери агентств.',
      uz: 'Agentliklar eshigini ochadigan portfolio.',
    },
    description: {
      en: 'A focused portfolio shoot for models looking to build or refresh their book. Strong variety: editorial, commercial, and beauty shots that show range to agencies and clients.',
      ru: 'Съёмка для моделей, которые собирают или обновляют книгу. Главное — диапазон: editorial, коммерческие и beauty-кадры, по которым агентству и клиенту видно, что вы умеете.',
      uz: 'Kitobini yig‘ayotgan yoki yangilayotgan modellar uchun suratga olish. Eng muhimi — diapazon: editorial, tijorat va beauty kadrlar, ular orqali agentlik va mijoz nimaga qodir ekaningizni ko‘radi.',
    },
    iconName: 'Camera',
    coverPath: 'WIUT-Fashion-Show/3M0A1946.png',
    // "My best picks", in this order. EMPTY = the page picks for you.
    // Bunny storage paths, same shape as coverPath above.
    //   node --env-file=.env.local scripts/list-photos.mjs   lists them all.
    galleryPaths: [],
    galleryCategory: 'WIUT-Fashion-Show',
    includes: [
      {
        en: 'Pre-shoot concept meeting',
        ru: 'Встреча по концепции до съёмки',
        uz: 'Suratdan oldin konsepsiya bo‘yicha uchrashuv',
      },
      {
        en: '3–4 looks with different lighting setups',
        ru: '3–4 образа с разными схемами света',
        uz: 'Turli yorug‘lik sxemalari bilan 3–4 ta obraz',
      },
      {
        en: 'Both studio and outdoor setups',
        ru: 'И студия, и съёмка на улице',
        uz: 'Ham studiya, ham ko‘chada suratga olish',
      },
      {
        en: 'Print-ready and web-optimised exports',
        ru: 'Файлы под печать и под веб',
        uz: 'Bosma uchun ham, veb uchun ham fayllar',
      },
    ],
    howToPrepare: [
      {
        en: 'Bring 3–4 wardrobe options across different aesthetics (casual, editorial, formal)',
        ru: 'Возьмите 3–4 комплекта разной стилистики: casual, editorial, строгий',
        uz: 'Turli uslubdagi 3–4 komplekt oling: casual, editorial, rasmiy',
      },
      {
        en: 'Come with natural makeup — we can layer up from there',
        ru: 'Приходите с лёгким макияжем — усилить всегда успеем',
        uz: 'Yengil bo‘yanish bilan keling — kuchaytirishga doim ulguramiz',
      },
      {
        en: 'Have your current comp card if you have one',
        ru: 'Если есть комп-карта — возьмите с собой',
        uz: 'Komp-kartangiz bo‘lsa — o‘zingiz bilan oling',
      },
    ],
    packages: standardTiers('models', { of: 'portraits' }),
    faqs: [
      { question: {
        en: 'Do you work with beginner models?',
        ru: 'Работаете с начинающими моделями?',
        uz: 'Boshlovchi modellar bilan ishlaysizmi?',
      }, answer: {
        en: 'Yes. I work with models at all levels and provide full direction throughout.',
        ru: 'Да. Снимаю моделей любого уровня и веду по позам всю съёмку.',
        uz: 'Ha. Har qanday darajadagi modellarni suratga olaman va butun davomida pozalarni aytib turaman.',
      } },
      { question: {
        en: 'Can a makeup artist be arranged?',
        ru: 'Можно организовать визажиста?',
        uz: 'Vizajist tashkil qilsa bo‘ladimi?',
      }, answer: {
        en: 'Yes — a hair and makeup artist can be added to any package.',
        ru: 'Да — визажиста и стилиста по волосам можно добавить к любому пакету.',
        uz: 'Ha — vizajist va soch stilistini istalgan paketga qo‘shsa bo‘ladi.',
      } },
      { question: {
        en: 'Will the photos help me get signed?',
        ru: 'Эти фото помогут подписать контракт?',
        uz: 'Bu suratlar shartnoma tuzishga yordam beradimi?',
      }, answer: {
        en: 'A well-executed book significantly improves your chances. I can advise on what agencies in the region look for.',
        ru: 'Хорошо собранная книга заметно повышает шансы. Подскажу, на что смотрят агентства в регионе.',
        uz: 'Yaxshi yig‘ilgan kitob imkoniyatni sezilarli oshiradi. Mintaqadagi agentliklar nimaga qarashini aytaman.',
      } },
    ],
    accentColor: '#1500FF',
  },
];

export function getServiceBySlug(slug: string): ServiceData | undefined {
  return servicesData.find((s) => s.slug === slug);
}

export function getAllServiceSlugs(): string[] {
  return servicesData.map((s) => s.slug);
}