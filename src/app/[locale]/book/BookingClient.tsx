"use client";

// The booking form: package → date+time → location → details.
//
// The package is question one because it sets both the price and the duration,
// and the duration bounds the legal start times. Asking for the date first
// meant offering a 16:00 slot that stopped fitting the moment a 3h package was
// picked.
//
// House rules for anything added here:
//   • Every string comes from the dictionary. No English leaking into /ru.
//   • Locations and services are IDs, not display labels, so renaming one
//     doesn't orphan historical bookings.
//   • Completed steps collapse to a tappable summary rather than vanishing.
//   • Submit is gated on field validity, not truthiness — "@ab" is not an
//     email address.
//   • Colours come from the design tokens, never hardcoded.

import {
  Suspense, memo, useCallback, useEffect, useMemo, useRef, useState,
} from "react";
import { useSearchParams } from "next/navigation";
import {
  Check, ChevronDown, CircleAlert, Clock, MapPin, MessageCircle, Phone, Send,
  User, Users, X,
} from "lucide-react";

import StickyHeader from "@/src/components/common/StickyHeader";
import { useT } from "@/src/lib/i18n/LanguageProvider";
import {
  type AvailabilityConfig, type TakenDay, earliestBookableDate, fromISODate,
  toISODate, todayInTashkent,
} from "@/src/lib/availability";
import {
  type SessionPackage, formatSom, peopleError, pick,
  pickList,
} from "@/src/lib/packages";
import {
  findCatalogItem,
  type CatalogItem,
} from "@/src/lib/booking-catalog";
import {
  CEREMONY_DATE_ISO,
  CEREMONY_PLACEHOLDER_START,
  catalogForBooking,
  isCeremonyPackage,
  offeredServices,
  reservedDatesFor,
  type BookingServiceOption,
} from "@/src/lib/booking-services";
import { MINI_EVENT, isMiniPackage, miniSlotStates } from "@/src/lib/mini-sessions";
import { quoteBooking } from "@/src/lib/booking-price";
import {
  BOOKING_LOCATIONS, EXTRA_LOCATION_FEE_UZS, INCLUDED_LOCATIONS, MAX_LOCATIONS,
  getLocation, locationSurchargeUzs, needsConsult,
} from "@/src/lib/locations";
import { pickLocale } from "@/src/lib/services";
import {
  formatDelivery, formatPhotoCount, packageDuration,
} from "@/src/lib/service-format";
import { CalendarPicker, EventSlotPicker, StartTimePicker } from "./CalendarPicker";

// Types

type StepId = 1 | 2 | 3 | 4;

interface BookingState {
  /**
   * WHAT IS BEING SHOT — the first question now, and the one that shapes every
   * step below it. Previously the form opened on three durations, which is not
   * a product but a dimension of one, and which step 2 then asked about again.
   */
  serviceId: string | null;
  /**
   * The graduation page's audience switch, repeated here. Off, a client is
   * offered the campus tiers only; the ceremony is a WIUT event and there is
   * nothing to sell a non-WIUT graduate on that date.
   */
  isWiuterian: boolean;
  /**
   * Ceremony day rather than a campus session. Changes the PRICE LIST, not
   * only the date: the two are separate groups in services.ts at 500k/900k
   * against 250/400/700, and pinning a campus tier to 22 October would be
   * selling an hour on campus at the ceremony hall.
   */
  atCeremony: boolean;
  packageId: string | null;
  peopleCount: number | null;
  serviceSlug: string | null;
  selectedISO: string | null;
  month: number;
  year: number;
  startTime: string | null;
  /** Every place the session covers, in the order chosen. A list rather than
   *  one id because a graduation that starts on campus and finishes in a
   *  studio is one booking in two places; as a single id the second place
   *  ended up in the free-text box where nothing could price it. */
  locationIds: string[];
  locationCustom: string;
  name: string;
  telegram: string;
  phone: string;
  notes: string;
  consent: boolean;
}

const TELEGRAM_RE = /^@[a-zA-Z][a-zA-Z0-9_]{4,31}$/;

/** One shared empty array, so "nothing suggested" is a stable prop. */
const EMPTY_IDS: readonly string[] = [];

/**
 * How long a step takes to open or close, and the curve.
 *
 * One constant because three places animate on it — the step body, the
 * chevron, and the scroll that follows — and a step whose height finishes
 * before its chevron does reads as two things happening rather than one.
 * 260ms is the top of the range that still feels like a direct response to a
 * tap; the ease-out means it leaves immediately and settles, rather than
 * creeping away from the finger.
 */
const STEP_MS = 260;
const STEP_EASE = "cubic-bezier(0.22, 0.61, 0.36, 1)";

// Root

interface Props {
  packages: SessionPackage[];
  taken: TakenDay[];
  blackouts: string[];
  /** Start times already sold on the fixed-slot event day. */
  eventSlots: string[];
  availability: AvailabilityConfig;
}

export default function BookingClient(props: Props) {
  return (
    <Suspense fallback={<BookingSkeleton />}>
      <BookingInner {...props} />
    </Suspense>
  );
}

function BookingInner({ packages, taken, blackouts, eventSlots, availability }: Props) {
  const { t, locale } = useT();
  const searchParams = useSearchParams();

  // A "Book this" click from a service page lands here pre-filled.
  const slugParam = searchParams.get("service");
  const packageParam = searchParams.get("package");

  // An explicit `package` is the exact tier the client tapped and wins.
  //
  // The third arm used to be SERVICE_TO_PACKAGE[slug], which mapped a service
  // to one of the four generic database packages. That was how a page showing
  // 250 000 handed over a form quoting 800 000 — and, once every service grew
  // its own tiers, how the picker came to render three options with NONE
  // highlighted while the price bar quoted a fourth, invisible one. There is
  // nothing to fall back to now: a service whose tiers we cannot name leaves
  // the client on the generic ladder below, which is the same three prices its
  // page just showed them.
  const presetPackage = useMemo(
    () =>
      (packageParam && findCatalogItem(packageParam) ? packageParam : null) ??
      (packages.some((p) => p.id === packageParam) ? packageParam : null),
    [packageParam, packages],
  );

  const today = useMemo(() => todayInTashkent(), []);
  const todayISO = useMemo(() => toISODate(today), [today]);

  /**
   * The three things on offer, plus whatever service the client arrived from.
   *
   * A "Book this" button on any of the other fourteen service pages still
   * works — that service is appended rather than the form losing the tier the
   * client just tapped — while a visitor arriving cold sees three options
   * instead of sixteen. The mini-session option removes itself the day after
   * the event.
   */
  const options = useMemo(
    () => offeredServices(todayISO, slugParam),
    [todayISO, slugParam],
  );

  /**
   * Which one they are booking.
   *
   * A `?package=` link is the strongest signal — it names a tier, and the tier
   * knows its own service. Then `?service=`. Then nothing, and step 1 asks.
   */
  const presetService = useMemo(() => {
    const fromPackage = packageParam ? findCatalogItem(packageParam)?.serviceSlug : null;
    const candidate = fromPackage ?? slugParam;
    return candidate && options.some((o) => o.id === candidate) ? candidate : null;
  }, [packageParam, slugParam, options]);

  /**
   * The month the calendar opens on — the first one with a bookable day in it,
   * not necessarily this one.
   *
   * With leadTimeDays: 1, opening the form on the 31st put the client in front
   * of a grid where every cell was greyed out and the back arrow was disabled,
   * because the earliest bookable date was already in the next month. The page
   * looked broken and the only way forward was a chevron nobody had a reason
   * to press.
   */
  const firstOpenMonth = useMemo(
    () => earliestBookableDate(availability, today),
    [availability, today],
  );

  // A campus session is on campus; a ceremony is at the venue. The package
  // answered this already, so it's preselected rather than asked again —
  // still changeable.
  const presetLocation =
    (presetPackage ? findCatalogItem(presetPackage)?.locationIds[0] : null) ?? null;

  // A function initialiser, not an object literal. The literal was built on
  // every render and thrown away on all but the first — cheap in isolation,
  // but it also ran isCeremonyPackage() and the location lookup each time.
  const [state, setState] = useState<BookingState>(() => ({
    serviceId: presetService,
    // A ceremony link is by definition a WIUTerian one, so arriving on it with
    // the switch off would show a price list the toggle above says is hidden.
    isWiuterian: isCeremonyPackage(presetPackage),
    atCeremony: isCeremonyPackage(presetPackage),
    packageId: presetPackage,
    peopleCount: null,
    serviceSlug: slugParam,
    selectedISO: null,
    month: firstOpenMonth.getMonth(),
    year: firstOpenMonth.getFullYear(),
    startTime: null,
    locationIds: presetLocation ? [presetLocation] : [],
    locationCustom: "",
    name: "",
    telegram: "",
    phone: "",
    notes: "",
    consent: false,
  }));

  const [openStep, setOpenStep] = useState<StepId>(presetPackage ? 2 : 1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ ref: string; botLink: string | null } | null>(null);
  const [website, setWebsite] = useState(""); // honeypot

  /**
   * One field.
   *
   * `useCallback` with no dependencies, which it can be because the updater
   * form needs nothing from the render that created it. That matters: `set` is
   * the root of nearly every handler on this page, and while it was rebuilt
   * each render no amount of `React.memo` below could hold.
   *
   * The identity bail-out is not a micro-optimisation either. Several effects
   * here write a value that is usually already what they are writing —
   * `set("startTime", null)` fires on every package change — and spreading
   * into a fresh object made each of those a guaranteed extra render of the
   * whole form. Returning `prev` unchanged makes React drop the update.
   *
   * Arrays and objects (`locationIds`) compare by reference and so never hit
   * the bail-out, which is correct: a new array with the same contents is a
   * real change as far as this is concerned.
   */
  const set = useCallback(
    <K extends keyof BookingState>(k: K, v: BookingState[K]) =>
      setState((prev) => (Object.is(prev[k], v) ? prev : { ...prev, [k]: v })),
    [],
  );

  // What this service is, once chosen
  //
  // Three shapes of booking now share one form, and everything below reads
  // these rather than re-testing the service id:
  //
  //   normal     pick a day, pick an hour              portrait, campus grad
  //   ceremony   one known date, no hour yet           graduation on the day
  //   event      one known date, eight fixed blocks    mini-sessions at CCA

  const isEvent = state.serviceId === MINI_EVENT.id;
  const isGraduation = state.serviceId === "graduation";
  const isCeremony = isGraduation && state.isWiuterian && state.atCeremony;
  /**
   * The date was decided for the client rather than by them, so it is never
   * the thing to clear or the thing to ask them to change.
   */
  const dateIsFixed = isEvent || isCeremony;

  /** The tiers for step 1. Graduation forks on the ceremony switch. */
  const offered = useMemo(
    () => catalogForBooking(state.serviceId, { atCeremony: isCeremony }),
    [state.serviceId, isCeremony],
  );

  /**
   * Every date this booking may not land on.
   *
   * Merged into the blackout set the calendar and canBook() already take, so
   * "27 September belongs to the mini-sessions" needs no new concept — it is
   * the same mechanism as a day Marshall blacked out by hand. An event's own
   * date is not in its own list.
   */
  const closedDates = useMemo(
    () => [...blackouts, ...reservedDatesFor(state.serviceId)],
    [blackouts, state.serviceId],
  );

  /** Which of the event's eight blocks are still free, live ledger included. */
  const slotStates = useMemo(() => miniSlotStates(eventSlots), [eventSlots]);

  const pkg = useMemo(
    () => packages.find((p) => p.id === state.packageId) ?? null,
    [packages, state.packageId]
  );

  // The tier the client actually clicked on the service page, when there was
  // one. Wins over the generic four.
  const catalogItem = useMemo(
    () => (state.packageId ? findCatalogItem(state.packageId) ?? null : null),
    [state.packageId]
  );

  /**
   * Everything downstream reads this, not either source.
   *
   * The form renders a name, a duration, a photo count and a delivery promise
   * without caring whether they came from a service tier or a generic session
   * package. Normalising once here keeps every step below from growing its own
   * `catalogItem ? … : pkg ? … : …`.
   */
  const selected = useMemo(() => {
    if (catalogItem) {
      const durationLabel = packageDuration(catalogItem, locale);
      return {
        id: catalogItem.id,
        // pickLocale, not a bare interpolation: a Localized dropped into a
        // template literal type-checks perfectly and prints "[object Object]".
        name: `${pickLocale(catalogItem.serviceTitle, locale)} · ${durationLabel}`,
        durationLabel,
        durationMinutes: catalogItem.durationMinutes,
        photos: formatPhotoCount(catalogItem.photos, locale),
        delivery: formatDelivery(catalogItem.delivery, locale),
        perks: catalogItem.perks.map((x) => pickLocale(x, locale)),
        needsPeople: false,
      };
    }
    if (pkg) {
      return {
        id: pkg.id,
        name: pick(pkg.name, locale),
        durationLabel: pick(pkg.durationLabel, locale),
        durationMinutes: pkg.durationMinutes,
        photos: null as string | null,
        delivery: null as string | null,
        perks: pickList(pkg.includes, locale),
        needsPeople: pkg.maxPeople != null,
      };
    }
    return null;
  }, [catalogItem, pkg, locale]);

  /**
   * The places this tier happens in, as a stable array.
   *
   * `catalogItem?.locationIds ?? []` inline was a fresh `[]` on every render
   * whenever no tier was chosen, which is the whole of step 1 — enough on its
   * own to re-render the location picker on every keystroke four steps away.
   */
  const suggestedLocations = useMemo(
    () => catalogItem?.locationIds ?? EMPTY_IDS,
    [catalogItem],
  );

  // Handlers
  //
  // Every one of these is stable for the life of the page, and every one that
  // needs to read the current state does it through the updater argument
  // rather than closing over this render's copy. Both halves are required: a
  // handler that closes over `state` has to be rebuilt when state changes,
  // which is exactly when you need it not to be.

  const selectService = useCallback((id: string) => set("serviceId", id), [set]);

  const setWiuterian = useCallback((on: boolean) => {
    // One update, not two. As two `set` calls this was two renders of the
    // whole form for one tap, and briefly a state where isWiuterian was off
    // while atCeremony was still on — which catalogForBooking() reads.
    setState((prev) => ({
      ...prev,
      isWiuterian: on,
      atCeremony: on ? prev.atCeremony : false,
    }));
  }, []);

  const setAtCeremony = useCallback((on: boolean) => set("atCeremony", on), [set]);

  const setPeople = useCallback((count: number | null) => set("peopleCount", count), [set]);

  const selectTier = useCallback((item: CatalogItem) => {
    setState((prev) => {
      // The package implies where it happens, so switching from a campus tier
      // to a ceremony one moves the location with it.
      //
      // Only while the client hasn't chosen for themselves: a typed-in place,
      // or any pick that isn't simply the previous package's default, is an
      // answer and must not be overwritten.
      const previousDefault = prev.packageId
        ? findCatalogItem(prev.packageId)?.locationIds[0] ?? null
        : null;
      const untouched =
        prev.locationIds.length === 0 ||
        (prev.locationIds.length === 1 && prev.locationIds[0] === previousDefault);
      const moveLocation =
        item.locationIds.length > 0 && untouched && !prev.locationCustom.trim();

      return {
        ...prev,
        packageId: item.id,
        peopleCount: null,
        locationIds: moveLocation ? [item.locationIds[0]] : prev.locationIds,
      };
    });
  }, []);

  const selectDate = useCallback((iso: string) => {
    setError(null);
    // A new day invalidates the hour: 18:00 fits on a Thursday and not on a
    // Sunday. One update so the two never render apart.
    setState((prev) =>
      prev.selectedISO === iso && prev.startTime === null
        ? prev
        : { ...prev, selectedISO: iso, startTime: null },
    );
  }, []);

  /**
   * Choosing a time clears the error, because choosing a time is the answer to
   * every error that sends the client back here. Leaving it up would have them
   * dismissing a complaint they have already dealt with.
   */
  const setStartTime = useCallback(
    (time: string | null) => {
      set("startTime", time);
      if (time) setError(null);
    },
    [set],
  );

  const setMonth = useCallback((month: number, year: number) => {
    setState((prev) =>
      prev.month === month && prev.year === year ? prev : { ...prev, month, year },
    );
  }, []);

  const toggleLocation = useCallback((id: string) => {
    setState((prev) => {
      if (prev.locationIds.includes(id)) {
        return { ...prev, locationIds: prev.locationIds.filter((x) => x !== id) };
      }
      // Silently dropping the oldest would be worse than refusing: the client
      // would watch a tick move and not know why.
      if (prev.locationIds.length >= MAX_LOCATIONS) return prev;
      return { ...prev, locationIds: [...prev.locationIds, id] };
    });
  }, []);

  const setCustomLocation = useCallback((v: string) => set("locationCustom", v), [set]);

  // Four stable `() => setOpenStep(n)`. Inline arrows here were four new
  // functions per render, which is the whole reason the step headers could not
  // be left alone while someone typed.
  const dismissError = useCallback(() => setError(null), []);

  const openOne = useCallback(() => setOpenStep(1), []);
  const openTwo = useCallback(() => setOpenStep(2), []);
  const openThree = useCallback(() => setOpenStep(3), []);
  const openFour = useCallback(() => setOpenStep(4), []);

  // Display only. The server recomputes with the SAME function and wins.
  const quote = useMemo(
    () =>
      quoteBooking({
        packageId: state.packageId,
        sessionPackages: packages,
        peopleCount: state.peopleCount,
        locationIds: state.locationIds,
      }),
    [state.packageId, state.peopleCount, state.locationIds, packages]
  );

  /**
   * Per-step completion.
   *
   * A head count that CHANGES THE PRICE has to be answered; one that does not
   * is planning information and can be left alone. The difference is
   * `pricePerPeople`, and getting it wrong in either direction is visible:
   *
   *   both required    `grad-campus-group` asks 2–8 for one flat price, and
   *                    its own perk line says "one price however many of you
   *                    come". Demanding a number there is a step that asks
   *                    nothing.
   *   both optional    the mini-sessions complete step 1 the instant the
   *                    service is tapped — the single tier auto-selects — so
   *                    the step collapses before the client has seen the
   *                    170/250/330 choice, let alone made it. That is the bug
   *                    this distinction fixes.
   */
  const peopleOk = catalogItem
    ? !(catalogItem.asksPeople && catalogItem.pricePerPeople) || state.peopleCount !== null
    : pkg
      ? peopleError(pkg, state.peopleCount) === null
      : false;
  const step1Done = !!state.serviceId && !!selected && peopleOk;
  // A ceremony booking has a date and no hour — the university sets the hour,
  // and until Marshall knows which of the two slots the client is in there is
  // nothing honest to put on a button. Everything else still needs both.
  const step2Done = !!state.selectedISO && (isCeremony || !!state.startTime);
  const step3Done = !!(state.locationIds.length > 0 || state.locationCustom.trim());

  const telegramOk = state.telegram === "" || TELEGRAM_RE.test(state.telegram);
  const phoneDigits = state.phone.replace(/\D/g, "");
  const phoneOk = state.phone === "" || (phoneDigits.length >= 7 && phoneDigits.length <= 15);
  const hasContact = !!(state.telegram || state.phone);
  const step4Done = !!(
    state.name.trim().length >= 2 && hasContact && telegramOk && phoneOk && state.consent
  );

  const canSubmit = step1Done && step2Done && step3Done && step4Done;
  const doneCount = [step1Done, step2Done, step3Done, step4Done].filter(Boolean).length;

  /**
   * BRINGING THE OPEN STEP INTO VIEW, but only when it is actually needed.
   *
   * The naive version — scroll on every change of `openStep` — fights the user
   * in the common case. Collapsing step 1 pulls everything below it UP by its
   * own height, which is usually the whole movement required: step 2's header
   * arrives in the viewport on its own, carried there by the animation, and a
   * scroll on top of that is the page moving twice for one tap.
   *
   * So this measures instead, and only after the transition has settled —
   * scrolling mid-flight computes a target against a layout that is still
   * changing and lands somewhere arbitrary. If the open step's header is under
   * the sticky header, or has ended up in the bottom half of the screen, it
   * glides into place; otherwise nothing happens at all.
   *
   * It does NOT run on the first paint. A `?package=` link opens on step 2, and
   * yanking the viewport before the visitor has seen the page is the one thing
   * worse than not scrolling.
   */
  const stepEls = useRef(new Map<StepId, HTMLElement>());
  const registerStep = useMemo(() => {
    const cache = new Map<StepId, (el: HTMLElement | null) => void>();
    return (id: StepId) => {
      // One callback ref per step, created once. An inline arrow would be a
      // new ref callback every render, and React detaches and reattaches a ref
      // whose identity changed — so every keystroke would null and re-set all
      // four.
      let fn = cache.get(id);
      if (!fn) {
        fn = (el) => {
          if (el) stepEls.current.set(id, el);
          else stepEls.current.delete(id);
        };
        cache.set(id, fn);
      }
      return fn;
    };
  }, []);

  const settled = useRef(false);
  useEffect(() => {
    if (!settled.current) {
      settled.current = true;
      return;
    }
    const el = stepEls.current.get(openStep);
    if (!el) return;

    const reduce =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const check = () => {
      const { top } = el.getBoundingClientRect();
      // 76px clears the sticky header; past the halfway line it is far enough
      // down to be worth moving. Between the two, the step is already where
      // someone would want it and the best thing to do is nothing.
      const tooHigh = top < 76;
      const tooLow = top > window.innerHeight * 0.5;
      if (tooHigh || tooLow) {
        el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
      }
    };

    if (reduce) {
      check();
      return;
    }
    const timer = window.setTimeout(check, STEP_MS + 40);
    return () => window.clearTimeout(timer);
  }, [openStep]);

  // Advance as each step completes, but only forward — so reopening step 1 to
  // change your mind doesn't immediately slam shut again.
  //
  // DELIBERATELY THREE EFFECTS, each watching only its own step. Collapsing
  // them into one that watches all three looks tidier and is wrong: the single
  // effect re-runs whenever ANY of the three flips, so reopening step 1 to
  // change the tier — which clears the start time and makes step 2 incomplete
  // — would fire it and bounce the client forward to step 2 while they were
  // still looking at step 1. Watching one flag each is what makes "only
  // forward, and only when this step was the one that just completed" true.
  useEffect(() => { if (step1Done) setOpenStep((s) => (s === 1 ? 2 : s)); }, [step1Done]);
  useEffect(() => { if (step2Done) setOpenStep((s) => (s === 2 ? 3 : s)); }, [step2Done]);
  useEffect(() => { if (step3Done) setOpenStep((s) => (s === 3 ? 4 : s)); }, [step3Done]);

  // A new package means a new duration, which can invalidate the chosen start
  // time. Clear it rather than submitting a slot that no longer fits inside
  // the working day.
  //
  // `set` bails out when startTime is already null, which it usually is — so
  // this no longer costs a render on every tier tap.
  useEffect(() => { set("startTime", null); }, [state.packageId, set]);

  // Changing the answer to "what are we shooting?" invalidates every answer
  // below it — the tier, the date, and the place, which the old tier chose.
  // Leaving any of them would let a client submit a portrait date against a
  // mini-session package.
  //
  // The ref is not optional. React runs every effect after the first render
  // too, and without it a `?package=grad-ceremony-2h` link would arrive with
  // its tier chosen and have it wiped before the client saw it.
  const serviceSettled = useRef(false);
  useEffect(() => {
    if (!serviceSettled.current) {
      serviceSettled.current = true;
      return;
    }
    setState((prev) => ({
      ...prev,
      packageId: null,
      peopleCount: null,
      selectedISO: null,
      startTime: null,
      locationIds: [],
      locationCustom: "",
      atCeremony: prev.serviceId === "graduation" ? prev.atCeremony : false,
      isWiuterian: prev.serviceId === "graduation" ? prev.isWiuterian : false,
    }));
  }, [state.serviceId]);

  // A service with exactly one tier is not a choice. The mini-sessions have
  // one price; making a client tap it to continue is a step that asks nothing.
  useEffect(() => {
    if (offered.length === 1) set("packageId", offered[0].id);
  }, [offered, set]);

  /**
   * The event decides its own date and place — and KEEPS deciding it.
   *
   * `state.selectedISO` is in the dependency list on purpose. With only
   * `[isEvent]` this ran once, when the service was chosen, and never again —
   * so anything that cleared the date afterwards left it cleared for ever.
   * That is not hypothetical: the 409 handler below used to clear it on every
   * conflict, which made `step2Done` false, which disabled Submit, for a form
   * that was still SHOWING the date because FixedDate renders
   * MINI_EVENT.dateISO directly rather than the state. The client saw a
   * complete form with a dead button and no explanation.
   *
   * The guard makes the extra runs free: when the date and place are already
   * right it returns `prev` and React drops the update, so this costs one
   * comparison per render of the parent and nothing else.
   */
  useEffect(() => {
    if (!isEvent) return;
    setState((prev) =>
      prev.selectedISO === MINI_EVENT.dateISO &&
      prev.locationIds.length === 1 &&
      prev.locationIds[0] === MINI_EVENT.locationId &&
      prev.locationCustom === ""
        ? prev
        : {
            ...prev,
            selectedISO: MINI_EVENT.dateISO,
            locationIds: [MINI_EVENT.locationId],
            locationCustom: "",
          },
    );
  }, [isEvent, state.selectedISO, state.locationIds, state.locationCustom]);

  // Ceremony day is a date, not a choice. Pin it, move the calendar to the
  // month it is in so the client can see WHICH date they have been given, and
  // drop any hour picked before the switch went on. Turning the switch back
  // off releases the date rather than leaving 22 October sitting there looking
  // like the client's own choice.
  useEffect(() => {
    if (isCeremony) {
      const d = fromISODate(CEREMONY_DATE_ISO);
      setState((prev) => {
        const month = d ? d.getMonth() : prev.month;
        const year = d ? d.getFullYear() : prev.year;
        return prev.selectedISO === CEREMONY_DATE_ISO &&
          prev.startTime === null &&
          prev.month === month &&
          prev.year === year
          ? prev
          : { ...prev, selectedISO: CEREMONY_DATE_ISO, startTime: null, month, year };
      });
      return;
    }
    setState((prev) =>
      prev.selectedISO === CEREMONY_DATE_ISO
        ? { ...prev, selectedISO: null, startTime: null }
        : prev,
    );
  }, [isCeremony]);

  const handleSubmit = async () => {
    if (!canSubmit || !selected || !quote) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/booking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          packageId: selected.id,
          peopleCount: state.peopleCount,
          serviceSlug: state.serviceId ?? state.serviceSlug,
          isoDate: state.selectedISO,
          // A ceremony booking has no hour yet. The column is NOT NULL and a
          // whole nullable-time model is more change than "for now" is worth,
          // so the row records the ceremony's own published start and the
          // route prints "time to be confirmed" instead of a range wherever
          // Marshall reads it. Anything reading start_time on these rows must
          // treat it as a placeholder, not a promise.
          startTime: state.startTime ?? (isCeremony ? CEREMONY_PLACEHOLDER_START : null),
          locationIds: state.locationIds,
          // Keeps the existing bookings row shape: first place is the primary
          // one, the rest travel in locationIds and the route records them as
          // addons.
          locationId: state.locationIds[0] ?? null,
          locationCustom: state.locationCustom.trim() || null,
          name: state.name.trim(),
          telegram: state.telegram || null,
          phone: state.phone || null,
          notes: state.notes.trim() || null,
          locale,
          consent: state.consent,
          quotedPriceUzs: quote.totalUzs,
          website,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (res.status === 409) {
        if (data?.error === "priceChanged") {
          setError(t("book.priceChanged").replace("{price}", data.priceLabel ?? ""));
          return;
        }

        /**
         * Somebody got there first between page load and submit.
         *
         * WHICH THING WAS TAKEN DECIDES WHAT TO CLEAR, and getting that wrong
         * is how Submit ended up permanently dead. A mini-session conflict is
         * about the HOUR: the date is the event's, the client never chose it
         * and cannot change it. Clearing it anyway left `selectedISO` null on
         * a form that still displayed the date, so `step2Done` was false for
         * reasons nothing on screen could explain.
         */
        const slotTaken = data?.error === "slotTaken" || dateIsFixed;

        setState((prev) => ({
          ...prev,
          startTime: null,
          selectedISO: slotTaken ? prev.selectedISO : null,
        }));
        setOpenStep(2);
        setError(t(slotTaken ? "book.slotTaken" : "book.dayTaken"));
        return;
      }
      if (!res.ok) {
        // The client gets one calm sentence, which is right. But the reason
        // belonged nowhere at all — a 400 "bad package", a 429 rate limit and
        // a 503 failed insert were indistinguishable from the browser, so the
        // only way to tell them apart was reading the Vercel logs. Now the
        // console says which it was, and scripts/probe-booking.mjs asks the
        // same question from the terminal.
        console.error(
          `[booking] POST /api/booking -> ${res.status}`,
          data?.error ?? "(no error code)",
          data?.message ?? "",
        );
        throw new Error(data?.error ?? "failed");
      }

      setDone({ ref: data.reference, botLink: data.botLink ?? null });
    } catch {
      setError(t("book.error"));
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <Confirmation
        reference={done.ref}
        botLink={done.botLink}
        state={state}
        packageName={selected?.name ?? ""}
        durationLabel={selected?.durationLabel ?? ""}
        totalUzs={quote?.totalUzs ?? 0}
        onReset={() => {
          setDone(null);
          setOpenStep(1);
          serviceSettled.current = false;
          setState({
            serviceId: null, isWiuterian: false, atCeremony: false,
            packageId: null, peopleCount: null, serviceSlug: null,
            selectedISO: null, month: firstOpenMonth.getMonth(), year: firstOpenMonth.getFullYear(),
            startTime: null, locationIds: [], locationCustom: "",
            name: "", telegram: "", phone: "", notes: "", consent: false,
          });
        }}
      />
    );
  }

  return (
    <div className="min-h-screen bg-background text-white overflow-x-clip">
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-80 pointer-events-none z-0"
        style={{
          background:
            "linear-gradient(to bottom, rgba(80,100,119,0.26) 0%, rgba(80,100,119,0.08) 45%, rgba(17,19,21,0) 100%)",
        }}
      />

      <StickyHeader title={t("book.title")} accent="#111315" fadeOver={200} backHref={`/${locale}`} />

      <div
        className="relative z-10 max-w-2xl mx-auto px-4 sm:px-6 pb-48"
        style={{ paddingTop: "calc(5rem + env(safe-area-inset-top))" }}
      >
        <div className="mb-8">
          <p className="text-xs font-semibold uppercase tracking-widest text-white/50 mb-2">
            {t("book.eyebrow")}
          </p>
          {/* Same treatment as every other page title — portfolio, the service
              pages, the albums. This was the ONLY `font-serif` on the site
              (Instrument Serif for Latin, Playfair for Cyrillic), so the one
              page a visitor arrives at to spend money was set in a face they
              had not seen anywhere else on the way there.

              text-5xl, not the portfolio's 6xl at sm: "Забронировать" is one
              13-character word and at 60px it is wider than a phone. Measured
              in ru and uz at 288/328/358px before choosing. */}
          <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tighter leading-[0.95]">
            {t("book.title")}
          </h1>
          <p className="text-sm text-white/55 mt-3">{t("book.subtitle")}</p>
        </div>

        {/* Deliberately NOT CONTACT.telegram. That handle is the public
            account on the About page; booking enquiries go to the personal
            one, so this is hardcoded and must stay that way. */}
        <a
          href={"https://t.me/marshallthethird"}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 w-full mb-8 rounded-full min-h-12 bg-white/[0.07] hover:bg-white/12 active:bg-white/16 text-sm font-semibold text-white/75 hover:text-white transition active:scale-[0.99]"
        >
          <MessageCircle className="w-4 h-4" />
          {t("book.telegramFallback")}
        </a>

        <div className="flex flex-col gap-3">
          {/* 1 ─ What */}
          <Step
            n={1}
            label={t("book.stepPackage")}
            done={step1Done}
            open={openStep === 1}
            onToggle={openOne}
            sectionRef={registerStep(1)}
            summary={selected ? `${selected.name} · ${formatSom(quote?.totalUzs ?? 0, locale)}` : ""}
          >
            <div className="flex flex-col gap-4">
              <ServicePicker
                options={options}
                selectedId={state.serviceId}
                onSelect={selectService}
              />

              {/* The graduation page's own switch, in the same position
                  relative to the thing it changes: directly under the options,
                  above the prices it decides. Off, the ceremony is not on
                  offer at all — it is a WIUT event at a WIUT venue and there is
                  nothing to sell a graduate of anywhere else on that date. */}
              {isGraduation && (
                <Switch
                  label={t("book.wiuterian")}
                  hint={t("book.wiuterianHint")}
                  on={state.isWiuterian}
                  onChange={setWiuterian}
                />
              )}

              {/* One tier is not a choice — the event has a single price, and
                  it is already selected. Show what it includes instead of a
                  list of one. */}
              {state.serviceId && offered.length === 1 && selected ? (
                <SingleTier
                  item={offered[0]}
                  peopleCount={state.peopleCount}
                  onPeople={setPeople}
                />
              ) : state.serviceId ? (
              <CatalogPicker
                items={offered}
                selectedId={state.packageId}
                peopleCount={state.peopleCount}
                onPeople={setPeople}
                onSelect={selectTier}
              />
              ) : null}
            </div>
          </Step>

          {/* 2 ─ When */}
          <Step
            n={2}
            label={t("book.stepWhen")}
            done={step2Done}
            open={openStep === 2}
            onToggle={openTwo}
            sectionRef={registerStep(2)}
            locked={!step1Done}
            summary={
              state.selectedISO
                ? `${formatISO(state.selectedISO, locale)}${
                    state.startTime ? ` · ${state.startTime}` : isCeremony ? ` · ${t("book.timeTbc")}` : ""
                  }`
                : ""
            }
          >
            <div className="flex flex-col gap-5">
              {/* The event owns its date, so there is no grid to show — just
                  the day, stated, and the blocks that are left. */}
              {isEvent ? (
                <>
                  <FixedDate
                    iso={MINI_EVENT.dateISO}
                    label={t("book.eventDateLabel")}
                    locale={locale}
                  />
                  <div>
                    <p className="text-[11px] text-white/40 mb-3 font-medium">
                      {t("book.startTime")}
                      {selected && (
                        <span className="text-white/25"> · {selected.durationLabel}</span>
                      )}
                    </p>
                    <EventSlotPicker
                      slots={slotStates}
                      startTime={state.startTime}
                      onChange={setStartTime}
                    />
                  </div>
                </>
              ) : (
                <>
                  {/* Above the calendar, because it decides what the calendar
                      is for. Only a WIUTerian sees it. */}
                  {isGraduation && state.isWiuterian && (
                    <Switch
                      label={t("book.atCeremony")}
                      hint={t("book.atCeremonyHint")}
                      on={state.atCeremony}
                      onChange={setAtCeremony}
                    />
                  )}

                  <CalendarPicker
                    selectedISO={state.selectedISO}
                    viewMonth={state.month}
                    viewYear={state.year}
                    onSelect={selectDate}
                    onViewChange={setMonth}
                    availability={availability}
                    taken={taken}
                    blackouts={closedDates}
                    locked={isCeremony}
                  />

                  {isCeremony ? (
                    // No hour, on purpose. The university publishes two blocks
                    // on the day and the client usually does not yet know which
                    // one they are in, so offering a grid of start times would
                    // be asking for a guess and then recording it as a fact.
                    <p className="rounded-xl bg-white/5 border border-white/10 px-4 py-3 text-xs leading-relaxed text-white/55">
                      {t("book.ceremonyTimeNote")}
                    </p>
                  ) : (
                    <div>
                      <p className="text-[11px] text-white/40 mb-3 font-medium">
                        {t("book.startTime")}
                        {selected && (
                          <span className="text-white/25"> · {selected.durationLabel}</span>
                        )}
                      </p>
                      <StartTimePicker
                        selectedISO={state.selectedISO}
                        durationMinutes={selected?.durationMinutes ?? 120}
                        startTime={state.startTime}
                        onChange={setStartTime}
                        availability={availability}
                      />
                    </div>
                  )}
                </>
              )}
            </div>
          </Step>

          {/* 3 ─ Where */}
          <Step
            n={3}
            label={t("book.stepWhere")}
            done={step3Done}
            open={openStep === 3}
            onToggle={openThree}
            sectionRef={registerStep(3)}
            locked={!step2Done}
            summary={describeLocations(state.locationIds, state.locationCustom, t)}
          >
            {isEvent ? (
              // One venue, already set. A picker here would be a question with
              // one answer that the client cannot change.
              <div className="rounded-xl bg-white/6 px-4 py-4">
                <p className="text-sm font-semibold">{t(`book.loc.${MINI_EVENT.locationId}.label`)}</p>
                <p className="text-xs text-white/40 mt-0.5">
                  {t(`book.loc.${MINI_EVENT.locationId}.sub`)}
                </p>
              </div>
            ) : (
            <LocationPicker
              locationIds={state.locationIds}
              suggested={suggestedLocations}
              custom={state.locationCustom}
              durationMinutes={selected?.durationMinutes ?? 120}
              onToggle={toggleLocation}
              onCustom={setCustomLocation}
            />
            )}
          </Step>

          {/* 4 ─ Who */}
          <Step
            n={4}
            label={t("book.stepWho")}
            done={step4Done}
            open={openStep === 4}
            onToggle={openFour}
            sectionRef={registerStep(4)}
            locked={!step3Done}
            summary={state.name.trim()}
          >
            <div className="flex flex-col gap-3">
              {/* Honeypot: off-screen, out of the tab order, hidden from screen
                  readers. A human never touches it. */}
              <input
                type="text" name="website" value={website}
                onChange={(e) => setWebsite(e.target.value)}
                tabIndex={-1} autoComplete="off" aria-hidden="true"
                className="absolute left-[-9999px] h-0 w-0 opacity-0"
              />

              <Field icon={<User className="w-4 h-4" />} label={t("book.yourName")}>
                <input
                  value={state.name}
                  onChange={(e) => set("name", e.target.value)}
                  placeholder={t("book.namePlaceholder")}
                  autoComplete="name"
                  className="w-full bg-transparent text-sm text-white placeholder:text-white/20 outline-none"
                />
              </Field>

              <Field
                icon={<Send className="w-4 h-4" />}
                label="Telegram"
                hint={t("book.telegramHint")}
                invalid={state.telegram.length > 1 && !telegramOk}
                valid={state.telegram.length > 1 && telegramOk}
              >
                <input
                  value={state.telegram}
                  onChange={(e) => set("telegram", normaliseTelegram(e.target.value))}
                  placeholder="@username"
                  autoComplete="off"
                  className="w-full bg-transparent text-sm text-white placeholder:text-white/20 outline-none"
                />
              </Field>

              <Field
                icon={<Phone className="w-4 h-4" />}
                label={t("book.phone")}
                invalid={phoneDigits.length > 0 && !phoneOk}
                valid={phoneDigits.length > 0 && phoneOk}
              >
                <input
                  value={state.phone}
                  onChange={(e) => set("phone", normalisePhone(e.target.value))}
                  onFocus={() => { if (!state.phone) set("phone", "+998"); }}
                  onBlur={() => { if (state.phone === "+" || state.phone === "+998") set("phone", ""); }}
                  placeholder="+998 __ ___ __ __"
                  inputMode="tel"
                  autoComplete="tel"
                  className="w-full bg-transparent text-sm text-white placeholder:text-white/20 outline-none tracking-wide"
                />
              </Field>

              <Field icon={<MessageCircle className="w-4 h-4" />} label={t("book.notesLabel")}>
                <textarea
                  value={state.notes}
                  onChange={(e) => set("notes", e.target.value.slice(0, 600))}
                  placeholder={t("book.notesPlaceholder")}
                  rows={3}
                  className="w-full bg-transparent text-sm text-white placeholder:text-white/20 outline-none resize-none"
                />
              </Field>

              <label className="flex items-start gap-3 px-1 py-2 cursor-pointer group">
                <span
                  className={`mt-0.5 w-5 h-5 rounded-md border shrink-0 flex items-center justify-center transition
                    ${state.consent
                      ? "bg-accent-warm border-accent-warm"
                      : "border-white/25 group-hover:border-white/40"}`}
                >
                  {state.consent && <Check className="w-3 h-3 text-accent-ink" />}
                </span>
                <input
                  type="checkbox"
                  checked={state.consent}
                  onChange={(e) => set("consent", e.target.checked)}
                  className="sr-only"
                />
                <span className="text-xs text-white/50 leading-relaxed">{t("book.consent")}</span>
              </label>

              {/* Summary sits at the decision point, not above the form.
                  It now repeats what the package PROMISED — photo count,
                  delivery, printed photos — because that is what the client
                  read before clicking, and a confirmation screen that shows
                  only a price asks them to take the rest on trust. */}
              {selected && quote && (
                <div className="mt-2 bg-white/5 border border-white/10 rounded-2xl p-4 flex flex-col gap-3">
                  <p className="text-[10px] text-white/35 font-semibold uppercase tracking-widest">
                    {t("book.summary")}
                  </p>
                  <SummaryRow label={t("book.session")}  value={selected.name} />
                  <SummaryRow label={t("book.date")}     value={formatISO(state.selectedISO, locale)} />
                  <SummaryRow
                    label={t("book.time")}
                    value={state.startTime ? `${state.startTime} · ${selected.durationLabel}` : "—"}
                  />
                  <SummaryRow
                    label={t("book.location")}
                    value={describeLocations(state.locationIds, state.locationCustom, t) || "—"}
                  />
                  {/* Only when the number is part of the price. A head count
                      that buys nothing is planning information and belongs in
                      the step that asks for it, not on the bill. */}
                  {quote.pricedForPeople !== null && (
                    <SummaryRow
                      label={t("book.peopleCount")}
                      value={String(quote.pricedForPeople)}
                    />
                  )}

                  {(selected.photos || selected.delivery || selected.perks.length > 0) && (
                    <ul className="flex flex-col gap-1.5 pt-1">
                      {[selected.photos, selected.delivery, ...selected.perks]
                        .filter((line): line is string => !!line)
                        .map((line) => (
                          <li key={line} className="flex items-start gap-2 text-[11px] text-white/45">
                            <Check className="mt-0.5 h-3 w-3 shrink-0 text-white/25" />
                            {line}
                          </li>
                        ))}
                    </ul>
                  )}

                  {quote.extraPeople > 0 && (
                    <SummaryRow
                      label={t("book.extraPeople")}
                      value={`+${quote.extraPeople} · ${formatSom(quote.extraPeopleUzs, locale)}`}
                    />
                  )}

                  {/* An add-on has to be visible on the line where the total is
                      made, not only in the section where it was chosen. */}
                  {(quote.locationSurchargeUzs > 0 || quote.extraLocationUzs > 0) && (
                    <>
                      {/* Not t("book.session") — that label is already on the
                          row above carrying the package NAME, and two rows
                          reading "Session" with different values is a summary
                          arguing with itself. */}
                      <SummaryRow
                        label={t("book.basePrice")}
                        value={formatSom(quote.basePriceUzs, locale)}
                      />
                      {quote.locationSurchargeUzs > 0 && (
                        <SummaryRow
                          label={t("book.studioHire")}
                          value={`+ ${formatSom(quote.locationSurchargeUzs, locale)}`}
                        />
                      )}
                      {quote.extraLocationUzs > 0 && (
                        <SummaryRow
                          label={t("book.extraLocations").replace(
                            "{n}",
                            String(quote.extraLocationCount),
                          )}
                          value={`+ ${formatSom(quote.extraLocationUzs, locale)}`}
                        />
                      )}
                    </>
                  )}

                  <div className="pt-3 border-t border-white/10 flex justify-between items-center">
                    <span className="text-xs text-white/40">{t("book.total")}</span>
                    <span className="text-lg font-bold">{formatSom(quote.totalUzs, locale)}</span>
                  </div>
                </div>
              )}

              <button
                onClick={handleSubmit}
                disabled={!canSubmit || submitting}
                className={`mt-2 w-full rounded-full min-h-13 py-4 text-sm font-bold transition active:scale-[0.98]
                  ${canSubmit && !submitting
                    ? "bg-accent-warm hover:bg-(--sc-accent-hover) text-accent-ink"
                    : "bg-white/6 text-white/25 cursor-not-allowed"}`}
              >
                {submitting ? t("book.sending") : t("book.confirm")}
              </button>
            </div>
          </Step>
        </div>
      </div>

      {/* One fixed stack, so the error and the progress bar cannot disagree
          about width, gutter or how far they sit above the bottom nav. */}
      <BottomStack>
        <ErrorBanner message={error} onDismiss={dismissError} />
        {doneCount > 0 && openStep !== 4 && (
          <StatusBar
            doneCount={doneCount}
            total={4}
            priceLabel={quote ? formatSom(quote.totalUzs, locale) : t("book.pickPackageForPrice")}
            canSubmit={canSubmit}
            submitting={submitting}
            onSubmit={openFour}
          />
        )}
      </BottomStack>
    </div>
  );
}

/** "WIUT campus + Studio", or the typed-in text when nothing was picked. */
function describeLocations(
  ids: string[],
  custom: string,
  t: (key: string) => string,
): string {
  const picked = ids.map((id) => t(`book.loc.${id}.label`));
  const all = custom.trim() ? [...picked, custom.trim()] : picked;
  return all.join(" + ");
}

// Step shell. Completed steps collapse to a tappable one-liner rather than
// disappearing, which is how an earlier answer gets reviewed or changed.

/**
 * WHY THE BODY IS NEVER UNMOUNTED.
 *
 * This was `{open && <div>{children}</div>}`, which has two costs that both
 * read as the form being jerky rather than slow.
 *
 * The obvious one: there is nothing to animate. A step appeared and
 * disappeared between two frames, and because collapsing step 1 while
 * expanding step 2 moves everything below it, the whole page jumped by a few
 * hundred pixels with no motion to explain where anything went.
 *
 * The second one is worse and less obvious: every reopen was a REMOUNT. Going
 * back to step 2 to change the date rebuilt the calendar from scratch — 42
 * cells, the taken map, the month arithmetic — and going back to step 3 threw
 * away the "show other locations" toggle, so a client who had expanded the
 * full list found it collapsed again for no reason they could see.
 *
 * Kept mounted and collapsed, both go away. The cost is that four steps' worth
 * of content is in the DOM at once, which is why everything expensive below is
 * wrapped in `memo` — a closed step's content renders once and then never
 * again until its own props change.
 *
 * `grid-template-rows: 0fr -> 1fr` is the transition. It is the only way to
 * animate to an INTRINSIC height in CSS alone, without measuring in JS and
 * without a hardcoded max-height that clips the Russian copy (which is longer
 * than the English everywhere). A browser too old to interpolate it still
 * collapses and expands correctly, just instantly — the behaviour this
 * replaced, so there is nothing to lose.
 *
 * `inert` is not optional with this approach. A collapsed step's inputs are
 * still in the DOM, and without it the client tabbing out of the name field
 * would land somewhere invisible — and a screen reader would read all four
 * steps as one flat form.
 */
function Step({
  n, label, done, open, locked, summary, onToggle, children, sectionRef,
}: {
  n: number;
  label: string;
  done: boolean;
  open: boolean;
  locked?: boolean;
  summary?: string;
  onToggle: () => void;
  children: React.ReactNode;
  sectionRef?: (el: HTMLElement | null) => void;
}) {
  const disabled = locked && !done;

  return (
    <section
      ref={sectionRef}
      // So a scroll to this step clears the sticky header instead of putting
      // the step's own title underneath it.
      style={{ scrollMarginTop: "calc(4.75rem + env(safe-area-inset-top))" }}
      className={`rounded-2xl border transition-[border-color,background-color,opacity] duration-200
        ${open ? "border-white/15 bg-white/3" : "border-white/8 bg-transparent"}
        ${disabled ? "opacity-40" : ""}`}
    >
      <button
        onClick={() => !disabled && onToggle()}
        disabled={disabled}
        aria-expanded={open}
        className="w-full flex items-center gap-3 px-4 py-4 text-left min-h-14"
      >
        <span
          className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 transition
            ${done ? "bg-accent-warm text-accent-ink" : "bg-white/10 text-white/50"}`}
        >
          {done ? <Check className="w-3.5 h-3.5" /> : n}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">{label}</span>
          {/* Faded rather than removed. As `{!open && summary}` the summary
              line vanished the instant the step opened, so the header lost a
              row of height in the same frame the body gained several hundred
              pixels — a second, competing jump inside the one the body was
              already making. */}
          <span
            className="block text-xs text-white/45 truncate transition-[max-height,opacity,margin-top] overflow-hidden"
            style={{
              maxHeight: !open && summary ? "1.25rem" : "0rem",
              marginTop: !open && summary ? "0.125rem" : "0rem",
              opacity: !open && summary ? 1 : 0,
              transitionDuration: `${STEP_MS}ms`,
              transitionTimingFunction: STEP_EASE,
            }}
          >
            {summary}
          </span>
        </span>
        <ChevronDown
          aria-hidden
          className="w-4 h-4 text-white/30 shrink-0 transition-transform"
          style={{
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
            opacity: disabled ? 0 : 1,
            transitionDuration: `${STEP_MS}ms`,
            transitionTimingFunction: STEP_EASE,
          }}
        />
      </button>

      <div
        className="grid"
        style={{
          gridTemplateRows: open ? "1fr" : "0fr",
          transition: `grid-template-rows ${STEP_MS}ms ${STEP_EASE}`,
        }}
      >
        <div
          // overflow-hidden is what makes 0fr actually mean zero: it zeroes the
          // grid item's automatic minimum size, which would otherwise hold the
          // track open at the content's height.
          className="overflow-hidden"
          inert={!open}
          style={{
            opacity: open ? 1 : 0,
            // Fades out faster than it collapses and in slower than it
            // expands, so the body is invisible before it has finished folding
            // away and the text does not arrive before it has room.
            transition: `opacity ${open ? STEP_MS : STEP_MS / 2}ms ${STEP_EASE}`,
          }}
        >
          <div className="px-4 pb-5">{children}</div>
        </div>
      </div>
    </section>
  );
}

// Package picker

/*
 * PackagePicker and countOptions lived here.
 *
 * They rendered the four generic `packages` rows with a head-count stepper.
 * Nothing reaches them any more: every path through step 1 shows the catalogue
 * now, because after the site moved to one price ladder those four rows were
 * the only place a visitor could be quoted a price that appears nowhere else.
 * The four packages are still PRICEABLE by id so old links keep working — see
 * booking-catalog.ts — they are simply never offered.
 */

/**
 * Question one: what are we shooting?
 *
 * Two or four options, not sixteen. A photographer's list of services is a
 * marketing surface; a booking form's first question is "which of the things
 * you actually do do I want", and the answer set is small on purpose.
 */
/*
 * WRAPPED IN memo FROM HERE DOWN, and it is the single biggest thing on this
 * page.
 *
 * All four steps' content is now mounted at once (see Step above), and the
 * form keeps its answers in one state object — so typing one character into
 * the name field in step 4 re-rendered the service picker, the tier list, the
 * calendar's 42 cells, the time grid and the location list. None of their
 * props had changed. On a mid-range Android that is the difference between a
 * field that keeps up with your thumb and one that doesn't.
 *
 * memo only works if the props hold still, which is why every handler above is
 * a `useCallback` with no dependencies and every derived list is a `useMemo`.
 * Either half alone buys nothing: a memo whose props are rebuilt each render
 * is a wasted comparison, and stable props with no memo are stable props that
 * nothing reads.
 */
const ServicePicker = memo(function ServicePicker({ options, selectedId, onSelect }: {
  options: BookingServiceOption[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const { locale } = useT();
  return (
    <div className="flex flex-col gap-2">
      {options.map((o) => {
        const active = o.id === selectedId;
        return (
          <button
            key={o.id}
            onClick={() => onSelect(o.id)}
            aria-pressed={active}
            className={`text-left rounded-2xl px-4 py-4 border transition active:scale-[0.99]
              ${active
                ? "border-accent-warm bg-accent-warm/10"
                : "border-white/10 bg-white/4 hover:bg-white/[0.07]"}`}
          >
            <p className="font-semibold text-base">{pickLocale(o.title, locale)}</p>
            <p className="text-xs text-white/45 mt-0.5">{pickLocale(o.blurb, locale)}</p>
          </button>
        );
      })}
    </div>
  );
});

/**
 * A labelled on/off switch.
 *
 * A checkbox would do the job and reads as paperwork. These two questions
 * change what the form is — which prices, which dates — so they are given the
 * weight of a control rather than a tick box.
 */
const Switch = memo(function Switch({ label, hint, on, onChange }: {
  label: string;
  hint?: string;
  on: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={`flex items-center justify-between gap-4 rounded-2xl px-4 py-3.5 border text-left transition active:scale-[0.99]
        ${on ? "border-accent-warm bg-accent-warm/10" : "border-white/10 bg-white/4 hover:bg-white/[0.07]"}`}
    >
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{label}</span>
        {hint && <span className="block text-xs text-white/40 mt-0.5">{hint}</span>}
      </span>
      <span
        aria-hidden
        className={`relative w-11 h-6 rounded-full shrink-0 transition
          ${on ? "bg-accent-warm" : "bg-white/15"}`}
      >
        <span
          className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all
            ${on ? "left-[1.375rem]" : "left-0.5"}`}
        />
      </span>
    </button>
  );
});

/** A date that was decided for the client, shown rather than chosen. */
const FixedDate = memo(function FixedDate(
  { iso, label, locale }: { iso: string; label: string; locale: string },
) {
  return (
    <div className="rounded-2xl border border-accent-warm/40 bg-accent-warm/10 px-4 py-4">
      <p className="text-[10px] uppercase tracking-widest text-white/45 font-semibold">{label}</p>
      <p className="text-base font-bold mt-1">{formatISO(iso, locale)}</p>
    </div>
  );
});

/**
 * How many people, and — when the tier prices by it — what that costs.
 *
 * Shared by SingleTier and CatalogPicker because the mini-sessions reach step
 * one through the FIRST of those: they have a single tier, so the form shows
 * "here is what it includes" rather than a list of one. Putting the selector
 * only in CatalogPicker, where every other head count lives, would have left
 * the one product whose price actually depends on it with no way to say so.
 *
 * TWO MODES, and the difference is whether the number costs anything:
 *
 *   no pricePerPeople   bare numbers, plus a line saying the price is the same
 *                       either way. Asking is for planning the shoot.
 *   pricePerPeople      each option carries its own total and its per-person
 *                       rate. The rate is DIVIDED from the total rather than
 *                       stored, so it cannot drift from the number beside it.
 */
const PeoplePicker = memo(function PeoplePicker({ item, peopleCount, onPeople }: {
  item: CatalogItem;
  peopleCount: number | null;
  onPeople: (count: number | null) => void;
}) {
  const { t, locale } = useT();
  if (!item.asksPeople) return null;

  const { min, max } = item.asksPeople;
  const counts = Array.from({ length: max - min + 1 }, (_, i) => min + i);
  const prices = item.pricePerPeople;

  if (!prices) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/4 p-4">
        <p className="text-xs font-semibold flex items-center gap-2">
          <Users className="w-3.5 h-3.5 text-white/40" />
          {t("book.peopleLabel")}
        </p>
        <div className="flex flex-wrap gap-2 mt-3">
          {counts.map((count) => (
            <button
              key={count}
              onClick={() => onPeople(count)}
              aria-pressed={peopleCount === count}
              className={`h-10 min-w-11 px-3 rounded-lg text-xs font-medium transition active:scale-95
                ${peopleCount === count
                  ? "bg-accent-warm text-accent-ink font-bold"
                  : "bg-white/[0.07] text-white/60 hover:bg-white/[0.14] hover:text-white"}`}
            >
              {count}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-white/35 mt-3 leading-relaxed">
          {t("book.peopleFlatPrice")}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-white/4 p-4">
      <p className="text-xs font-semibold flex items-center gap-2">
        <Users className="w-3.5 h-3.5 text-white/40" />
        {t("book.peopleLabel")}
      </p>
      <div
        className="mt-3 grid gap-2"
        style={{ gridTemplateColumns: `repeat(${counts.length}, minmax(0, 1fr))` }}
      >
        {counts.map((count) => {
          const total = prices[count] ?? item.priceUzs;
          // No pre-selection. When the number decides the price, a highlighted
          // default is a price the client never chose — and step 1 now waits
          // for a real answer, so there is nothing to pre-fill for.
          const on = peopleCount === count;
          return (
            <button
              key={count}
              onClick={() => onPeople(count)}
              aria-pressed={on}
              className={`rounded-xl border px-2 py-3 text-center transition active:scale-[0.97]
                ${on
                  ? "border-accent-warm bg-accent-warm/12"
                  : "border-white/10 bg-white/[0.04] hover:bg-white/[0.08]"}`}
            >
              <span className={`block text-lg font-bold leading-none ${on ? "text-accent-warm" : "text-white/70"}`}>
                {count}
              </span>
              <span className="mt-1.5 block text-[11px] font-semibold tabular-nums text-white">
                {formatSom(total, locale)}
              </span>
              {/* Divided, not stored — see MINI_PRICES in mini-sessions.ts. */}
              {count > 1 && (
                <span className="mt-0.5 block text-[10px] tabular-nums text-white/40">
                  {t("book.peopleEach").replace("{price}", formatSom(Math.round(total / count), locale))}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
});

/**
 * The one-tier case: what it includes, with nothing to choose about the tier
 * itself. The head count may still be a choice, and for the mini-sessions it
 * is the only one that moves the price.
 */
const SingleTier = memo(function SingleTier({ item, peopleCount, onPeople }: {
  item: CatalogItem;
  peopleCount: number | null;
  onPeople: (count: number | null) => void;
}) {
  const { t, locale } = useT();
  // What this booking actually costs right now, so the figure at the top of
  // the card and the one in the price bar are never two different numbers.
  // `undefined`, not `null` — the line below tests for undefined, and a null
  // here made the "from" prefix silently never render.
  const chosen = peopleCount === null ? undefined : item.pricePerPeople?.[peopleCount];
  const shown = chosen ?? item.priceUzs;
  // "from 170 000" until a head count is picked, because 170 000 is the
  // cheapest of three and printing it bare reads as the price.
  const isFrom = !!item.pricePerPeople && chosen === undefined;
  return (
    <div className="rounded-2xl border border-accent-warm bg-accent-warm/10 p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="font-semibold text-base">{packageDuration(item, locale)}</p>
        <p className="text-sm font-bold shrink-0 tabular-nums">
          {isFrom
            ? t("book.priceFrom").replace("{price}", formatSom(shown, locale))
            : formatSom(shown, locale)}
        </p>
      </div>
      <ul className="mt-3 pt-3 border-t border-white/10 flex flex-col gap-1.5">
        {[
          formatPhotoCount(item.photos, locale),
          formatDelivery(item.delivery, locale),
          ...item.perks.map((x) => pickLocale(x, locale)),
        ]
          .filter(Boolean)
          .map((line) => (
            <li key={line} className="flex items-start gap-2 text-xs text-white/60">
              <Check className="w-3 h-3 text-accent-warm mt-0.5 shrink-0" />
              {line}
            </li>
          ))}
      </ul>
      {item.asksPeople && (
        <div className="mt-4">
          <PeoplePicker item={item} peopleCount={peopleCount} onPeople={onPeople} />
        </div>
      )}
    </div>
  );
});

const CatalogPicker = memo(function CatalogPicker(
  { items, selectedId, peopleCount, onSelect, onPeople }: {
    items: CatalogItem[];
    selectedId: string | null;
    peopleCount: number | null;
    onSelect: (item: CatalogItem) => void;
    onPeople: (count: number | null) => void;
  },
) {
  const { t, locale } = useT();
  const selected = items.find((i) => i.id === selectedId) ?? null;

  // Group headings only when there is more than one group — a single-group
  // service should not grow a header that says nothing.
  const groups = items.reduce<Map<string, CatalogItem[]>>((acc, item) => {
    const key = item.groupKey ?? "";
    acc.set(key, [...(acc.get(key) ?? []), item]);
    return acc;
  }, new Map());

  return (
    <div className="flex flex-col gap-4">
      {[...groups.entries()].map(([key, groupItems]) => (
        <div key={key} className="flex flex-col gap-2">
          {groups.size > 1 && groupItems[0].groupTitle && (
            <p className="px-1 text-[10px] font-bold uppercase tracking-widest text-white/40">
              {pickLocale(groupItems[0].groupTitle, locale)}
            </p>
          )}
          {groupItems.map((item) => {
            const active = item.id === selectedId;
            return (
              <button
                key={item.id}
                onClick={() => onSelect(item)}
                aria-pressed={active}
                className={`text-left rounded-2xl p-4 border transition active:scale-[0.99]
                  ${active
                    ? "border-accent-warm bg-accent-warm/10"
                    : "border-white/10 bg-white/4 hover:bg-white/[0.07]"}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-base">
                      {packageDuration(item, locale)}
                      {item.note ? ` · ${pickLocale(item.note, locale)}` : ""}
                    </p>
                    {item.highlight && (
                      <p className="text-[10px] font-bold uppercase tracking-wider text-accent-warm mt-0.5">
                        {t("service.mostPopular")}
                      </p>
                    )}
                  </div>
                  <p className="text-sm font-bold shrink-0 tabular-nums">
                    {formatSom(item.priceUzs, locale)}
                  </p>
                </div>

                {active && (
                  <ul className="mt-3 pt-3 border-t border-white/10 flex flex-col gap-1.5">
                    {[
                      formatPhotoCount(item.photos, locale),
                      formatDelivery(item.delivery, locale),
                      ...item.perks.map((x) => pickLocale(x, locale)),
                    ]
                      .filter(Boolean)
                      .map((line) => (
                        <li key={line} className="flex items-start gap-2 text-xs text-white/60">
                          <Check className="w-3 h-3 text-accent-warm mt-0.5 shrink-0" />
                          {line}
                        </li>
                      ))}
                  </ul>
                )}
              </button>
            );
          })}
        </div>
      ))}

      {/* Only for a package that asks. This is NOT a price input — the group
          session is one price whatever the head count, which is why it stopped
          dividing by four. It is here so a shoot for six is not planned as a
          shoot for two, and the label says exactly that rather than leaving a
          client to wonder what it will cost them. */}
      {selected && (
        <PeoplePicker item={selected} peopleCount={peopleCount} onPeople={onPeople} />
      )}
    </div>
  );
});

// Location picker

const LocationPicker = memo(function LocationPicker({
  locationIds, suggested, custom, durationMinutes, onToggle, onCustom,
}: {
  locationIds: string[];
  /** The places this package actually happens in. Showing a client an option
   *  their own choice has ruled out — a campus gown session offered the
   *  ceremony venue — is the form not listening. The rest stay one tap away
   *  rather than being removed.
   *
   *  `readonly` because the "nothing suggested" case is a single shared empty
   *  array, so that the prop is referentially stable and `memo` above holds.
   *  Nothing here mutates it. */
  suggested: readonly string[];
  custom: string;
  durationMinutes: number;
  onToggle: (id: string) => void;
  onCustom: (v: string) => void;
}) {
  const { t, locale } = useT();

  // Anything already chosen stays visible even when it isn't suggested;
  // hiding a selected option is how a client pays for a place they can't see.
  //
  // RESTRICTED places are offered only when the package sends the client
  // there. Panorama is the graduation ceremony's hall and CCA is the
  // mini-session venue — a portrait client was being offered both, and picking
  // one meant turning up at an empty building.
  const allowed = BOOKING_LOCATIONS.filter(
    (l) => !l.restricted || suggested.includes(l.id) || locationIds.includes(l.id),
  ).map((l) => l.id);

  const shortList = suggested.length > 0
    ? [...new Set([...suggested, ...locationIds])].filter((id) => allowed.includes(id))
    : allowed;
  const rest = allowed.filter((id) => !shortList.includes(id));

  const [showAll, setShowAll] = useState(false);
  const atLimit = locationIds.length >= MAX_LOCATIONS;

  const row = (id: string) => {
    const active = locationIds.includes(id);
    const fee = getLocation(id)?.surchargePerHourUzs ?? 0;
    const consult = needsConsult(id);
    // A location that cannot be added should say so by looking unavailable,
    // not by silently doing nothing when tapped.
    const blocked = !active && atLimit;

    return (
      <button
        key={id}
        onClick={() => !blocked && onToggle(id)}
        aria-pressed={active}
        disabled={blocked}
        className={`flex items-center justify-between rounded-xl px-4 py-4 min-h-14 text-left transition active:scale-[0.99] border
          ${active
            ? "border-accent-warm bg-accent-warm/10"
            : blocked
              ? "border-transparent bg-white/3 opacity-40 cursor-not-allowed"
              : "border-transparent bg-white/6 hover:bg-white/10"}`}
      >
        <span className="min-w-0">
          <span className="block text-sm font-semibold">{t(`book.loc.${id}.label`)}</span>
          <span className="block text-xs text-white/40 mt-0.5">{t(`book.loc.${id}.sub`)}</span>
          {/* The fee is stated next to the thing that causes it, with the
              hourly rate spelled out — a surcharge a client only meets on the
              total line is a surcharge they will argue about. */}
          {fee > 0 && (
            <span className="mt-1 block text-[11px] font-medium text-accent-warm">
              + {formatSom(locationSurchargeUzs(id, durationMinutes), locale)}
              <span className="text-white/35">
                {" · "}
                {t("book.locationFee").replace("{price}", formatSom(fee, locale))}
              </span>
            </span>
          )}
          {/* No number, because there isn't one yet. Studio hire is per studio
              and per hour and is agreed before the booking is confirmed; the
              100 000/hr that used to print here was a placeholder being added
              to real totals. Saying "ask" is honest, and it is said the moment
              the option is tapped rather than discovered on the bill. */}
          {consult && active && (
            <span className="mt-1.5 block text-[11px] leading-relaxed text-accent-warm">
              {t(`book.loc.${id}.consult`)}
            </span>
          )}
        </span>
        {/* A square, not a radio: more than one can be chosen, and a control
            that looks single-choice while accepting several is a lie the
            client only discovers after tapping. */}
        <span
          className={`w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition
            ${active ? "border-accent-warm bg-accent-warm" : "border-white/20"}`}
        >
          {active && <Check className="w-3 h-3 text-accent-ink" />}
        </span>
      </button>
    );
  };

  return (
    <div className="flex flex-col gap-2">
      {shortList.map(row)}

      {rest.length > 0 && !showAll && (
        <button
          onClick={() => setShowAll(true)}
          className="flex items-center justify-center gap-2 rounded-xl px-4 py-3 min-h-12 text-xs font-semibold text-white/50 hover:text-white/80 bg-white/4 hover:bg-white/[0.07] transition"
        >
          <MapPin className="w-3.5 h-3.5" />
          {t("book.showOtherLocations")}
        </button>
      )}

      {showAll && rest.map(row)}

      {/* Said BEFORE a third is added, not after the total moves. The whole
          point of stating it here is that nobody is surprised by it. */}
      <p className="px-1 text-[11px] leading-relaxed text-white/35">
        {t("book.locationsIncluded")
          .replace("{n}", String(INCLUDED_LOCATIONS))
          .replace("{fee}", formatSom(EXTRA_LOCATION_FEE_UZS, locale))}
        {atLimit && (
          <span className="block mt-1 text-white/50">
            {t("book.locationsMax").replace("{max}", String(MAX_LOCATIONS))}
          </span>
        )}
      </p>

      <div
        className={`rounded-xl px-4 py-3 transition border
          ${custom.trim() ? "border-accent-warm bg-accent-warm/10" : "border-transparent bg-white/6"}`}
      >
        <p className="text-[10px] uppercase tracking-widest text-white/35 font-semibold mb-2">
          {t("book.otherLocation")}
        </p>
        <div className="flex items-center gap-2">
          <MapPin className="w-4 h-4 text-white/30 shrink-0" />
          <input
            value={custom}
            onChange={(e) => onCustom(e.target.value)}
            placeholder={t("book.locationPlaceholder")}
            className="flex-1 bg-transparent text-sm text-white placeholder:text-white/20 outline-none"
          />
        </div>
      </div>
    </div>
  );
});

// The bottom stack

/**
 * Everything pinned to the bottom of the booking page, in one container.
 *
 * WHY A CONTAINER RATHER THAN TWO FIXED ELEMENTS. The progress bar and the
 * error banner have to agree about three things — width, side gutter, and how
 * far they clear the bottom navigation — and two independently positioned
 * `fixed` elements agree about those only until one of them is edited. Here
 * the stack owns the geometry and its children own nothing but their own
 * appearance.
 *
 * `pointer-events-none` on the wrapper so the dead space either side of the
 * bar does not eat taps meant for the form; each child turns them back on.
 */
function BottomStack({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="fixed inset-x-0 bottom-0 z-30 px-3 pointer-events-none"
      // BottomNav occupies roughly 4.5rem plus the device inset.
      style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 5.25rem)" }}
    >
      <div className="mx-auto max-w-2xl flex flex-col gap-2">{children}</div>
    </div>
  );
}

/**
 * The one place an error is allowed to appear.
 *
 * It used to render inside step 4's body — which is exactly where a client
 * cannot see it, because every error that matters sends them back to an
 * EARLIER step, collapsing step 4 and taking the explanation with it. The
 * client was bounced to "When?" with no stated reason and a dead Submit
 * button at the far end of a section they could not see.
 *
 * Bottom of the screen, full width of the bar it sits above, and it stays
 * until either dismissed or resolved — a toast that times out is a toast the
 * client scrolling the time grid will miss.
 */
const ErrorBanner = memo(function ErrorBanner({ message, onDismiss }: {
  message: string | null;
  onDismiss: () => void;
}) {
  const { t } = useT();

  // The last non-null message, so the text survives the collapse. Reading
  // `message` directly emptied the box a frame before it finished closing,
  // which reads as the error being yanked away rather than dismissed.
  const [held, setHeld] = useState(message);
  useEffect(() => {
    if (message) setHeld(message);
  }, [message]);

  // Kept mounted so it can animate out as well as in. Height is driven by the
  // same 0fr/1fr grid the steps use, for one motion vocabulary on the page.
  return (
    <div
      className="grid pointer-events-none"
      style={{
        gridTemplateRows: message ? "1fr" : "0fr",
        transition: `grid-template-rows ${STEP_MS}ms ${STEP_EASE}`,
      }}
      aria-live="assertive"
      role="alert"
    >
      <div className="overflow-hidden">
        <div
          className="pointer-events-auto flex items-start gap-3 rounded-2xl border border-[#e0a89f]/35 bg-[#2a1d1b]/95 backdrop-blur-xl px-4 py-3.5 shadow-2xl shadow-black/60"
          style={{
            opacity: message ? 1 : 0,
            transform: message ? "translateY(0)" : "translateY(0.5rem)",
            transition: `opacity ${STEP_MS}ms ${STEP_EASE}, transform ${STEP_MS}ms ${STEP_EASE}`,
          }}
        >
          {/* CircleAlert, not the AlertCircle alias — both exist in lucide 1.x,
              but the alias is deprecated and aliases go in major versions. */}
          <CircleAlert className="w-4 h-4 shrink-0 mt-0.5 text-[#e0a89f]" />
          {/* The message is held even while collapsing, so the text does not
              vanish a frame before the box it is in. */}
          <p className="min-w-0 flex-1 text-xs leading-relaxed text-[#f0cfc8]">{held}</p>
          <button
            onClick={onDismiss}
            aria-label={t("book.dismiss")}
            className="shrink-0 -m-1.5 p-1.5 rounded-lg text-[#e0a89f]/60 hover:text-[#e0a89f] hover:bg-white/5 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
});

// Sticky bar

const StatusBar = memo(function StatusBar(
  { doneCount, total, priceLabel, canSubmit, submitting, onSubmit }: {
    doneCount: number;
    total: number;
    priceLabel: string;
    canSubmit: boolean;
    submitting: boolean;
    onSubmit: () => void;
  },
) {
  const { t } = useT();
  // Positioning belongs to BottomStack, which this now sits inside — two
  // separately-positioned fixed elements is how an error banner and a progress
  // bar end up overlapping on a short screen.
  return (
    <div className="pointer-events-auto bg-card/90 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl shadow-black/60 overflow-hidden">
      <div className="h-0.5 w-full bg-white/10">
        <div
          className="h-full bg-accent-warm transition-[width] duration-300"
          style={{ width: `${(doneCount / total) * 100}%` }}
        />
      </div>
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] uppercase tracking-widest text-white/40 font-semibold">
            {t("book.stepOf")
              .replace("{n}", String(Math.min(doneCount + 1, total)))
              .replace("{total}", String(total))}
          </p>
          <p className="text-sm font-bold text-white truncate">{priceLabel}</p>
        </div>
        <button
          onClick={onSubmit}
          disabled={submitting}
          className="shrink-0 rounded-full px-6 min-h-11 text-xs font-bold bg-accent-warm hover:bg-(--sc-accent-hover) text-accent-ink transition active:scale-95"
        >
          {canSubmit ? t("book.review") : `${total - doneCount} ${t("book.left")}`}
        </button>
      </div>
    </div>
  );
});

// Confirmation

function Confirmation({ reference, botLink, state, packageName, durationLabel, totalUzs, onReset }: {
  reference: string;
  botLink: string | null;
  state: BookingState;
  /** Already resolved and localised — the confirmation should not re-derive it
   *  from one of two package shapes. */
  packageName: string;
  durationLabel: string;
  totalUzs: number;
  onReset: () => void;
}) {
  const { t, locale } = useT();
  const [copied, setCopied] = useState(false);

  const receipt = [
    `Booking ${reference}`,
    packageName,
    durationLabel,
    formatISO(state.selectedISO, locale),
    state.startTime ?? "",
    describeLocations(state.locationIds, state.locationCustom, t),
    formatSom(totalUzs, locale),
    "saycheeeeeze",
  ].filter(Boolean).join("\n");

  return (
    <div className="min-h-screen bg-background text-white flex flex-col items-center justify-center px-6 py-16 text-center">
      <div
        aria-hidden
        className="fixed inset-0 pointer-events-none"
        style={{ background: "linear-gradient(to bottom, rgba(80,100,119,0.25) 0, transparent 50%)" }}
      />
      <div className="relative z-10 flex flex-col items-center gap-5 max-w-sm w-full">
        <div className="w-16 h-16 rounded-full bg-accent-warm flex items-center justify-center">
          <Check className="w-8 h-8 text-accent-ink" />
        </div>

        <div>
          {/* The other half of the same change — leaving this one serif would
              have made the confirmation screen the odd page instead. */}
          <h2 className="text-3xl font-extrabold tracking-tight">{t("book.doneTitle")}</h2>
          <p className="text-white/50 text-sm mt-2">{t("book.doneBody")}</p>
        </div>

        <div className="bg-white/6 border border-white/10 rounded-xl px-4 py-3 w-full">
          <p className="text-[10px] uppercase tracking-widest text-white/40 font-semibold">
            {t("book.reference")}
          </p>
          <p className="text-xl font-bold tracking-wider mt-0.5">{reference}</p>
        </div>

        {/* The primary CTA, deliberately. A bot cannot message someone who has
            not pressed Start, so this tap is the ONLY way the client can get
            automatic updates — and this screen is the moment of highest intent.
            Roughly a third won't tap, which is what the phone number is for. */}
        {botLink && (
          <a
            href={botLink}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full rounded-full min-h-13 py-3.5 flex flex-col items-center justify-center gap-0.5 bg-accent-warm hover:bg-(--sc-accent-hover) text-accent-ink transition active:scale-[0.98]"
          >
            <span className="flex items-center gap-2 text-sm font-bold">
              <Send className="w-4 h-4" />
              {t("book.getUpdates")}
            </span>
            <span className="text-[10px] opacity-70">{t("book.getUpdatesSub")}</span>
          </a>
        )}

        <button
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(receipt);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            } catch { /* details are on screen anyway */ }
          }}
          className="w-full rounded-full min-h-12 bg-white/10 hover:bg-white/15 text-sm font-semibold transition active:scale-[0.98]"
        >
          {copied ? t("common.copied") : t("book.copyDetails")}
        </button>

        <button onClick={onReset} className="text-white/40 hover:text-white text-sm transition min-h-11">
          {t("book.bookAnother")}
        </button>
      </div>
    </div>
  );
}

// Small pieces

function Field({ icon, label, hint, invalid, valid, children }: {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  invalid?: boolean;
  valid?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div
        className={`bg-white/6 rounded-xl px-4 py-3 flex items-start gap-3 transition border
          ${invalid ? "border-[#e0a89f]/60" : "border-transparent focus-within:border-white/25"}`}
      >
        <span className="text-white/30 shrink-0 mt-3">{icon}</span>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] text-white/30 mb-0.5">{label}</p>
          {children}
        </div>
        {valid && <Check className="w-4 h-4 text-accent-warm shrink-0 mt-3" />}
      </div>
      {hint && <p className="text-[10px] text-white/30 mt-1.5 px-1">{hint}</p>}
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-xs text-white/35 shrink-0">{label}</span>
      <span className="text-xs text-white font-medium text-right truncate">{value || "—"}</span>
    </div>
  );
}

function BookingSkeleton() {
  return (
    <div
      className="min-h-screen bg-background px-4 sm:px-6 max-w-2xl mx-auto"
      style={{ paddingTop: "calc(5rem + env(safe-area-inset-top))" }}
    >
      <div className="h-3 w-32 rounded bg-white/10 animate-pulse" />
      <div className="h-12 w-64 rounded bg-white/10 animate-pulse mt-4" />
      <div className="h-4 w-full max-w-sm rounded bg-white/[0.07] animate-pulse mt-4" />
      <div className="flex flex-col gap-3 mt-8">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-16 w-full rounded-2xl bg-white/5 animate-pulse" />
        ))}
      </div>
    </div>
  );
}

// Helpers

/**
 * "marshall" / "@marshall" / "https://t.me/marshall" -> "@marshall".
 *
 * EMPTY IN, EMPTY OUT. The previous version rebuilt `"@" + body` on every
 * keystroke, so a field the client had cleared came back as a lone "@" that
 * could never be deleted. That was not cosmetic: "@" is truthy, so `hasContact`
 * said a contact had been given; it fails TELEGRAM_RE, so `telegramOk` was
 * false; and it is one character long, so the `length > 1` guard never marked
 * the field invalid. The result was a Confirm button that greyed out with
 * nothing on screen explaining why, recoverable only by reloading the page.
 *
 * The t.me prefix is stripped too — a client asked for their Telegram is at
 * least as likely to paste their profile link as to type the handle.
 */
function normaliseTelegram(raw: string): string {
  const body = raw
    .trim()
    .replace(/^(?:https?:\/\/)?(?:t(?:elegram)?\.me\/)/i, "")
    .replace(/^@+/, "")
    .replace(/[^a-zA-Z0-9_]/g, "");

  return body === "" ? "" : `@${body}`.slice(0, 33);
}

function normalisePhone(raw: string): string {
  const d = raw.replace(/\D/g, "").slice(0, 15);
  return d === "" ? "" : "+" + d;
}

/** "2026-09-14" -> "September 14, 2026" / "14 сентября 2026". */
function formatISO(iso: string | null, locale: string): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  const name = new Intl.DateTimeFormat(
    locale === "ru" ? "ru-RU" : locale === "uz" ? "uz-UZ" : "en-US",
    { month: "long" }
  ).format(new Date(y, m - 1, 1));
  return locale === "en" ? `${name} ${d}, ${y}` : `${d} ${name} ${y}`;
}