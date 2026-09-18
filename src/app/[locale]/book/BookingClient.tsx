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

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Check, ChevronDown, Clock, MapPin, MessageCircle, Phone, Send, User, Users,
} from "lucide-react";

import StickyHeader from "@/src/components/common/StickyHeader";
import { useT } from "@/src/lib/i18n/LanguageProvider";
import {
  type AvailabilityConfig, type TakenDay, earliestBookableDate, todayInTashkent,
} from "@/src/lib/availability";
import {
  type SessionPackage, formatSom, peopleError, pick,
  pickList,
} from "@/src/lib/packages";
import { catalogForService, findCatalogItem, type CatalogItem } from "@/src/lib/booking-catalog";
import { quoteBooking } from "@/src/lib/booking-price";
import {
  BOOKING_LOCATIONS, EXTRA_LOCATION_FEE_UZS, INCLUDED_LOCATIONS, MAX_LOCATIONS,
  getLocation, locationSurchargeUzs,
} from "@/src/lib/locations";
import { pickLocale } from "@/src/lib/services";
import {
  formatDelivery, formatPhotoCount, packageDuration,
} from "@/src/lib/service-format";
import { CalendarPicker, StartTimePicker } from "./CalendarPicker";

// Types

type StepId = 1 | 2 | 3 | 4;

interface BookingState {
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

// Root

interface Props {
  packages: SessionPackage[];
  taken: TakenDay[];
  blackouts: string[];
  availability: AvailabilityConfig;
}

export default function BookingClient(props: Props) {
  return (
    <Suspense fallback={<BookingSkeleton />}>
      <BookingInner {...props} />
    </Suspense>
  );
}

function BookingInner({ packages, taken, blackouts, availability }: Props) {
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
  const presetPackage =
    (packageParam && findCatalogItem(packageParam) ? packageParam : null) ??
    (packages.some((p) => p.id === packageParam) ? packageParam : null);

  // Every tier of the service they came from, so the form offers the same list
  // they were just reading rather than four generic ones.
  /**
   * The tiers to offer.
   *
   * The service's own where it has them, so the form shows the list the client
   * was just reading. Otherwise the generic ladder — identical numbers, built
   * by the same function — rather than the four generic database packages,
   * whose prices exist nowhere else on the site.
   */
  const serviceCatalog = useMemo(() => {
    const own = slugParam ? catalogForService(slugParam) : [];
    return own.length > 0 ? own : genericCatalog();
  }, [slugParam]);

  const today = useMemo(() => todayInTashkent(), []);

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

  const [state, setState] = useState<BookingState>({
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
  });

  const [openStep, setOpenStep] = useState<StepId>(presetPackage ? 2 : 1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ ref: string; botLink: string | null } | null>(null);
  const [website, setWebsite] = useState(""); // honeypot

  const set = <K extends keyof BookingState>(k: K, v: BookingState[K]) =>
    setState((prev) => ({ ...prev, [k]: v }));

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

  // Per-step completion. A catalogue tier prices the session rather than the
  // heads in it, so it has no head count to be missing.
  const peopleOk = catalogItem
    ? true
    : pkg
      ? peopleError(pkg, state.peopleCount) === null
      : false;
  const step1Done = !!selected && peopleOk;
  const step2Done = !!(state.selectedISO && state.startTime);
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

  // Advance as each step completes, but only forward — so reopening step 1 to
  // change your mind doesn't immediately slam shut again.
  useEffect(() => { if (step1Done) setOpenStep((s) => (s === 1 ? 2 : s)); }, [step1Done]);
  useEffect(() => { if (step2Done) setOpenStep((s) => (s === 2 ? 3 : s)); }, [step2Done]);
  useEffect(() => { if (step3Done) setOpenStep((s) => (s === 3 ? 4 : s)); }, [step3Done]);

  // A new package means a new duration, which can invalidate the chosen start
  // time. Clear it rather than submitting a slot that no longer fits inside
  // the working day.
  useEffect(() => { set("startTime", null); }, [state.packageId]); // eslint-disable-line react-hooks/exhaustive-deps

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
          serviceSlug: state.serviceSlug,
          isoDate: state.selectedISO,
          startTime: state.startTime,
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
        } else {
          // Someone took the day between page load and submit. Clear it so a
          // fresh choice has to be made rather than resubmitting the same one.
          set("selectedISO", null);
          set("startTime", null);
          setOpenStep(2);
          setError(t("book.dayTaken"));
        }
        return;
      }
      if (!res.ok) throw new Error(data?.error ?? "failed");

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
          setState({
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
            onToggle={() => setOpenStep(1)}
            summary={selected ? `${selected.name} · ${formatSom(quote?.totalUzs ?? 0, locale)}` : ""}
          >
            {
              // Always the catalogue now. The PackagePicker branch that stood
              // here rendered the four `packages` rows, and there is no longer
              // a case where those are the right thing to show.
              <CatalogPicker
                items={serviceCatalog}
                selectedId={state.packageId}
                peopleCount={state.peopleCount}
                onPeople={(count) => set("peopleCount", count)}
                onSelect={(item) => {
                  set("packageId", item.id);
                  set("peopleCount", null);
                  // The package implies where it happens, so switching from a
                  // campus tier to a ceremony one moves the location with it.
                  //
                  // Only while the client hasn't chosen for themselves: a
                  // typed-in place, or any pick that isn't simply the previous
                  // package's default, is an answer and must not be
                  // overwritten.
                  const previousDefault = catalogItem?.locationIds[0] ?? null;
                  const untouched =
                    state.locationIds.length === 0 ||
                    (state.locationIds.length === 1 && state.locationIds[0] === previousDefault);
                  if (item.locationIds.length > 0 && untouched && !state.locationCustom.trim()) {
                    set("locationIds", [item.locationIds[0]]);
                  }
                }}
              />
            }
          </Step>

          {/* 2 ─ When */}
          <Step
            n={2}
            label={t("book.stepWhen")}
            done={step2Done}
            open={openStep === 2}
            onToggle={() => setOpenStep(2)}
            locked={!step1Done}
            summary={
              state.selectedISO && state.startTime
                ? `${formatISO(state.selectedISO, locale)} · ${state.startTime}`
                : ""
            }
          >
            <div className="flex flex-col gap-5">
              <CalendarPicker
                selectedISO={state.selectedISO}
                viewMonth={state.month}
                viewYear={state.year}
                onSelect={(iso) => { set("selectedISO", iso); set("startTime", null); }}
                onViewChange={(m, y) => { set("month", m); set("year", y); }}
                availability={availability}
                taken={taken}
                blackouts={blackouts}
              />
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
                  onChange={(time) => set("startTime", time)}
                  availability={availability}
                />
              </div>
            </div>
          </Step>

          {/* 3 ─ Where */}
          <Step
            n={3}
            label={t("book.stepWhere")}
            done={step3Done}
            open={openStep === 3}
            onToggle={() => setOpenStep(3)}
            locked={!step2Done}
            summary={describeLocations(state.locationIds, state.locationCustom, t)}
          >
            <LocationPicker
              locationIds={state.locationIds}
              suggested={catalogItem?.locationIds ?? []}
              custom={state.locationCustom}
              durationMinutes={selected?.durationMinutes ?? 120}
              onToggle={(id) =>
                set(
                  "locationIds",
                  state.locationIds.includes(id)
                    ? state.locationIds.filter((x) => x !== id)
                    // Silently dropping the oldest would be worse than refusing:
                    // the client would watch a tick move and not know why.
                    : state.locationIds.length >= MAX_LOCATIONS
                      ? state.locationIds
                      : [...state.locationIds, id],
                )
              }
              onCustom={(v) => set("locationCustom", v)}
            />
          </Step>

          {/* 4 ─ Who */}
          <Step
            n={4}
            label={t("book.stepWho")}
            done={step4Done}
            open={openStep === 4}
            onToggle={() => setOpenStep(4)}
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

              {error && (
                <p className="text-xs text-[#e0a89f] bg-[#e0a89f]/10 rounded-xl px-4 py-3">{error}</p>
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

      {doneCount > 0 && openStep !== 4 && (
        <StatusBar
          doneCount={doneCount}
          total={4}
          priceLabel={quote ? formatSom(quote.totalUzs, locale) : t("book.pickPackageForPrice")}
          canSubmit={canSubmit}
          submitting={submitting}
          onSubmit={() => setOpenStep(4)}
        />
      )}
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

function Step({ n, label, done, open, locked, summary, onToggle, children }: {
  n: number;
  label: string;
  done: boolean;
  open: boolean;
  locked?: boolean;
  summary?: string;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  const disabled = locked && !done;

  return (
    <section
      className={`rounded-2xl border transition
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
          {!open && summary && (
            <span className="block text-xs text-white/45 truncate mt-0.5">{summary}</span>
          )}
        </span>
        {!disabled && (
          <ChevronDown
            className={`w-4 h-4 text-white/30 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
          />
        )}
      </button>
      {open && <div className="px-4 pb-5">{children}</div>}
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

function CatalogPicker({ items, selectedId, peopleCount, onSelect, onPeople }: {
  items: CatalogItem[];
  selectedId: string | null;
  peopleCount: number | null;
  onSelect: (item: CatalogItem) => void;
  onPeople: (count: number | null) => void;
}) {
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
      {selected?.asksPeople && (
        <div className="rounded-2xl border border-white/10 bg-white/4 p-4">
          <p className="text-xs font-semibold flex items-center gap-2">
            <Users className="w-3.5 h-3.5 text-white/40" />
            {t("book.peopleLabel")}
          </p>
          <div className="flex flex-wrap gap-2 mt-3">
            {Array.from(
              { length: selected.asksPeople.max - selected.asksPeople.min + 1 },
              (_, i) => selected.asksPeople!.min + i,
            ).map((count) => (
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
      )}
    </div>
  );
}

// Location picker

function LocationPicker({
  locationIds, suggested, custom, durationMinutes, onToggle, onCustom,
}: {
  locationIds: string[];
  /** The places this package actually happens in. Showing a client an option
   *  their own choice has ruled out — a campus gown session offered the
   *  ceremony venue — is the form not listening. The rest stay one tap away
   *  rather than being removed. */
  suggested: string[];
  custom: string;
  durationMinutes: number;
  onToggle: (id: string) => void;
  onCustom: (v: string) => void;
}) {
  const { t, locale } = useT();

  // Anything already chosen stays visible even when it isn't suggested;
  // hiding a selected option is how a client pays for a place they can't see.
  const shortList = suggested.length > 0
    ? [...new Set([...suggested, ...locationIds])]
    : BOOKING_LOCATIONS.map((l) => l.id);
  const rest = BOOKING_LOCATIONS.map((l) => l.id).filter((id) => !shortList.includes(id));

  const [showAll, setShowAll] = useState(false);
  const atLimit = locationIds.length >= MAX_LOCATIONS;

  const row = (id: string) => {
    const active = locationIds.includes(id);
    const fee = getLocation(id)?.surchargePerHourUzs ?? 0;
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
}

// Sticky bar

function StatusBar({ doneCount, total, priceLabel, canSubmit, submitting, onSubmit }: {
  doneCount: number;
  total: number;
  priceLabel: string;
  canSubmit: boolean;
  submitting: boolean;
  onSubmit: () => void;
}) {
  const { t } = useT();
  return (
    <div
      className="fixed inset-x-0 bottom-0 z-30 px-3 pointer-events-none"
      // Sits above BottomNav, which occupies roughly 4.5rem plus the inset.
      style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 5.25rem)" }}
    >
      <div className="pointer-events-auto mx-auto max-w-2xl bg-card/90 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl shadow-black/60 overflow-hidden">
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
    </div>
  );
}

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