'use client';

// src/app/[locale]/services/[slug]/ServicePackages.tsx
//
// The packages sidebar: a segmented toggle over the kinds of session, and a
// compact price list for whichever one is selected.
//
// ── What this replaces, and why ──────────────────────────────
// Every package used to be a tall card — big duration, three lines of detail, a
// price, and its own full-width booking button. Five of those stacked with two
// group headings ran to nearly three phone screens, so comparing the 45-minute
// session against the 2.5-hour one meant scrolling between them and holding two
// numbers in your head. A price list you cannot see at once is not a price list.
//
// So: one row per package, both groups behind a toggle, one screen.
//
// ── Why the price leads, in its own column ──────────────────
// These are options you COMPARE, and comparison wants every price at the SAME
// x-position so the eye reads straight down without re-finding the number each
// row. The first version put duration on the left and the price on the right of
// a flexible row; rendering it showed the prices landing at three different
// positions because the left column's width followed its text. That defeated
// the whole reason for using rows.
//
// So the price is a fixed-width leading column in tabular figures, and the
// description follows it. The digits line up, the currency trails small so it
// does not push them out of alignment, and the row stays two lines tall.
//
// "Most popular" is folded into the description line rather than sitting as a
// pill beside the duration — as a pill it wrapped "1.5 hours" onto two lines,
// which made the recommended option the ugliest row on the page.
//
// ── Why choosing is separate from going ─────────────────────
// A row used to be a link straight to the booking page, so reading a package
// and committing to it were the same gesture — you could not open the 2.5-hour
// option to see what was in it without also leaving. Now a row SELECTS, opens
// to show what it includes, and one Book button below carries that choice on.
// Choosing and going are two decisions, and they now take two taps.
//
// Only the selected package is open. The whole point of the earlier rewrite was
// that this list fits on one screen; three expanded panels would undo it.
//
// The booking buttons live in HERE rather than on the page, because they now
// depend on which package is selected and that state lives here. A button that
// acts on a selection belongs with the selection.
//
// ── Why a client component ───────────────────────────────────
// The toggle is state, and this is the only interactive part of an otherwise
// static server-rendered page. Keeping it to this subtree means the page stays
// server-rendered around it.

import { useEffect, useId, useState } from 'react';
import { CalendarDays, Check, Send } from 'lucide-react';
import Link from 'next/link';

import type { ResolvedPackage, ResolvedPackageGroup } from '@/src/lib/services';
import { formatSom } from '@/src/lib/packages';
import type { Locale } from '@/src/lib/i18n/config';
import { CONTACT } from '@/src/lib/contact';
import { useAudience } from './ServiceAudience';

interface Props {
  groups: ResolvedPackageGroup[];
  /**
   * Per-audience overrides for the group titles and blurbs, keyed by group key.
   * Applied here rather than by the page because the toggle is client state and
   * the page is a server component — see ServiceAudience.
   */
  audienceGroups?: Record<string, { title?: string; blurb?: string }>;
  accentColor: string;
  slug: string;
  category: string;
  locale: string;
  labels: {
    mostPopular: string;
    /** "{suffix} each" — the currency plus a per-person marker. */
    perPersonShort: string;
    /**
     * The COMPACT pair, not service.bookSession / service.askOnTelegram.
     *
     * These two buttons sit side by side in a column that is about 150px per
     * button on a phone, and Cyrillic runs wider than English at the same
     * point size: "Забронировать съёмку" needs 173px and got 153, so a Russian
     * visitor read "Забронирова…" on the one control the whole page exists to
     * get them to press. The English labels are already short enough and are
     * unchanged; ru and uz carry their own shorter wording.
     */
    bookShort: string;
    telegramShort: string;
  };
}

/**
 * "400 000 so'm" -> { amount: "400 000", suffix: "so'm" }.
 *
 * The digits are set large and tabular in a fixed-width column so the prices
 * line up down the list; the currency word trails small underneath, because
 * inline it made the widest price overrun the column and print over the text
 * beside it. Splitting on the LAST run of digits rather than the first space
 * keeps "1 600 000 so'm" whole.
 */
function splitMoney(formatted: string): { amount: string; suffix: string } {
  const parts = formatted.split(' ');
  const digits: string[] = [];
  const rest: string[] = [];
  for (const part of parts) {
    if (/^\d+$/.test(part) && rest.length === 0) digits.push(part);
    else rest.push(part);
  }
  return { amount: digits.join(' ') || formatted, suffix: rest.join(' ') };
}

/** The package a group opens on: the recommended one, else the first. */
function defaultIndex(packages: ResolvedPackage[]): number {
  const i = packages.findIndex((p) => p.highlight);
  return i === -1 ? 0 : i;
}

export default function ServicePackages({
  groups,
  audienceGroups,
  accentColor,
  slug,
  category,
  locale,
  labels,
}: Props) {
  const [active, setActive] = useState(0);
  const [selected, setSelected] = useState(() => defaultIndex(groups[0]?.packages ?? []));
  const id = useId();
  const { on } = useAudience();

  const showToggle = groups.length > 1;
  const base = groups[active] ?? groups[0];

  // Switching tabs re-seats the selection on the new group's recommended
  // package. Carrying an index across would silently select whatever happens to
  // sit at the same position in a list of different things.
  useEffect(() => {
    setSelected(defaultIndex(groups[active]?.packages ?? []));
  }, [active, groups]);

  if (!base) return null;

  // Only the words change. The packages, their order and their prices are the
  // same objects either way — a toggle that quietly altered what was on offer
  // would be a different page pretending to be the same one.
  const override = on ? audienceGroups?.[base.key] : undefined;
  const group = override
    ? { ...base, title: override.title ?? base.title, blurb: override.blurb ?? base.blurb }
    : base;

  const chosen = group.packages[selected] ?? group.packages[0];
  const money = (uzs: number) => formatSom(uzs, locale as Locale);

  // `package` carries the exact tier; `service` and `category` stay for the
  // services whose packages have no id and still resolve through
  // SERVICE_TO_PACKAGE. Without the id the booking form could only know WHICH
  // SERVICE was clicked, which is how a 250 000 click used to arrive at a
  // 400 000 form.
  const bookHref =
    `/${locale}/book?service=${encodeURIComponent(slug)}` +
    `&category=${encodeURIComponent(category)}` +
    (chosen?.id ? `&package=${encodeURIComponent(chosen.id)}` : '');
  return (
    <div>
      {showToggle && (
        <div
          role="tablist"
          aria-label={group.title}
          className="relative grid rounded-full bg-white/[0.06] p-1"
          style={{ gridTemplateColumns: `repeat(${groups.length}, minmax(0, 1fr))` }}
        >
          {/* The moving pill. Its width is exactly one track — the container's
              inner width divided by the number of tabs — so translating by 100%
              of its OWN width lands it precisely on the next one, at any
              container size and any number of groups. */}
          <span
            aria-hidden
            className="absolute inset-y-1 left-1 rounded-full transition-transform duration-300 ease-out motion-reduce:transition-none"
            style={{
              width: `calc((100% - 0.5rem) / ${groups.length})`,
              transform: `translateX(${active * 100}%)`,
              background: accentColor,
            }}
          />
          {groups.map((g, i) => (
            <button
              key={g.key}
              role="tab"
              type="button"
              id={`${id}-tab-${i}`}
              aria-selected={i === active}
              aria-controls={`${id}-panel-${i}`}
              onClick={() => setActive(i)}
              className={`relative z-10 min-h-11 rounded-full px-2 text-[13px] font-bold leading-tight transition-colors ${
                i === active ? 'text-white' : 'text-white/55 hover:text-white/85'
              }`}
            >
              {(on && audienceGroups?.[g.key]?.title) || g.title}
            </button>
          ))}
        </div>
      )}

      <div
        role={showToggle ? 'tabpanel' : undefined}
        id={showToggle ? `${id}-panel-${active}` : undefined}
        aria-labelledby={showToggle ? `${id}-tab-${active}` : undefined}
      >
        {group.blurb && (
          <p className="mt-3 px-1 text-xs leading-relaxed text-white/45">{group.blurb}</p>
        )}

        {/* aria-pressed rather than role="radio": a radiogroup promises arrow-key
            navigation, and claiming a role the component does not implement is
            worse than not claiming it. These are toggle buttons, one of which is
            on, and Tab moves between them as normal. */}
        <div className="mt-3 flex flex-col gap-1.5">
          {group.packages.map((pkg, i) => {
            const isSelected = i === selected;
            const { amount, suffix } = splitMoney(money(pkg.priceUzs));

            return (
              <div
                key={`${group.key}-${i}`}
                className="overflow-hidden rounded-xl border transition-colors"
                style={
                  isSelected
                    ? { borderColor: accentColor, background: `${accentColor}14` }
                    : { borderColor: 'rgba(255,255,255,0.1)' }
                }
              >
                <button
                  type="button"
                  aria-pressed={isSelected}
                  aria-controls={`${id}-pkg-${i}`}
                  onClick={() => setSelected(i)}
                  className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition active:bg-white/10"
                >
                  {/* Fixed width, tabular figures. This is the column the eye
                      reads down, and it only works if it cannot move. */}
                  <span className="w-[88px] shrink-0 whitespace-nowrap text-[19px] font-extrabold leading-[1.1] tabular-nums text-white">
                    {amount}
                    {suffix && (
                      // Stacked under the number, not trailing it: inline, the
                      // widest price overran the fixed column and printed over
                      // the description beside it.
                      <span className="mt-px block text-[9.5px] font-semibold text-white/45">
                        {suffix}
                      </span>
                    )}
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-bold text-white">
                      {pkg.duration}
                      {pkg.note ? ` · ${pkg.note}` : ''}
                    </span>
                    {pkg.highlight && (
                      <span
                        className="mt-0.5 block text-[10px] font-bold uppercase tracking-wider"
                        style={{ color: accentColor }}
                      >
                        {labels.mostPopular}
                      </span>
                    )}
                  </span>

                  <span
                    aria-hidden
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition"
                    style={
                      isSelected
                        ? { borderColor: accentColor, background: accentColor }
                        : { borderColor: 'rgba(255,255,255,0.25)' }
                    }
                  >
                    {isSelected && <Check className="h-3 w-3 text-white" strokeWidth={3} />}
                  </span>
                </button>

                {isSelected && (
                  <ul
                    id={`${id}-pkg-${i}`}
                    className="space-y-1.5 border-t px-3.5 py-3"
                    style={{ borderColor: `${accentColor}44` }}
                  >
                    <Detail accent={accentColor}>{pkg.photos}</Detail>
                    <Detail accent={accentColor}>{pkg.delivery}</Detail>
                    {pkg.perks?.map((perk) => (
                      <Detail key={perk} accent={accentColor}>
                        {perk}
                      </Detail>
                    ))}

                  </ul>
                )}
              </div>
            );
          })}
        </div>

        {/* Side by side, and smaller. Two stacked full-width buttons read as one
            decision asked twice; next to each other they read as what they are —
            the same booking through whichever channel you prefer. Telegram sits
            BESIDE the form rather than instead of it: for this audience in
            Tashkent a form is the unfamiliar path and a DM is the ordinary one,
            and a booking that arrives as a message is still a booking. */}
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Link
            href={bookHref}
            className="flex min-h-11 items-center justify-center gap-1.5 rounded-full px-2 text-[13px] font-bold text-white transition active:scale-[0.98]"
            style={{ background: accentColor }}
          >
            <CalendarDays className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{labels.bookShort}</span>
          </Link>
          <a
            href={`https://t.me/${CONTACT.telegram}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-h-11 items-center justify-center gap-1.5 rounded-full border border-white/25 px-2 text-[13px] font-bold text-white transition hover:border-white/60 active:scale-[0.98]"
          >
            <Send className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{labels.telegramShort}</span>
          </a>
        </div>
      </div>
    </div>
  );
}

function Detail({ children, accent }: { children: React.ReactNode; accent: string }) {
  return (
    <li className="flex items-start gap-2 text-[11.5px] leading-snug text-white/65">
      <span
        aria-hidden
        className="mt-[5px] h-1 w-1 shrink-0 rounded-full"
        style={{ background: accent }}
      />
      {children}
    </li>
  );
}
