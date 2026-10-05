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
    slug: 'business-portraits',
    category: 'commercial',
    title: {
      en: 'Business Portraits',
      ru: 'Деловые портреты',
      uz: 'Biznes portretlar',
    },
    tagline: {
      en: 'A great headshot opens doors before you say a word.',
      ru: 'Хороший портрет работает раньше, чем вы скажете слово.',
      uz: 'Yaxshi portret siz gapirmasingizdan oldin ishlaydi.',
    },
    description: {
      en: 'Professional portraits for LinkedIn profiles, company websites, speaker bios, and press kits. The focus is a confident, approachable image that represents you and your brand honestly.',
      ru: 'Портреты для LinkedIn, сайта компании, спикерской биографии и пресс-кита. Задача одна — уверенный и располагающий кадр, который честно показывает вас и вашу работу.',
      uz: 'LinkedIn, kompaniya sayti, spiker biografiyasi va press-kit uchun portretlar. Maqsad bitta — sizni va ishingizni halol ko‘rsatadigan ishonchli va yoqimli kadr.',
    },
    iconName: 'User',
    coverPath: 'Portraits/Radmir/3M0A0675.png',
    // "My best picks", in this order. EMPTY = the page picks for you.
    // Bunny storage paths, same shape as coverPath above.
    //   node --env-file=.env.local scripts/list-photos.mjs   lists them all.
    galleryPaths: [],
    galleryCategory: 'Portraits',
    includes: [
      {
        en: 'Wardrobe and posing guidance before the shoot',
        ru: 'Разбор гардероба и поз до съёмки',
        uz: 'Suratdan oldin kiyim va pozalarni ko‘rib chiqish',
      },
      {
        en: 'Multiple background options (solid, textured, or environmental)',
        ru: 'Несколько фонов на выбор: однотонный, фактурный, интерьерный',
        uz: 'Bir nechta fon tanlovi: bir rangli, fakturali, interyerli',
      },
      {
        en: 'Expression coaching during the session',
        ru: 'Работа с мимикой прямо на съёмке',
        uz: 'Suratga olish paytida mimika ustida ishlash',
      },
      {
        en: 'Retouching: skin smoothing, background cleanup, colour grading',
        ru: 'Ретушь: кожа, фон, цветокоррекция',
        uz: 'Retush: teri, fon, rang korreksiyasi',
      },
    ],
    howToPrepare: [
      {
        en: 'Bring 2–3 outfit options — solid colours work best on camera',
        ru: 'Возьмите 2–3 комплекта — однотонное смотрится лучше всего',
        uz: '2–3 komplekt oling — bir rangli eng yaxshi chiqadi',
      },
      {
        en: "Get a good night's sleep and stay hydrated the day before",
        ru: 'Выспитесь накануне и пейте больше воды',
        uz: 'Oldingi kuni yaxshi uxlang va ko‘proq suv iching',
      },
      {
        en: 'Avoid heavy patterns or logos that distract from your face',
        ru: 'Избегайте крупных принтов и логотипов — они перетягивают внимание с лица',
        uz: 'Yirik printlar va logotiplardan qoching — ular yuzdan diqqatni tortadi',
      },
    ],
    packages: standardTiers('business-portraits', { of: 'portraits' }),
    faqs: [
      { question: {
        en: 'Can I bring a colleague for a joint portrait?',
        ru: 'Можно прийти вдвоём с коллегой?',
        uz: 'Hamkasbim bilan birga kelsam bo‘ladimi?',
      }, answer: {
        en: 'Absolutely. Group rates are available — mention this when booking.',
        ru: 'Конечно. Для групп есть отдельные условия — скажите при брони.',
        uz: 'Albatta. Guruhlar uchun alohida shartlar bor — band qilishda ayting.',
      } },
      { question: {
        en: 'Where is the shoot?',
        ru: 'Где проходит съёмка?',
        uz: 'Suratga olish qayerda bo‘ladi?',
      }, answer: {
        en: 'My studio or an outdoor location in Tashkent — your choice.',
        ru: 'В студии или на улице в Ташкенте — как вам удобнее.',
        uz: 'Studiyada yoki Toshkent ko‘chalarida — qaysi biri qulay bo‘lsa.',
      } },
      { question: {
        en: "What if I'm not photogenic?",
        ru: 'А если я нефотогеничный?',
        uz: 'Men fotogenik bo‘lmasam-chi?',
      }, answer: {
        en: "That's what posing guidance is for. Most clients feel completely natural after the first 10 minutes.",
        ru: 'Для этого и нужна работа с позами. Обычно первые 10 минут — и человек перестаёт думать о камере.',
        uz: 'Shuning uchun pozalar ustida ishlaymiz. Odatda birinchi 10 daqiqadan keyin odam kamerani o‘ylamay qo‘yadi.',
      } },
    ],
    accentColor: '#2a6045',
  },
  {
    slug: 'social-media-content',
    category: 'commercial',
    title: {
      en: 'Social Media Content',
      ru: 'Контент для соцсетей',
      uz: 'Ijtimoiy tarmoqlar uchun kontent',
    },
    tagline: {
      en: 'A month of content in one afternoon.',
      ru: 'Контент на месяц — за один день.',
      uz: 'Bir oylik kontent — bir kunda.',
    },
    description: {
      en: 'Batch content creation for Instagram, Telegram, TikTok, or whatever platform you publish on. We plan the shoot around your calendar, captions, and aesthetic so everything is ready to post.',
      ru: 'Съёмка контента пачкой — для Instagram, Telegram, TikTok или где вы публикуетесь. Планируем съёмку под ваш контент-план, подписи и эстетику, чтобы всё было готово к публикации.',
      uz: 'Kontentni to‘plam bilan suratga olish — Instagram, Telegram, TikTok yoki qayerda chop etsangiz. Suratga olishni kontent-rejangiz, matnlaringiz va estetikangizga moslab rejalashtiramiz, shunda hammasi chop etishga tayyor bo‘ladi.',
    },
    iconName: 'CalendarDays',
    coverPath: 'Random/capp.jpg',
    // "My best picks", in this order. EMPTY = the page picks for you.
    // Bunny storage paths, same shape as coverPath above.
    //   node --env-file=.env.local scripts/list-photos.mjs   lists them all.
    galleryPaths: [],
    galleryCategory: 'Random',
    includes: [
      {
        en: 'Content plan & shot list created together before the day',
        ru: 'Контент-план и список кадров — составляем вместе заранее',
        uz: 'Kontent-reja va kadrlar ro‘yxati — oldindan birga tuzamiz',
      },
      {
        en: 'Mix of flat-lays, lifestyle, and portrait shots',
        ru: 'Флэтлеи, лайфстайл и портреты в одной съёмке',
        uz: 'Bitta suratga olishda fletley, laifstayl va portretlar',
      },
      {
        en: 'Vertical and square crops for Stories and Feed',
        ru: 'Вертикальные и квадратные кадры — под Stories и ленту',
        uz: 'Vertikal va kvadrat kadrlar — Stories va lenta uchun',
      },
      {
        en: 'Colour-consistent editing across all images',
        ru: 'Единая цветокоррекция по всей серии',
        uz: 'Butun seriya bo‘yicha yagona rang korreksiyasi',
      },
    ],
    howToPrepare: [
      {
        en: 'Write down 5–10 topics or products you want to cover this month',
        ru: 'Выпишите 5–10 тем или товаров на ближайший месяц',
        uz: 'Yaqin oy uchun 5–10 ta mavzu yoki mahsulotni yozib qo‘ying',
      },
      {
        en: 'Bring props, packaging, or anything that tells your brand story',
        ru: 'Возьмите реквизит, упаковку — всё, что рассказывает о бренде',
        uz: 'Rekvizit, qadoq — brend haqida gapiradigan hamma narsani oling',
      },
      {
        en: 'Wear outfits that match your brand palette',
        ru: 'Одежда — в палитре вашего бренда',
        uz: 'Kiyim — brendingiz palitrasida',
      },
    ],
    packages: standardTiers('social-media-content'),
    faqs: [
      { question: {
        en: 'Can you help me with the content plan?',
        ru: 'Поможете с контент-планом?',
        uz: 'Kontent-reja bilan yordam berasizmi?',
      }, answer: {
        en: 'Yes — a short planning call is included in every package.',
        ru: 'Да — короткий созвон по планированию входит в каждый пакет.',
        uz: 'Ha — rejalashtirish bo‘yicha qisqa qo‘ng‘iroq har bir paketga kiradi.',
      } },
      { question: {
        en: 'Do you deliver vertical and horizontal versions?',
        ru: 'Будут вертикальные и горизонтальные версии?',
        uz: 'Vertikal va gorizontal versiyalar bo‘ladimi?',
      }, answer: {
        en: 'Yes, crops for Stories (9:16), Feed (1:1), and landscape (4:3) are all included.',
        ru: 'Да: Stories (9:16), лента (1:1) и горизонталь (4:3) — всё входит.',
        uz: 'Ha: Stories (9:16), lenta (1:1) va gorizontal (4:3) — hammasi kiradi.',
      } },
      { question: {
        en: 'How far in advance should I book?',
        ru: 'За сколько бронировать?',
        uz: 'Qancha oldin band qilish kerak?',
      }, answer: {
        en: 'At least 5–7 days ahead so we have time for the planning call.',
        ru: 'Минимум за 5–7 дней, чтобы успеть созвониться по плану.',
        uz: 'Kamida 5–7 kun oldin, reja bo‘yicha gaplashib olishga ulgurish uchun.',
      } },
    ],
    accentColor: '#c8b400',
  },

  // MOMENTS
  {
    slug: 'wedding-love-story',
    category: 'moments',
    title: {
      en: 'Weddings & Love Stories',
      ru: 'Свадьбы и love story',
      uz: 'To‘ylar va love story',
    },
    tagline: {
      en: 'The day goes fast. The photos stay forever.',
      ru: 'День пролетит. Фотографии останутся.',
      uz: 'Kun tez o‘tadi. Suratlar qoladi.',
    },
    description: {
      en: 'Documentary-style wedding coverage that captures real emotion — not just posed shots. From the morning getting-ready chaos to the last dance, I stay in the background and let the story unfold naturally.',
      ru: 'Репортажная свадебная съёмка, где важны настоящие эмоции, а не только постановка. От утренней суеты до последнего танца я держусь в стороне и даю дню идти своим чередом.',
      uz: 'Faqat qo‘yilgan pozalar emas, haqiqiy his-tuyg‘ular muhim bo‘lgan reportaj uslubidagi to‘y suratga olish. Ertalabki shoshqaloqlikdan oxirgi raqsgacha men chetda turaman va kun o‘z oqimi bilan ketaveradi.',
    },
    iconName: 'Camera',
    coverPath: 'Portraits/Sara/3M0A1333.png',
    // "My best picks", in this order. EMPTY = the page picks for you.
    // Bunny storage paths, same shape as coverPath above.
    //   node --env-file=.env.local scripts/list-photos.mjs   lists them all.
    galleryPaths: [],
    includes: [
      {
        en: 'Pre-wedding location scouting or engagement session',
        ru: 'Выезд на локацию заранее или love story до свадьбы',
        uz: 'Lokatsiyaga oldindan chiqish yoki to‘ygacha love story',
      },
      {
        en: 'Full-day coverage (up to 10 hours)',
        ru: 'Съёмка полного дня — до 10 часов',
        uz: 'To‘liq kunlik suratga olish — 10 soatgacha',
      },
      {
        en: 'Two shooting angles during the ceremony',
        ru: 'Две точки съёмки во время церемонии',
        uz: 'Marosim davomida ikkita suratga olish nuqtasi',
      },
      {
        en: 'Online gallery with download access for 1 year',
        ru: 'Онлайн-галерея со скачиванием на год',
        uz: 'Bir yil davomida yuklab olish mumkin bo‘lgan onlayn galereya',
      },
    ],
    howToPrepare: [
      {
        en: 'Share your timeline at least 2 weeks before the date',
        ru: 'Пришлите тайминг минимум за 2 недели',
        uz: 'Taymingni kamida 2 hafta oldin yuboring',
      },
      {
        en: 'Create a short list of must-have shots (family groupings, details)',
        ru: 'Составьте короткий список обязательных кадров — семья, детали',
        uz: 'Majburiy kadrlar ro‘yxatini tuzing — oila, detallar',
      },
      {
        en: 'Assign a point-of-contact on the day to help coordinate family shots',
        ru: 'Назначьте человека, который поможет собирать родственников на кадр',
        uz: 'Qarindoshlarni kadrga yig‘ishga yordam beradigan odamni tayinlang',
      },
    ],
    // SERVICE_TO_PACKAGE maps this to null: a wedding is quoted, not clicked.
    // The ladder is what it costs; the CTA still goes to an enquiry.
    packages: standardTiers('wedding-love-story', { bookable: false }),
    faqs: [
      { question: {
        en: 'Do you travel outside Tashkent?',
        ru: 'Выезжаете за пределы Ташкента?',
        uz: 'Toshkentdan tashqariga chiqasizmi?',
      }, answer: {
        en: 'Yes. Travel costs are added to the package — ask for a quote.',
        ru: 'Да. Дорога считается отдельно — напишите, посчитаю.',
        uz: 'Ha. Yo‘l alohida hisoblanadi — yozing, hisoblab beraman.',
      } },
      { question: {
        en: 'Can we add an engagement shoot?',
        ru: 'Можно добавить love story?',
        uz: 'Love story qo‘shsa bo‘ladimi?',
      }, answer: {
        en: 'Yes, and I recommend it — it helps you relax in front of the camera before the big day.',
        ru: 'Да, и я советую: перед камерой становится намного спокойнее уже к самой свадьбе.',
        uz: 'Ha, va men maslahat beraman: to‘yga borib kamera oldida ancha erkin bo‘lasiz.',
      } },
      { question: {
        en: 'What happens if it rains?',
        ru: 'А если пойдёт дождь?',
        uz: 'Yomg‘ir yog‘sa-chi?',
      }, answer: {
        en: 'We adapt. Rain photos are often the most memorable.',
        ru: 'Подстроимся. Дождливые кадры часто получаются самыми запоминающимися.',
        uz: 'Moslashamiz. Yomg‘irli kadrlar ko‘pincha eng esda qolarli bo‘ladi.',
      } },
    ],
    accentColor: '#2a6045',
  },
  {
    slug: 'family-portraits',
    category: 'moments',
    title: {
      en: 'Family Portraits',
      ru: 'Семейная съёмка',
      uz: 'Oilaviy suratga olish',
    },
    tagline: {
      en: 'Everyone in the same frame. Finally.',
      ru: 'Наконец-то все в одном кадре.',
      uz: 'Nihoyat, hamma bitta kadrda.',
    },
    description: {
      en: 'Relaxed, natural family portraits that capture who you actually are right now — not a stiff lineup. Kids welcome, chaos included.',
      ru: 'Спокойная семейная съёмка, где видно, какие вы на самом деле сейчас, — а не ровный строй на камеру. Дети приветствуются, беспорядок прилагается.',
      uz: 'Kameraga tizilib turish emas, hozir qanday bo‘lsangiz shunday ko‘rinadigan tinch oilaviy suratga olish. Bolalar marhamat, tartibsizlik ham qo‘shimcha.',
    },
    iconName: 'Users',
    coverPath: 'Portraits/Radmir/3M0A0568.png',
    // "My best picks", in this order. EMPTY = the page picks for you.
    // Bunny storage paths, same shape as coverPath above.
    //   node --env-file=.env.local scripts/list-photos.mjs   lists them all.
    galleryPaths: [],
    includes: [
      {
        en: 'Location consultation (park, home, studio)',
        ru: 'Выбираем место вместе: парк, дом, студия',
        uz: 'Joyni birga tanlaymiz: park, uy, studiya',
      },
      {
        en: 'Gentle direction for natural, un-posed moments',
        ru: 'Мягкие подсказки — ради живых, непостановочных моментов',
        uz: 'Yumshoq maslahatlar — jonli, qo‘yilmagan lahzalar uchun',
      },
      {
        en: 'Individual and group compositions',
        ru: 'Общие кадры и портреты каждого',
        uz: 'Umumiy kadrlar va har birining portreti',
      },
      {
        en: 'Child-friendly pacing — no rushing',
        ru: 'Темп под ребёнка — никто никуда не торопится',
        uz: 'Bolaga moslangan sur’at — hech kim shoshmaydi',
      },
    ],
    howToPrepare: [
      {
        en: 'Dress in coordinating (not matching) colours — avoid logos',
        ru: 'Одевайтесь в сочетающихся (не одинаковых) цветах, без логотипов',
        uz: 'Bir-biriga mos (bir xil emas) ranglarda kiyining, logotipsiz',
      },
      {
        en: 'Schedule the shoot around nap times for young children',
        ru: 'Подбирайте время под дневной сон, если дети маленькие',
        uz: 'Bolalar kichkina bo‘lsa, kunduzgi uyquga moslab vaqt tanlang',
      },
      {
        en: 'Bring a snack or small toy if you have toddlers',
        ru: 'Возьмите перекус или небольшую игрушку, если есть малыши',
        uz: 'Kichkintoylar bo‘lsa, yegulik yoki kichik o‘yinchoq oling',
      },
    ],
    packages: standardTiers('family-portraits'),
    faqs: [
      { question: {
        en: 'How many people can you shoot?',
        ru: 'Сколько человек можно снять?',
        uz: 'Necha kishini suratga olsa bo‘ladi?',
      }, answer: {
        en: 'Any size — extended families, multiple generations, no limit.',
        ru: 'Любое количество — большие семьи, несколько поколений, ограничений нет.',
        uz: 'Istalgancha — katta oilalar, bir necha avlod, cheklov yo‘q.',
      } },
      { question: {
        en: "What if the kids won't cooperate?",
        ru: 'А если дети не будут слушаться?',
        uz: 'Bolalar gapga kirmasa-chi?',
      }, answer: {
        en: 'It happens. I build buffer time into every family session for exactly this.',
        ru: 'Так и бывает. В семейной съёмке у меня всегда заложен запас времени именно на это.',
        uz: 'Shunday bo‘ladi. Oilaviy suratga olishda men doim aynan shunga vaqt zaxirasi qoldiraman.',
      } },
      { question: {
        en: 'Can we do it at our home?',
        ru: 'Можно снять у нас дома?',
        uz: 'Uyimizda suratga olsa bo‘ladimi?',
      }, answer: {
        en: 'Yes — home sessions have a beautiful, intimate quality.',
        ru: 'Да — домашние съёмки получаются очень тёплыми и личными.',
        uz: 'Ha — uydagi suratlar juda iliq va shaxsiy chiqadi.',
      } },
    ],
    accentColor: '#1500FF',
  },
  {
    slug: 'events-corporate',
    category: 'moments',
    title: {
      en: 'Events & Corporate Photoshoots',
      ru: 'Мероприятия и корпоративная съёмка',
      uz: 'Tadbirlar va korporativ suratga olish',
    },
    tagline: {
      en: 'Coverage that makes people wish they were there.',
      ru: 'Съёмка, после которой жалеют, что не пришли.',
      uz: 'Ko‘rganlar kelmaganiga afsuslanadigan suratlar.',
    },
    description: {
      en: 'Conferences, product launches, team-building days, and corporate galas. I work fast, stay unobtrusive, and deliver images you can share within 24 hours.',
      ru: 'Конференции, запуски продуктов, тимбилдинги и корпоративы. Работаю быстро, не мешаюсь под ногами и отдаю кадры, которые можно публиковать уже в течение суток.',
      uz: 'Konferensiyalar, mahsulot taqdimotlari, timbildinglar va korporativlar. Tez ishlayman, oyoq ostida o‘ralashmayman va bir sutka ichida chop etsa bo‘ladigan kadrlarni beraman.',
    },
    iconName: 'CalendarDays',
    coverPath: 'WIUT/3M0A0363.png',
    // "My best picks", in this order. EMPTY = the page picks for you.
    // Bunny storage paths, same shape as coverPath above.
    //   node --env-file=.env.local scripts/list-photos.mjs   lists them all.
    galleryPaths: [],
    galleryCategory: 'WIUT',
    includes: [
      {
        en: 'Pre-event briefing to understand key moments',
        ru: 'Бриф до мероприятия — чтобы понимать ключевые моменты',
        uz: 'Tadbirdan oldin brif — asosiy lahzalarni bilish uchun',
      },
      {
        en: 'Fast turnaround — highlight reel within 24 hours',
        ru: 'Быстрая отдача — подборка лучших кадров за 24 часа',
        uz: 'Tez yetkazish — eng yaxshi kadrlar to‘plami 24 soat ichida',
      },
      {
        en: 'Both candid and staged group shots',
        ru: 'И репортаж, и постановочные общие кадры',
        uz: 'Ham reportaj, ham qo‘yilgan umumiy kadrlar',
      },
      {
        en: 'High-res files licensed for commercial use',
        ru: 'Файлы в высоком разрешении с правом коммерческого использования',
        uz: 'Tijorat maqsadida foydalanish huquqi bilan yuqori aniqlikdagi fayllar',
      },
    ],
    howToPrepare: [
      {
        en: 'Share the event schedule and venue floor plan in advance',
        ru: 'Пришлите программу и план площадки заранее',
        uz: 'Dastur va maydon rejasini oldindan yuboring',
      },
      {
        en: 'Identify 3–5 VIP faces I should prioritise',
        ru: 'Отметьте 3–5 ключевых людей — кого снимать в первую очередь',
        uz: '3–5 ta asosiy odamni belgilang — birinchi navbatda kimni olish kerak',
      },
      {
        en: 'Let me know any moments that are strictly off the record',
        ru: 'Скажите, какие моменты снимать не нужно',
        uz: 'Qaysi lahzalarni suratga olish kerak emasligini ayting',
      },
    ],
    // Same as the wedding: advertised at the standard ladder, booked by asking.
    packages: standardTiers('events-corporate', { bookable: false }),
    faqs: [
      { question: {
        en: 'Can you shoot in low-light venues?',
        ru: 'Снимаете в тёмных залах?',
        uz: 'Qorong‘i zallarda suratga olasizmi?',
      }, answer: {
        en: 'Yes — I use fast lenses and off-camera flash when needed.',
        ru: 'Да — светосильная оптика и накамерный свет, когда он нужен.',
        uz: 'Ha — yorug‘ o‘tkazuvchi optika va kerak bo‘lganda qo‘shimcha yorug‘lik.',
      } },
      { question: {
        en: 'Do you provide a photo booth?',
        ru: 'Фотобудка есть?',
        uz: 'Fotobudka bormi?',
      }, answer: {
        en: 'Not directly, but I can recommend a partner service.',
        ru: 'Сам не делаю, но могу порекомендовать проверенных ребят.',
        uz: 'O‘zim qilmayman, lekin ishonchli yigitlarni tavsiya qila olaman.',
      } },
      { question: {
        en: 'What about a video highlight reel?',
        ru: 'А видеоролик с мероприятия?',
        uz: 'Tadbirdan video rolik-chi?',
      }, answer: {
        en: 'Video add-ons are available — mention it when booking.',
        ru: 'Видео можно добавить — скажите при брони.',
        uz: 'Videoni qo‘shsa bo‘ladi — band qilishda ayting.',
      } },
    ],
    accentColor: '#c8b400',
  },
  {
    slug: 'individual-portraits',
    category: 'moments',
    title: {
      en: 'Individual Portraits',
      ru: 'Индивидуальный портрет',
      uz: 'Yakka portret',
    },
    tagline: {
      en: 'Just you — at your best.',
      ru: 'Только вы — и лучший вы.',
      uz: 'Faqat siz — eng yaxshi holatingizda.',
    },
    description: {
      en: 'A personal portrait session built entirely around you. No special occasion needed — just great, honest photos of who you are right now.',
      ru: 'Личная портретная съёмка, целиком выстроенная вокруг вас. Повод не нужен — нужны честные фотографии того, какой вы сейчас.',
      uz: 'Butunlay siz atrofida qurilgan shaxsiy portret suratga olish. Bahona kerak emas — hozir qanday bo‘lsangiz, shuni ko‘rsatadigan halol suratlar kerak.',
    },
    iconName: 'User',
    coverPath: 'Portraits/Sara/3M0A1432.png',
    // "My best picks", in this order. EMPTY = the page picks for you.
    // Bunny storage paths, same shape as coverPath above.
    //   node --env-file=.env.local scripts/list-photos.mjs   lists them all.
    galleryPaths: [],
    galleryCategory: 'Portraits',
    includes: [
      {
        en: 'Location scouting or studio session',
        ru: 'Съёмка в студии или на выбранной локации',
        uz: 'Studiyada yoki tanlangan lokatsiyada suratga olish',
      },
      {
        en: 'Posing guidance throughout',
        ru: 'Работа с позами на протяжении всей съёмки',
        uz: 'Butun suratga olish davomida pozalar ustida ishlash',
      },
      {
        en: 'Multiple outfit changes (time permitting)',
        ru: 'Несколько образов, если позволяет время',
        uz: 'Vaqt yetsa, bir nechta obraz',
      },
      {
        en: 'Retouched final selects',
        ru: 'Отретушированные отобранные кадры',
        uz: 'Tanlangan kadrlar retush bilan',
      },
    ],
    howToPrepare: [
      {
        en: 'Bring 2–3 outfits you feel confident in',
        ru: 'Возьмите 2–3 комплекта, в которых вам уверенно',
        uz: 'O‘zingizni ishonchli his qiladigan 2–3 komplekt oling',
      },
      {
        en: 'Hair and makeup can be arranged — ask when booking',
        ru: 'Причёску и макияж можно организовать — скажите при брони',
        uz: 'Soch va bo‘yanishni tashkil qilsa bo‘ladi — band qilishda ayting',
      },
      {
        en: 'Think of a mood or vibe you want the photos to have',
        ru: 'Подумайте, какое настроение должно быть у кадров',
        uz: 'Kadrlarda qanday kayfiyat bo‘lishini o‘ylab qo‘ying',
      },
    ],
    packages: standardTiers('individual-portraits', { of: 'portraits' }),
    faqs: [
      { question: {
        en: 'Do I need experience in front of a camera?',
        ru: 'Нужен ли опыт перед камерой?',
        uz: 'Kamera oldida tajriba kerakmi?',
      }, answer: {
        en: 'Not at all — I will guide every pose.',
        ru: 'Совсем нет — подскажу каждую позу.',
        uz: 'Umuman kerak emas — har bir pozani aytib turaman.',
      } },
      { question: {
        en: 'Can we shoot in multiple locations?',
        ru: 'Можно снять в нескольких местах?',
        uz: 'Bir necha joyda suratga olsa bo‘ladimi?',
      }, answer: {
        en: 'Yes — 2 spots within Tashkent are typical for longer sessions.',
        ru: 'Да — для длинных съёмок обычно берём 2 точки по Ташкенту.',
        uz: 'Ha — uzoq suratga olishlarda odatda Toshkent bo‘ylab 2 ta nuqta olamiz.',
      } },
      { question: {
        en: 'What should I wear?',
        ru: 'Что надеть?',
        uz: 'Nima kiyish kerak?',
      }, answer: {
        en: 'Bring a few options — solid colours and textures you love photograph best.',
        ru: 'Возьмите несколько вариантов — однотонное и фактурное, которое вы любите, снимается лучше всего.',
        uz: 'Bir nechta variant oling — o‘zingizga yoqadigan bir rangli va fakturali narsalar eng yaxshi chiqadi.',
      } },
    ],
    accentColor: '#2a6045',
  },
  {
    slug: 'pair-group',
    category: 'moments',
    title: {
      en: 'Pair & Group Portraits',
      ru: 'Парная и групповая съёмка',
      uz: 'Juft va guruh suratga olish',
    },
    tagline: {
      en: 'Everyone you love, one frame.',
      ru: 'Все, кто вам дорог, — в одном кадре.',
      uz: 'Siz uchun qadrli hamma — bitta kadrda.',
    },
    description: {
      en: 'Portrait sessions for couples, best friends, or a full friend group. Relaxed direction that captures real connection, not stiff lineup energy.',
      ru: 'Съёмка для пар, лучших друзей или целой компании. Спокойные подсказки, которые ловят настоящую связь между людьми, а не ровный строй на камеру.',
      uz: 'Juftliklar, yaqin do‘stlar yoki butun bir kompaniya uchun suratga olish. Kameraga tizilib turishni emas, odamlar orasidagi haqiqiy bog‘liqlikni ushlaydigan tinch maslahatlar.',
    },
    iconName: 'Users',
    coverPath: 'WIUT/5I9A3029.png',
    // "My best picks", in this order. EMPTY = the page picks for you.
    // Bunny storage paths, same shape as coverPath above.
    //   node --env-file=.env.local scripts/list-photos.mjs   lists them all.
    galleryPaths: [],
    includes: [
      {
        en: 'Location scouting or studio session',
        ru: 'Съёмка в студии или на выбранной локации',
        uz: 'Studiyada yoki tanlangan lokatsiyada suratga olish',
      },
      {
        en: 'Posing guidance for pairs and groups',
        ru: 'Работа с позами для пар и групп',
        uz: 'Juftlik va guruhlar uchun pozalar ustida ishlash',
      },
      {
        en: 'Individual and combined compositions',
        ru: 'Общие кадры и портреты каждого',
        uz: 'Umumiy kadrlar va har birining portreti',
      },
      {
        en: 'Retouched final selects',
        ru: 'Отретушированные отобранные кадры',
        uz: 'Tanlangan kadrlar retush bilan',
      },
    ],
    howToPrepare: [
      {
        en: 'Coordinate (not match) outfits across the group',
        ru: 'Согласуйте цвета (не одинаковые) на всю компанию',
        uz: 'Butun guruh bo‘yicha ranglarni kelishib oling (bir xil emas)',
      },
      {
        en: 'Let everyone know the rough timeline in advance',
        ru: 'Скажите всем примерный тайминг заранее',
        uz: 'Taxminiy taymingni hammaga oldindan ayting',
      },
      {
        en: 'A shared playlist or activity helps everyone relax on camera',
        ru: 'Общий плейлист или занятие помогают расслабиться перед камерой',
        uz: 'Umumiy pleylist yoki biror mashg‘ulot kamera oldida erkin bo‘lishga yordam beradi',
      },
    ],
    packages: standardTiers('pair-group'),
    faqs: [
      { question: {
        en: 'How many people can you shoot?',
        ru: 'Сколько человек можно снять?',
        uz: 'Necha kishini suratga olsa bo‘ladi?',
      }, answer: {
        en: 'Any size — couples, small friend groups, no strict limit.',
        ru: 'Любое количество — от пары до большой компании, жёсткого лимита нет.',
        uz: 'Istalgancha — juftlikdan katta kompaniyagacha, qat’iy chegara yo‘q.',
      } },
      { question: {
        en: 'Can my friend join for a few shots only?',
        ru: 'Можно, друг зайдёт только на пару кадров?',
        uz: 'Do‘stim bir-ikki kadrga qo‘shilsa bo‘ladimi?',
      }, answer: {
        en: 'Yes — friends can jump in for a few frames at no extra cost.',
        ru: 'Да — друзья могут заскочить на несколько кадров без доплаты.',
        uz: 'Ha — do‘stlar bir necha kadrga qo‘shimcha to‘lovsiz qo‘shilishlari mumkin.',
      } },
      { question: {
        en: 'Can we shoot in multiple locations?',
        ru: 'Можно снять в нескольких местах?',
        uz: 'Bir necha joyda suratga olsa bo‘ladimi?',
      }, answer: {
        en: 'Yes — 2–3 spots within Tashkent are typical for longer sessions.',
        ru: 'Да — для длинных съёмок обычно берём 2–3 точки по Ташкенту.',
        uz: 'Ha — uzoq suratga olishlarda odatda Toshkent bo‘ylab 2–3 ta nuqta olamiz.',
      } },
    ],
    accentColor: '#1500FF',
  },
  {
    slug: 'photowalk-tashkent',
    category: 'moments',
    title: {
      en: 'Photowalk in Tashkent',
      ru: 'Фотопрогулка по Ташкенту',
      uz: 'Toshkent bo‘ylab fotosayr',
    },
    tagline: {
      en: 'The city as your backdrop.',
      ru: 'Город вместо фона.',
      uz: 'Fon o‘rniga — shahar.',
    },
    description: {
      en: "A relaxed walk through Tashkent's most photogenic spots — Old City, Chorsu, Amir Timur Square, and more. Casual, spontaneous, and full of authentic city energy.",
      ru: 'Спокойная прогулка по самым фотогеничным местам Ташкента — Старый город, Чорсу, сквер Амира Темура и дальше по маршруту. Непринуждённо, спонтанно и с настоящей городской энергией.',
      uz: 'Toshkentning eng fotogenik joylari bo‘ylab tinch sayr — Eski shahar, Chorsu, Amir Temur xiyoboni va marshrut bo‘ylab yana. Erkin, spontan va haqiqiy shahar energiyasi bilan.',
    },
    iconName: 'MapPin',
    coverPath: 'Nature/streetlights.jpg',
    // "My best picks", in this order. EMPTY = the page picks for you.
    // Bunny storage paths, same shape as coverPath above.
    //   node --env-file=.env.local scripts/list-photos.mjs   lists them all.
    galleryPaths: [],
    galleryCategory: 'Nature',
    includes: [
      {
        en: 'Curated route through 3–5 Tashkent locations',
        ru: 'Продуманный маршрут по 3–5 точкам Ташкента',
        uz: 'Toshkent bo‘ylab 3–5 ta nuqtadan iborat o‘ylangan marshrut',
      },
      {
        en: 'Candid and portrait shots along the way',
        ru: 'Репортажные кадры и портреты по пути',
        uz: 'Yo‘l-yo‘lakay reportaj kadrlar va portretlar',
      },
      {
        en: 'Golden-hour timing when possible',
        ru: 'По возможности — съёмка на закате',
        uz: 'Imkon bo‘lsa — quyosh botishida suratga olish',
      },
      {
        en: 'On-the-spot editing preview',
        ru: 'Превью прямо на месте',
        uz: 'Joyning o‘zida oldindan ko‘rish',
      },
    ],
    howToPrepare: [
      {
        en: 'Wear comfortable shoes — we cover a lot of ground',
        ru: 'Удобная обувь — ходить придётся много',
        uz: 'Qulay poyabzal — ancha yurishga to‘g‘ri keladi',
      },
      {
        en: 'Bring a bag for personal items',
        ru: 'Возьмите сумку для личных вещей',
        uz: 'Shaxsiy buyumlar uchun sumka oling',
      },
      {
        en: "Dress for the weather; layers if it's an evening walk",
        ru: 'Одевайтесь по погоде; на вечернюю прогулку — слоями',
        uz: 'Ob-havoga qarab kiyining; kechki sayrga — qatlamlab',
      },
    ],
    packages: standardTiers('photowalk-tashkent'),
    faqs: [
      { question: {
        en: 'What time of day works best?',
        ru: 'В какое время лучше снимать?',
        uz: 'Qaysi vaqtda suratga olish yaxshiroq?',
      }, answer: {
        en: 'Golden hour (1–2 hours before sunset) is the most flattering light.',
        ru: 'Золотой час — за 1–2 часа до заката, самый выигрышный свет.',
        uz: 'Oltin soat — quyosh botishidan 1–2 soat oldin, eng yaxshi yorug‘lik.',
      } },
      { question: {
        en: 'Can I bring friends?',
        ru: 'Можно с друзьями?',
        uz: 'Do‘stlar bilan bo‘ladimi?',
      }, answer: {
        en: 'Yes — group photowalks are some of the most fun sessions.',
        ru: 'Да — групповые фотопрогулки получаются одними из самых весёлых съёмок.',
        uz: 'Ha — guruh bilan fotosayr eng qiziq suratga olishlardan biri bo‘ladi.',
      } },
      { question: {
        en: "What if it's cloudy?",
        ru: 'А если будет пасмурно?',
        uz: 'Bulutli bo‘lsa-chi?',
      }, answer: {
        en: 'Overcast light is actually very flattering. Only heavy rain would cause a reschedule.',
        ru: 'Пасмурный свет на самом деле очень мягкий и выигрышный. Переносим только из-за сильного дождя.',
        uz: 'Bulutli yorug‘lik aslida juda yumshoq va yaxshi chiqadi. Faqat kuchli yomg‘ir sababli ko‘chiramiz.',
      } },
    ],
    accentColor: '#1500FF',
  },
  {
    slug: 'newborn-maternity',
    category: 'moments',
    title: {
      en: 'New-born & Maternity',
      ru: 'Новорождённые и беременность',
      uz: 'Chaqaloq va homiladorlik',
    },
    tagline: {
      en: 'The smallest hands. The biggest feeling.',
      ru: 'Самые маленькие руки. Самое большое чувство.',
      uz: 'Eng kichkina qo‘llar. Eng katta tuyg‘u.',
    },
    description: {
      en: 'Gentle, warm sessions celebrating pregnancy and the first weeks of a new life. Shot with patience, softness, and an eye for the quiet moments that pass too fast.',
      ru: 'Бережные, тёплые съёмки про беременность и первые недели новой жизни. Спокойный темп, мягкий свет и внимание к тихим моментам, которые проходят слишком быстро.',
      uz: 'Homiladorlik va yangi hayotning dastlabki haftalari haqida ehtiyotkor, iliq suratga olish. Tinch sur’at, yumshoq yorug‘lik va juda tez o‘tib ketadigan jimgina lahzalarga e’tibor.',
    },
    iconName: 'Baby',
    coverPath: 'Portraits/Sara/3M0A1105.png',
    // "My best picks", in this order. EMPTY = the page picks for you.
    // Bunny storage paths, same shape as coverPath above.
    //   node --env-file=.env.local scripts/list-photos.mjs   lists them all.
    galleryPaths: [],
    includes: [
      {
        en: 'Newborn sessions scheduled within 5–14 days after birth',
        ru: 'Съёмка новорождённых — на 5–14 день после родов',
        uz: 'Chaqaloqlarni suratga olish — tug‘ruqdan keyin 5–14-kuni',
      },
      {
        en: 'Warm, safe environment — studio temperature controlled',
        ru: 'Тёплая, безопасная обстановка — температура в студии под контролем',
        uz: 'Iliq, xavfsiz muhit — studiyada harorat nazoratda',
      },
      {
        en: 'Parent and sibling poses included',
        ru: 'Кадры с родителями и старшими детьми',
        uz: 'Ota-ona va kattaroq bolalar bilan kadrlar',
      },
      {
        en: 'Soft, timeless editing style',
        ru: 'Мягкая, вневременная обработка',
        uz: 'Yumshoq, zamondan tashqari ishlov',
      },
    ],
    howToPrepare: [
      {
        en: 'For newborns: feed baby right before the session so they sleep',
        ru: 'С новорождёнными: покормите малыша прямо перед съёмкой, чтобы он спал',
        uz: 'Chaqaloqlar bilan: suratdan oldin ovqatlantiring, shunda uxlaydi',
      },
      {
        en: 'Bring a swaddle or blanket with sentimental value',
        ru: 'Возьмите пелёнку или плед, которые вам дороги',
        uz: 'O‘zingizga qadrli bo‘lgan yo‘rgak yoki adyol oling',
      },
      {
        en: 'For maternity: schedule in the 28–34 week window for best results',
        ru: 'Для беременности: лучшее окно — 28–34 неделя',
        uz: 'Homiladorlik uchun: eng yaxshi davr — 28–34-hafta',
      },
    ],
    packages: standardTiers('newborn-maternity'),
    faqs: [
      { question: {
        en: 'Is the studio safe for a newborn?',
        ru: 'В студии безопасно для новорождённого?',
        uz: 'Studiya chaqaloq uchun xavfsizmi?',
      }, answer: {
        en: 'Absolutely. I maintain a clean, temperature-controlled environment and have experience handling newborns.',
        ru: 'Да. Чисто, тепло, температура под контролем, и у меня есть опыт работы с новорождёнными.',
        uz: 'Ha. Toza, iliq, harorat nazoratda va menda chaqaloqlar bilan ishlash tajribasi bor.',
      } },
      { question: {
        en: 'Can we use props we bring?',
        ru: 'Можно со своим реквизитом?',
        uz: 'O‘z rekvizitimiz bilan bo‘ladimi?',
      }, answer: {
        en: 'Yes — personal items like a toy, blanket, or heirloom add beautiful meaning to the images.',
        ru: 'Да — своя игрушка, плед или семейная вещь добавляют кадрам настоящего смысла.',
        uz: 'Ha — o‘z o‘yinchog‘i, adyol yoki oilaviy buyum kadrlarga haqiqiy ma’no qo‘shadi.',
      } },
      { question: {
        en: 'When should we book?',
        ru: 'Когда бронировать?',
        uz: 'Qachon band qilish kerak?',
      }, answer: {
        en: 'Book during the second trimester so the spot is secured before the baby arrives.',
        ru: 'Во втором триместре — чтобы дата была занята до рождения малыша.',
        uz: 'Ikkinchi trimestrda — chaqaloq tug‘ilgunga qadar sana band bo‘lishi uchun.',
      } },
    ],
    accentColor: '#c8b400',
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
      en: "Solo, duo, or a full friend group — shot in-studio or as a relaxed photowalk through Tashkent's best backdrops instead of a fixed location. One flexible service built around however you want to show up on camera.",
      ru: 'Соло, вдвоём или целой компанией — в студии или на спокойной фотопрогулке по лучшим местам Ташкента вместо одной фиксированной локации. Одна гибкая съёмка, выстроенная под то, как вы хотите оказаться в кадре.',
      uz: 'Yakka, ikki kishi yoki butun bir kompaniya bilan — studiyada yoki bitta qat’iy lokatsiya o‘rniga Toshkentning eng yaxshi joylari bo‘ylab tinch fotosayrda. Kadrda qanday ko‘rinishni xohlasangiz, shunga moslangan bitta moslashuvchan suratga olish.',
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
  {
    slug: 'fashion-streetstyle',
    category: 'fashion',
    title: {
      en: 'Fashion & Street Style',
      ru: 'Fashion и street style',
      uz: 'Fashion va street style',
    },
    tagline: {
      en: 'Clothes that move. Photos that stop traffic.',
      ru: 'Одежда в движении. Кадры, на которых останавливаются.',
      uz: 'Harakatdagi kiyim. To‘xtatib qo‘yadigan kadrlar.',
    },
    description: {
      en: "Editorial and street-style shoots for brands, designers, boutiques, or individuals with something to say through what they wear. Shot on location in Tashkent's most visually interesting districts.",
      ru: 'Editorial и street-style съёмки для брендов, дизайнеров, бутиков и просто людей, которым есть что сказать через одежду. Снимаем на натуре, в самых интересных районах Ташкента.',
      uz: 'Brendlar, dizaynerlar, butiklar va kiyim orqali aytadigan gapi bor odamlar uchun editorial va street-style suratga olish. Toshkentning eng qiziq hududlarida, tabiiy muhitda olamiz.',
    },
    iconName: 'Shirt',
    coverPath: 'WIUT-Fashion-Show/3M0A2669.png',
    // "My best picks", in this order. EMPTY = the page picks for you.
    // Bunny storage paths, same shape as coverPath above.
    //   node --env-file=.env.local scripts/list-photos.mjs   lists them all.
    galleryPaths: [],
    galleryCategory: 'WIUT-Fashion-Show',
    includes: [
      {
        en: "Location scouting in Tashkent's key visual districts",
        ru: 'Подбор локаций в ключевых районах Ташкента',
        uz: 'Toshkentning asosiy hududlarida lokatsiya tanlash',
      },
      {
        en: 'Dynamic movement and action shots alongside static editorial',
        ru: 'Кадры в движении наравне со статичным editorial',
        uz: 'Statik editorial bilan birga harakatdagi kadrlar',
      },
      {
        en: 'Mix of tight and environmental frames',
        ru: 'И крупные планы, и кадры с окружением',
        uz: 'Ham yaqin plan, ham atrof bilan kadrlar',
      },
      {
        en: 'Colour grading matched to your brand aesthetic',
        ru: 'Цветокоррекция под эстетику вашего бренда',
        uz: 'Brendingiz estetikasiga moslangan rang korreksiyasi',
      },
    ],
    howToPrepare: [
      {
        en: 'Bring a rack — more options is always better on a fashion shoot',
        ru: 'Берите стойку с одеждой — на fashion-съёмке вариантов много не бывает',
        uz: 'Kiyim stendini oling — fashion suratda variant ko‘p bo‘lgani yaxshi',
      },
      {
        en: 'Think about the feeling the clothes should communicate',
        ru: 'Подумайте, что эта одежда должна передавать',
        uz: 'Bu kiyim nimani ifodalashi kerakligini o‘ylang',
      },
      {
        en: "If you're a brand, bring lookbook context (season, campaign direction)",
        ru: 'Если вы бренд — принесите контекст лукбука: сезон, направление кампании',
        uz: 'Agar brend bo‘lsangiz — lukbuk kontekstini oling: mavsum, kampaniya yo‘nalishi',
      },
    ],
    packages: standardTiers('fashion-streetstyle'),
    faqs: [
      { question: {
        en: 'Do you work with brands or just individuals?',
        ru: 'Снимаете только бренды или частных людей тоже?',
        uz: 'Faqat brendlarnimi yoki shaxslarni ham olasizmi?',
      }, answer: {
        en: 'Both — I have experience with brand lookbooks and personal style shoots.',
        ru: 'И тех и других — есть опыт и с лукбуками брендов, и с личной стилевой съёмкой.',
        uz: 'Ikkalasini ham — brend lukbuklari bilan ham, shaxsiy uslub suratlari bilan ham tajribam bor.',
      } },
      { question: {
        en: 'Can you match a specific editorial reference?',
        ru: 'Можете повторить конкретный editorial-референс?',
        uz: 'Aniq editorial referensni takrorlay olasizmi?',
      }, answer: {
        en: 'Yes. Share references beforehand and we will nail the aesthetic.',
        ru: 'Да. Пришлите референсы заранее — соберём эстетику точно.',
        uz: 'Ha. Referenslarni oldindan yuboring — estetikani aniq yig‘amiz.',
      } },
      { question: {
        en: 'Do you shoot video content too?',
        ru: 'Видео тоже снимаете?',
        uz: 'Video ham olasizmi?',
      }, answer: {
        en: 'Short-form video content can be added — ask when booking.',
        ru: 'Короткие вертикальные ролики можно добавить — скажите при брони.',
        uz: 'Qisqa vertikal roliklarni qo‘shsa bo‘ladi — band qilishda ayting.',
      } },
    ],
    accentColor: '#2a6045',
  },
  {
    slug: 'uzb-national',
    category: 'fashion',
    title: {
      en: 'Uzbek National Photography',
      ru: 'Национальная съёмка',
      uz: 'Milliy liboslarda suratga olish',
    },
    tagline: {
      en: 'Traditional dress. Contemporary vision.',
      ru: 'Традиционный костюм. Современный взгляд.',
      uz: 'An’anaviy libos. Zamonaviy qarash.',
    },
    description: {
      en: 'Portraits and editorial shoots celebrating Uzbek national dress and cultural identity — chapan, atlas, ikat, surkh-kiyim. Shot with pride, with an eye for detail that honours the craftsmanship.',
      ru: 'Портреты и editorial-съёмки про узбекский национальный костюм и культурную идентичность — чапан, атлас, икат, сурх-кийим. Снимаю с уважением и вниманием к деталям, в которых и живёт мастерство.',
      uz: 'O‘zbek milliy libosi va madaniy o‘zlik haqida portretlar va editorial suratlar — chopon, atlas, ikat, surx-kiyim. Hurmat bilan va hunarmandlik yashiringan tafsilotlarga e’tibor berib suratga olaman.',
    },
    iconName: 'Globe',
    coverPath: 'Nature/fountainalayskiy.jpg',
    // "My best picks", in this order. EMPTY = the page picks for you.
    // Bunny storage paths, same shape as coverPath above.
    //   node --env-file=.env.local scripts/list-photos.mjs   lists them all.
    galleryPaths: [],
    includes: [
      {
        en: 'Cultural context consultation — making sure the styling tells the right story',
        ru: 'Разговор о контексте — чтобы образ рассказывал правильную историю',
        uz: 'Kontekst haqida suhbat — obraz to‘g‘ri hikoyani aytishi uchun',
      },
      {
        en: 'Location options: Old City Tashkent, Chorsu, or studio',
        ru: 'Локации на выбор: Старый город, Чорсу или студия',
        uz: 'Lokatsiya tanlovi: Eski shahar, Chorsu yoki studiya',
      },
      {
        en: 'Detail shots of embroidery, jewellery, and fabric texture',
        ru: 'Детальные кадры вышивки, украшений и фактуры ткани',
        uz: 'Kashta, taqinchoq va mato fakturasining detal kadrlari',
      },
      {
        en: 'Both portrait and environmental compositions',
        ru: 'И портреты, и кадры с окружением',
        uz: 'Ham portretlar, ham atrof bilan kadrlar',
      },
    ],
    howToPrepare: [
      {
        en: 'Bring the outfit freshly pressed and lint-free',
        ru: 'Костюм — выглаженный и без катышков',
        uz: 'Libos — dazmollangan va tuksiz bo‘lsin',
      },
      {
        en: 'Jewellery and accessories make a huge difference — bring options',
        ru: 'Украшения и аксессуары решают многое — возьмите варианты',
        uz: 'Taqinchoq va aksessuarlar ko‘p narsani hal qiladi — variantlar oling',
      },
      {
        en: 'Share any occasion context (Navruz, wedding, family portrait)',
        ru: 'Скажите, если есть повод: Навруз, свадьба, семейный портрет',
        uz: 'Bahona bo‘lsa ayting: Navro‘z, to‘y, oilaviy portret',
      },
    ],
    packages: standardTiers('uzb-national'),
    faqs: [
      { question: {
        en: 'Can I bring multiple outfits?',
        ru: 'Можно взять несколько костюмов?',
        uz: 'Bir nechta libos olsam bo‘ladimi?',
      }, answer: {
        en: 'Yes — changing between looks is common and encouraged.',
        ru: 'Да — переодевания здесь обычное дело, и я только за.',
        uz: 'Ha — bu yerda kiyim almashtirish odatiy hol, men faqat tarafdorman.',
      } },
      { question: {
        en: 'Do you shoot in Old City Tashkent?',
        ru: 'Снимаете в Старом городе?',
        uz: 'Eski shaharda suratga olasizmi?',
      }, answer: {
        en: 'Yes — it is one of my favourite locations for this genre.',
        ru: 'Да — это одна из моих любимых локаций для такой съёмки.',
        uz: 'Ha — bu shunday suratlar uchun eng sevimli joylarimdan biri.',
      } },
      { question: {
        en: 'Can this be a group or family session?',
        ru: 'Можно семейную или групповую съёмку?',
        uz: 'Oilaviy yoki guruh suratga olish bo‘ladimi?',
      }, answer: {
        en: 'Absolutely. Multi-generational national dress portraits are beautiful.',
        ru: 'Конечно. Портреты в национальном костюме на несколько поколений получаются очень красивыми.',
        uz: 'Albatta. Bir necha avlod milliy libosda tushgan portretlar juda chiroyli chiqadi.',
      } },
    ],
    accentColor: '#c8b400',
  },
  {
    slug: 'creative-photography',
    category: 'fashion',
    title: {
      en: 'Creative Photography',
      ru: 'Креативная съёмка',
      uz: 'Kreativ suratga olish',
    },
    tagline: {
      en: 'No rules. Great photos.',
      ru: 'Без правил. С результатом.',
      uz: 'Qoidalarsiz. Natija bilan.',
    },
    description: {
      en: 'Conceptual, experimental, and artistic shoots for people who have an idea they want to realise. Double exposures, dramatic lighting, set builds, and surreal concepts — bring your vision and we will make it work.',
      ru: 'Концептуальные и экспериментальные съёмки для тех, у кого есть идея и желание её реализовать. Двойная экспозиция, драматичный свет, собранные декорации, сюрреализм — приносите замысел, а как его снять, придумаем.',
      uz: 'G‘oyasi va uni amalga oshirish istagi bor odamlar uchun konseptual va eksperimental suratga olish. Qo‘sh ekspozitsiya, dramatik yorug‘lik, yig‘ilgan dekoratsiyalar, syurrealizm — niyatni olib keling, uni qanday olishni birga o‘ylab topamiz.',
    },
    iconName: 'Wand2',
    coverPath: 'Nature/frozenbutnotreally.jpg',
    // "My best picks", in this order. EMPTY = the page picks for you.
    // Bunny storage paths, same shape as coverPath above.
    //   node --env-file=.env.local scripts/list-photos.mjs   lists them all.
    galleryPaths: [],
    includes: [
      {
        en: 'Full pre-shoot concept development session',
        ru: 'Полноценная проработка концепции до съёмки',
        uz: 'Suratdan oldin konsepsiyani to‘liq ishlab chiqish',
      },
      {
        en: 'Prop and set styling support',
        ru: 'Помощь с реквизитом и декорациями',
        uz: 'Rekvizit va dekoratsiyalar bilan yordam',
      },
      {
        en: 'Experimental lighting setups',
        ru: 'Экспериментальные схемы света',
        uz: 'Eksperimental yorug‘lik sxemalari',
      },
      {
        en: 'Post-production compositing and retouching (where needed)',
        ru: 'Композитинг и ретушь в постобработке, где это нужно',
        uz: 'Kerak bo‘lganda kompozitsiya va retush',
      },
    ],
    howToPrepare: [
      {
        en: 'Build a mood board — the more specific, the better',
        ru: 'Соберите мудборд — чем конкретнее, тем лучше',
        uz: 'Mudbord yig‘ing — qanchalik aniq bo‘lsa, shunchalik yaxshi',
      },
      {
        en: 'Think about colour palette, mood, and the feeling the image should leave',
        ru: 'Подумайте про палитру, настроение и ощущение, которое должен оставлять кадр',
        uz: 'Palitra, kayfiyat va kadr qoldiradigan taassurot haqida o‘ylang',
      },
      {
        en: 'Be ready to experiment — creative shoots evolve in the moment',
        ru: 'Будьте готовы экспериментировать — креатив рождается по ходу',
        uz: 'Eksperimentga tayyor bo‘ling — kreativ jarayonda tug‘iladi',
      },
    ],
    packages: standardTiers('creative-photography'),
    faqs: [
      { question: {
        en: "What if I don't know exactly what I want?",
        ru: 'А если я не знаю точно, чего хочу?',
        uz: 'Aniq nima xohlashimni bilmasam-chi?',
      }, answer: {
        en: 'That is fine — we can start with a mood and develop the concept together.',
        ru: 'Это нормально — начнём с настроения и соберём концепцию вместе.',
        uz: 'Bu normal — kayfiyatdan boshlaymiz va konsepsiyani birga yig‘amiz.',
      } },
      { question: {
        en: 'Can you source props?',
        ru: 'Реквизит найдёте?',
        uz: 'Rekvizit topasizmi?',
      }, answer: {
        en: 'Basic props are included. Specialised items may have an additional cost.',
        ru: 'Базовый реквизит входит. Что-то специфическое может стоить отдельно.',
        uz: 'Oddiy rekvizit kiradi. Maxsus narsalar alohida turishi mumkin.',
      } },
      { question: {
        en: 'How many edited images do I get?',
        ru: 'Сколько обработанных кадров я получу?',
        uz: 'Nechta ishlov berilgan kadr olaman?',
      }, answer: {
        en: 'Creative shoots produce fewer but more polished images — quality over quantity.',
        ru: 'В креативных съёмках кадров меньше, но они проработаннее — качество важнее количества.',
        uz: 'Kreativ suratlarda kadr kamroq, lekin ular puxtaroq — sifat miqdordan muhimroq.',
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