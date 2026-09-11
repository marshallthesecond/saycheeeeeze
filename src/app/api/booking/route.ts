// src/app/api/booking/route.ts
//
// What changed from the previous version:
//
//   1. PRICE IS SERVER-SIDE. The old route wrote body.price — a string the
//      client supplied — into the ledger, your Telegram message and your Sheet
//      without ever checking it. A modified request booked a 1.6M commercial
//      shoot for 1 so'm and the notification said 1 so'm.
//
//   2. DURATION IS SERVER-SIDE. Derived from the package, never accepted from
//      the request. That also removes the `duration ?? 1` fallback that
//      silently priced a missing duration as one hour.
//
//   3. THE INSERT IS THE LOCK. No check-then-write. A second booking for the
//      same day raises 23505 and becomes a 409.
//
//   4. TIME IS TASHKENT EVERYWHERE. canBook() no longer defaults to new Date(),
//      which was UTC on Vercel and put the server a calendar day behind the
//      browser between 00:00 and 05:00 local.
//
//   5. THE CLIENT GETS A BOT LINK BACK. A Telegram bot cannot message someone
//      by @username — the person must press Start first. The deep link in the
//      response is how that handshake begins.
//
// Env: TELEGRAM_BOT_TOKEN, TELEGRAM_BOT_USERNAME, TELEGRAM_ADMIN_CHAT_ID,
//      IP_HASH_SALT, NEXT_PUBLIC_SITE_URL, GOOGLE_* (unchanged)
// Retired: BOOKING_ADMIN_TOKEN — replaced by callback_query + admin chat check.

import { NextRequest, NextResponse } from "next/server";
import { createHash, randomBytes } from "crypto";

import {
  canBook, describeSlot, fromISODate, nowInTashkent, toISODate, toTakenMap,
  DEFAULT_AVAILABILITY,
} from "@/src/lib/availability";
import {
  createBooking, listBlackoutDates, listTakenDays, rateLimited,
} from "@/src/lib/bookings";
import { getBookablePackages } from "@/src/lib/packages.server";
import { formatSom, peopleError, pick, type SessionPackage } from "@/src/lib/packages";
import { quoteBooking } from "@/src/lib/booking-price";
import { findCatalogItem } from "@/src/lib/booking-catalog";
import { pickLocale } from "@/src/lib/services";
import { packageDuration } from "@/src/lib/service-format";
import {
  EXTRA_LOCATION_FEE_UZS, MAX_LOCATIONS, hasSurcharge, locationSurchargeUzs,
} from "@/src/lib/locations";
import type { Locale } from "@/src/lib/i18n/config";

interface Payload {
  packageId?: string;
  peopleCount?: number | null;
  serviceSlug?: string | null;
  isoDate?: string;
  startTime?: string;
  locationId?: string | null;
  locationIds?: string[] | null;
  locationCustom?: string | null;
  name?: string;
  telegram?: string | null;
  phone?: string | null;
  notes?: string | null;
  locale?: string;
  consent?: boolean;
  /** Display only. Used to detect a stale page, never trusted as input. */
  quotedPriceUzs?: number;
  /** Honeypot — must be empty. */
  website?: string;
}

const TELEGRAM_RE = /^@[a-zA-Z][a-zA-Z0-9_]{4,31}$/;

function hashIp(ip: string): string {
  return createHash("sha256").update(ip + (process.env.IP_HASH_SALT ?? "")).digest("hex");
}

/** SC-7F3K2. crypto-random rather than Math.random — refs end up in URLs. */
function makeRef(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I/O/0/1
  const bytes = randomBytes(5);
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return `SC-${out}`;
}

export async function POST(req: NextRequest) {
  let body: Payload;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // ── Honeypot ────────────────────────────────────────────
  // Report success without doing anything. A bot that gets a 400 learns to
  // retry differently; one that gets a 200 moves on satisfied.
  if (body.website && body.website.trim() !== "") {
    return NextResponse.json({ ok: true, reference: "SC-000000" });
  }

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") || "unknown";
  const ipHash = hashIp(ip);

  if (await rateLimited(ipHash)) {
    return NextResponse.json(
      { error: "tooMany", message: "Too many booking requests today. Message me on Telegram instead." },
      { status: 429 }
    );
  }

  // ── Shape validation ────────────────────────────────────
  const locale: Locale =
    body.locale === "ru" || body.locale === "uz" ? body.locale : "en";

  const name = (body.name ?? "").trim();
  const telegram = (body.telegram ?? "").trim() || null;
  const phone = (body.phone ?? "").trim() || null;
  const phoneDigits = phone?.replace(/\D/g, "") ?? "";

  if (name.length < 2) {
    return NextResponse.json({ error: "name" }, { status: 400 });
  }
  if (!telegram && !phone) {
    return NextResponse.json({ error: "contact" }, { status: 400 });
  }
  // The old client enabled submit on truthiness alone, so "@ab" — which the
  // field itself flagged with a red ✗ — went through. Enforce it here too.
  if (telegram && !TELEGRAM_RE.test(telegram)) {
    return NextResponse.json({ error: "telegram" }, { status: 400 });
  }
  if (phone && (phoneDigits.length < 7 || phoneDigits.length > 15)) {
    return NextResponse.json({ error: "phone" }, { status: 400 });
  }
  // Accepts either shape. A client on a cached page still sends a single
  // locationId, and rejecting those for a whole deploy cycle would cost real
  // bookings for no benefit.
  const locationIds = Array.isArray(body.locationIds)
    ? [...new Set(body.locationIds.filter((id): id is string => typeof id === "string"))]
    : body.locationId
      ? [body.locationId]
      : [];

  if (locationIds.length === 0 && !(body.locationCustom ?? "").trim()) {
    return NextResponse.json({ error: "location" }, { status: 400 });
  }
  if (locationIds.length > MAX_LOCATIONS) {
    return NextResponse.json({ error: "location" }, { status: 400 });
  }
  if (body.consent !== true) {
    return NextResponse.json({ error: "consent" }, { status: 400 });
  }

  const date = fromISODate(body.isoDate ?? "");
  if (!date) return NextResponse.json({ error: "date" }, { status: 400 });

  // ── Resolve the package. This is where price comes from. ─
  //
  // Two sources, one resolver. A package id is either one of the individually
  // bookable service tiers (graduation's five, priced in services.ts) or one of
  // the four generic session packages from the database. quoteBooking() is the
  // SAME function the form uses to display the quote, so the 409 below fires
  // only on a genuine change and never on the two sides disagreeing about
  // arithmetic.
  const packages = await getBookablePackages();
  const catalogItem = body.packageId ? findCatalogItem(body.packageId) : undefined;
  const pkg = packages.find((p) => p.id === body.packageId);

  if (!catalogItem && !pkg) {
    return NextResponse.json({ error: "package" }, { status: 400 });
  }

  const people = body.peopleCount == null ? null : Math.floor(Number(body.peopleCount));

  // Head count only constrains the generic packages. A catalogue tier prices
  // the session, not the people in it.
  if (pkg && !catalogItem) {
    const pErr = peopleError(pkg, people);
    if (pErr) {
      return NextResponse.json(
        { error: "people", code: pErr, maxPeople: pkg.maxPeopleHard },
        { status: 400 }
      );
    }
  }

  const quote = quoteBooking({
    packageId: body.packageId,
    sessionPackages: packages,
    peopleCount: people,
    locationIds,
  });
  if (!quote) return NextResponse.json({ error: "package" }, { status: 400 });

  const durationMinutes = quote.durationMinutes;

  // Resolved ONCE. `pkg` is undefined for a catalogue booking, so anything
  // downstream that reaches for pkg.name breaks on exactly the bookings this
  // refactor was built to support.
  //
  // English on purpose, both halves: this label goes into the `bookings` row as
  // packageName.en and into the Telegram message, and both of those are read by
  // Marshall rather than by the client. Resolving it in the CLIENT's locale
  // would leave a Russian booking indistinguishable from a Uzbek one at a
  // glance in a list of them.
  //
  // pickLocale rather than dropping the Localized straight into the template:
  // an object interpolates without complaint and prints "[object Object]".
  const packageLabel = catalogItem
    ? `${pickLocale(catalogItem.serviceTitle, "en")} — ${packageDuration(catalogItem, "en")}`
    : pick((pkg as SessionPackage).name, "en");

  // A surcharged location typed into the free-text box instead of picked would
  // dodge the fee. There is nothing to charge for a place we cannot identify,
  // so the rule is simply that the studio has to be SELECTED to be booked.
  if (
    locationIds.length === 0 &&
    hasSurcharge(body.locationCustom?.trim().toLowerCase())
  ) {
    return NextResponse.json({ error: "location" }, { status: 400 });
  }

  // A price change while the form was open shouldn't quietly charge the new
  // amount. Surface it and make them re-confirm.
  if (
    typeof body.quotedPriceUzs === "number" &&
    body.quotedPriceUzs !== quote.totalUzs
  ) {
    return NextResponse.json(
      {
        error: "priceChanged",
        priceUzs: quote.totalUzs,
        priceLabel: formatSom(quote.totalUzs, locale),
      },
      { status: 409 }
    );
  }

  // ── Timing rules ────────────────────────────────────────
  const now = nowInTashkent();
  const fromISO = toISODate(now);
  const [taken, blackouts] = await Promise.all([
    listTakenDays(fromISO),
    listBlackoutDates(fromISO),
  ]);

  const check = canBook(
    date,
    body.startTime ?? "",
    durationMinutes,
    DEFAULT_AVAILABILITY,
    toTakenMap(taken),
    new Set(blackouts),
    now
  );
  if (!check.ok) {
    const status = check.code === "dayTaken" ? 409 : 400;
    return NextResponse.json({ error: check.code, message: check.reason }, { status });
  }

  // ── Write. The unique index is the lock. ────────────────
  const ref = makeRef();
  const created = await createBooking({
    ref,
    sessionDate: body.isoDate as string,
    startTime: body.startTime as string,
    durationMinutes,
    // The id is whichever source resolved it. Catalogue tiers carry their own
    // stable id ("grad-campus-90m"), so a booking row records exactly which
    // package was sold rather than only which broad category it fell into.
    packageId: catalogItem ? catalogItem.id : (pkg as SessionPackage).id,
    packageName: catalogItem ? { en: packageLabel } : (pkg as SessionPackage).name,
    priceUzs: quote.totalUzs,
    basePriceUzs: quote.basePriceUzs,
    peopleCount: people,
    // Both surcharges land in the same addons list, so a booking row explains
    // its own total rather than showing a number nobody can reconstruct.
    addons: [
      ...(quote.extraPeople > 0
        ? [{
            id: "extra-people",
            qty: quote.extraPeople,
            unitPriceUzs: pkg?.extraPeoplePriceUzs ?? null,
            people: quote.extraPeople,
          }]
        : []),
      // Every location is recorded, priced or not — a booking row that lists
      // only the ones that cost money cannot tell you where the shoot was.
      // BookingAddon.people is a number, not nullable; 0 is the honest reading
      // of "this addon is not about people".
      ...locationIds.map((id) => ({
        id: `location-${id}`,
        qty: 1,
        unitPriceUzs: locationSurchargeUzs(id, durationMinutes),
        people: 0,
      })),
      ...(quote.extraLocationUzs > 0
        ? [{
            id: "extra-locations",
            qty: quote.extraLocationCount,
            unitPriceUzs: EXTRA_LOCATION_FEE_UZS,
            people: 0,
          }]
        : []),
    ],
    serviceSlug: body.serviceSlug ?? null,
    // The first is the primary, for the existing column. The rest live in the
    // addons above rather than being dropped.
    locationId: locationIds[0] ?? null,
    locationCustom: (body.locationCustom ?? "").trim() || null,
    clientName: name,
    telegramUsername: telegram,
    phone,
    notes: (body.notes ?? "").trim() || null,
    locale,
    source: body.serviceSlug ? `service:${body.serviceSlug}` : "form",
    ipHash,
  });

  if (!created.ok) {
    if (created.code === "conflict") {
      return NextResponse.json(
        { error: "dayTaken", message: "That day was just taken — please pick another." },
        { status: 409 }
      );
    }
    console.error("Booking insert failed:", created.message);
    return NextResponse.json({ error: "server" }, { status: 503 });
  }

  const booking = created.booking;
  const priceLabel = formatSom(quote.totalUzs, locale);

  // ── Notify you. Fire-and-forget: the customer should not wait on
  //    Telegram's API, and a failed notification is recoverable. ──
  void notifyAdmin({
    ref,
    name,
    telegram,
    phone,
    packageName: packageLabel,
    serviceSlug: body.serviceSlug ?? null,
    date: body.isoDate as string,
    slot: describeSlot(body.startTime as string, durationMinutes),
    // Every place, joined — the notification is how Marshall finds out where
    // to turn up, so listing only the first would be actively misleading.
    location:
      [...locationIds, (body.locationCustom ?? "").trim()].filter(Boolean).join(" + ") || "—",
    people,
    priceLabel,
    notes: body.notes ?? null,
    locale,
  }).catch((e) => console.error("Admin notify failed:", e));

  // The client hasn't linked a chat yet — this deep link is how they do it.
  const botUser = process.env.TELEGRAM_BOT_USERNAME;
  const botLink = botUser ? `https://t.me/${botUser}?start=${ref}` : null;

  return NextResponse.json(
    {
      ok: true,
      reference: ref,
      status: booking.status,
      priceUzs: quote.totalUzs,
      priceLabel,
      durationMinutes,
      botLink,
    },
    { status: 201 }
  );
}

// ─── Admin notification ───────────────────────────────────
// Inline buttons rather than approve/decline URLs. The old links carried
// BOOKING_ADMIN_TOKEN in the query string, which put it in browser history and
// in every logging hop between Telegram and the server — and any prefetcher
// that opened one silently approved a booking. A callback_query is
// authenticated by Telegram and carries no secret at all.

interface AdminNotice {
  ref: string;
  name: string;
  telegram: string | null;
  phone: string | null;
  packageName: string;
  serviceSlug: string | null;
  date: string;
  slot: string;
  location: string;
  people: number | null;
  priceLabel: string;
  notes: string | null;
  locale: string;
}

async function notifyAdmin(n: AdminNotice): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
  if (!token || !chatId) {
    console.error("Telegram admin env vars missing");
    return;
  }

  const esc = (s: string) => s.replace(/[_*[\]()~`>#+=|{}.!-]/g, (c) => `\\${c}`);

  const lines = [
    `📸 *New booking* · \`${esc(n.ref)}\``,
    ``,
    `*${esc(n.packageName)}* — ${esc(n.priceLabel)}`,
    `📅 ${esc(n.date)} · ${esc(n.slot)}`,
    `📍 ${esc(n.location)}`,
    n.people ? `👥 ${n.people} people` : null,
    ``,
    `👤 ${esc(n.name)}`,
    n.telegram ? `✈️ ${esc(n.telegram)}` : null,
    n.phone ? `📞 ${esc(n.phone)}` : null,
    n.serviceSlug ? `🏷 wants: ${esc(n.serviceSlug)}` : null,
    n.notes ? `\n📝 ${esc(n.notes)}` : null,
    ``,
    `_Held 48h, then the day reopens._`,
  ].filter(Boolean).join("\n");

  const keyboard: { text: string; callback_data?: string; url?: string }[][] = [
    [
      { text: "✅ Approve", callback_data: `bk:confirm:${n.ref}` },
      { text: "❌ Decline", callback_data: `bk:decline:${n.ref}` },
    ],
  ];
  if (n.telegram) {
    keyboard.push([{ text: "💬 Message client", url: `https://t.me/${n.telegram.slice(1)}` }]);
  }

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(8000),
    body: JSON.stringify({
      chat_id: chatId,
      text: lines,
      parse_mode: "MarkdownV2",
      disable_web_page_preview: true,
      reply_markup: { inline_keyboard: keyboard },
    }),
  });

  if (!res.ok) console.error("Telegram sendMessage failed:", await res.text());
}