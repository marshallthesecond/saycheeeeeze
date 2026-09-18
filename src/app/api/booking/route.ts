// Takes a booking. Five rules hold this route together — break any of them
// and the bug is expensive rather than noisy:
//
//   1. Price is server-side. Never body.price. A request that supplied its own
//      once booked a 1.6M commercial shoot for 1 so'm, and the notification
//      agreed with it.
//   2. Duration is server-side, derived from the package. Never accepted from
//      the request, and never defaulted — a missing duration is an error, not
//      one hour.
//   3. The INSERT is the lock. No check-then-write: a second booking for the
//      same day raises 23505 and becomes a 409.
//   4. Time is Tashkent everywhere. new Date() is UTC on Vercel, which puts
//      the server a calendar day behind the browser between 00:00 and 05:00.
//   5. The client gets a bot deep link back. A Telegram bot can't message
//      someone by @username until they press Start; the link starts that.
//
// Env: TELEGRAM_BOT_TOKEN, TELEGRAM_BOT_USERNAME, TELEGRAM_ADMIN_CHAT_ID,
//      IP_HASH_SALT, NEXT_PUBLIC_SITE_URL, GOOGLE_*

import { NextRequest, NextResponse } from "next/server";
import { createHash, randomBytes } from "crypto";

import {
  canBook, describeSlot, fromISODate, nowInTashkent, toISODate, toTakenMap,
  DEFAULT_AVAILABILITY,
} from "@/src/lib/availability";
import {
  createBooking, expireStalePending, listBlackoutDates, listTakenDays, rateLimited,
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

  // Honeypot: report success and do nothing. A bot that gets a 400 learns to
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

  // Shape validation
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
  // Enforced here as well as in the form: "@ab" is not an email address.
  if (telegram && !TELEGRAM_RE.test(telegram)) {
    return NextResponse.json({ error: "telegram" }, { status: 400 });
  }
  if (phone && (phoneDigits.length < 7 || phoneDigits.length > 15)) {
    return NextResponse.json({ error: "phone" }, { status: 400 });
  }
  // Either shape. A client on a cached page still sends a single locationId,
  // and rejecting those for a deploy cycle would cost real bookings.
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

  // Resolve the package — this is where price comes from.
  //
  // Two sources, one resolver: a package id is either a bookable service tier
  // (priced in services.ts) or a generic session package from the database.
  // quoteBooking() is the same function the form uses to show the quote, so
  // the 409 below fires only on a genuine change, never on the two sides
  // disagreeing about arithmetic.
  const packages = await getBookablePackages();
  const catalogItem = body.packageId ? findCatalogItem(body.packageId) : undefined;
  const pkg = packages.find((p) => p.id === body.packageId);

  if (!catalogItem && !pkg) {
    return NextResponse.json({ error: "package" }, { status: 400 });
  }

  const people = body.peopleCount == null ? null : Math.floor(Number(body.peopleCount));

  // Head count only constrains the generic packages; a catalogue tier prices
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

  // Resolved once. `pkg` is undefined for a catalogue booking, so anything
  // downstream reaching for pkg.name breaks on exactly those.
  //
  // English on purpose: this goes into the bookings row as packageName.en and
  // into the Telegram message, both of which Marshall reads rather than the
  // client. In the client's locale a Russian booking would be
  // indistinguishable from an Uzbek one at a glance.
  //
  // pickLocale, not the Localized straight into the template — an object
  // interpolates without complaint and prints "[object Object]".
  const packageLabel = catalogItem
    ? `${pickLocale(catalogItem.serviceTitle, "en")} — ${packageDuration(catalogItem, "en")}`
    : pick((pkg as SessionPackage).name, "en");

  // A surcharged location typed into the free-text box rather than picked
  // would dodge the fee, so the rule is that it has to be selected to count.
  if (
    locationIds.length === 0 &&
    hasSurcharge(body.locationCustom?.trim().toLowerCase())
  ) {
    return NextResponse.json({ error: "location" }, { status: 400 });
  }

  // A price change while the form was open should be surfaced and
  // re-confirmed, not quietly charged.
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

  // Timing rules
  //
  // The sweep runs BEFORE the ledger is read and before the insert, and that
  // order is the whole point. A pending booking past its hold window still
  // satisfies the partial unique index on (session_date), so without this a
  // day abandoned by a stranger two weeks ago rejects a real booking with
  // 23505 — and the client is told "that day was just taken" about a day
  // nobody has.
  const now = nowInTashkent();
  await expireStalePending(DEFAULT_AVAILABILITY.pendingHoldHours);

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

  // Write. The unique index is the lock.
  const ref = makeRef();
  const created = await createBooking({
    ref,
    sessionDate: body.isoDate as string,
    startTime: body.startTime as string,
    durationMinutes,
    // Whichever source resolved it. Catalogue tiers carry a stable id, so the
    // row records which package was sold, not just its broad category.
    packageId: catalogItem ? catalogItem.id : (pkg as SessionPackage).id,
    packageName: catalogItem ? { en: packageLabel } : (pkg as SessionPackage).name,
    priceUzs: quote.totalUzs,
    basePriceUzs: quote.basePriceUzs,
    peopleCount: people,
    // Both surcharges land in the same list, so a row explains its own total.
    addons: [
      ...(quote.extraPeople > 0
        ? [{
            id: "extra-people",
            qty: quote.extraPeople,
            unitPriceUzs: pkg?.extraPeoplePriceUzs ?? null,
            people: quote.extraPeople,
          }]
        : []),
      // Every location, priced or not — a row listing only the ones that cost
      // money can't tell you where the shoot was. people is 0 rather than null
      // because the field isn't nullable and this addon isn't about people.
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
    // First is the primary, for the existing column; the rest are in addons.
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

  // Fire-and-forget: the customer shouldn't wait on Telegram's API, and a
  // failed notification is recoverable.
  void notifyAdmin({
    ref,
    name,
    telegram,
    phone,
    packageName: packageLabel,
    serviceSlug: body.serviceSlug ?? null,
    date: body.isoDate as string,
    slot: describeSlot(body.startTime as string, durationMinutes),
    // Every place, joined. This notification is how Marshall finds out where
    // to turn up, so listing only the first would be misleading.
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

// Admin notification. Inline buttons rather than approve/decline URLs: a URL
// carries its token through browser history and every logging hop, and any
// prefetcher that opens one silently approves a booking. A callback_query is
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

  // HTML, not MarkdownV2. MarkdownV2 reserves eighteen characters EVERYWHERE,
  // including inside bold and italic, so one unescaped "." in a hard-coded line
  // rejects the whole message with 400 — which is exactly what happened here.
  // HTML reserves three, and they cannot appear in a formatting marker by
  // accident.
  const esc = (s: string) =>
    s.replace(/[&<>]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"));

  const lines = [
    `📸 <b>New booking</b> · <code>${esc(n.ref)}</code>`,
    ``,
    `<b>${esc(n.packageName)}</b> — ${esc(n.priceLabel)}`,
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
    `<i>Held 48h, then the day reopens.</i>`,
    // `!== null`, not `Boolean`. The four `` entries above are the blank lines
    // that separate the booking from the client from the footer, and an empty
    // string is falsy — filter(Boolean) deleted every one of them, so the
    // message had no paragraph breaks at all.
  ].filter((line) => line !== null).join("\n");

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
      parse_mode: "HTML",
      disable_web_page_preview: true,
      reply_markup: { inline_keyboard: keyboard },
    }),
  });

  // Loud on failure. This is fire-and-forget by design — the client must not
  // wait on Telegram — so the log is the ONLY place a failure surfaces, and the
  // booking still returns 201 either way. A silent 400 here is how the admin
  // notification managed to be broken without anyone noticing.
  if (!res.ok) {
    console.error(
      `Telegram sendMessage failed (${res.status}) for ${n.ref}:`,
      await res.text(),
    );
  }
}