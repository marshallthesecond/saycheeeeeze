# What changed

Two things happened here: the scrollytelling design became the landing page, and
the launch-blocking items on the checklist got fixed. The palette from the
landing design was then pushed through the rest of the app so the site reads as
one piece rather than a new front door bolted onto an old house.

---

## 1. The landing page

`/` (i.e. `/en`, `/ru`, `/uz`) is now the 3D camera scrollytelling page. The
about page is untouched and still lives at `/about`.

**New files**

| File | What it does |
|---|---|
| `src/app/[locale]/landing/CameraScene.tsx` | The Three.js scene — sticky canvas, camera assembles, fires, then explodes into labelled parts |
| `src/app/[locale]/landing/LandingPage.tsx` | The ten scroll panes, header, service tiers, footer |
| `public/landing/photo-1…6.jpg` | Crops from your existing portfolio images, used as the textures on the photos the camera ejects |

`src/app/[locale]/page.tsx` used to re-export the about page; it now renders the
landing page.

**Things worth knowing about the scene**

- It loads `three` dynamically, so the 3D code isn't in the initial bundle.
- If WebGL is missing or throws, the canvas is skipped and the text panes still
  scroll normally. Nothing is behind the 3D.
- `prefers-reduced-motion` turns off the idle bob, sway and dust, and makes
  scroll progress track directly instead of easing.
- Geometry is simplified below 820px so mid-range phones don't drop frames.
- The choreography assumes roughly ten screens of scroll. If you add or remove a
  pane, the timing constants at the top of `frame()` in `CameraScene.tsx` need
  moving to match — they're plain numbers from 0 to 1 with comments.

**All copy is translated.** English, Russian and Uzbek, in
`src/lib/i18n/dictionaries/*.json` under the `landing` key. Prices are written
per language (`so'm` / `сум`).

---

## 2. Booking fixes

- **The date bug.** The summary and the confirmation screen were building the
  date from the calendar's *view* month plus the raw ISO string, so a booking on
  14 August could read "August 2026-08-14". There's now one `useDateFormatter`
  hook that formats from the ISO date alone, with month names from the active
  dictionary.
- **Double bookings.** The API already returned 409 when a slot was taken; the
  form treated it as a generic failure and told the person to try again — which
  would fail identically forever. It now catches 409 specifically, clears the
  chosen time, and says the slot was just taken.
- **Timezone.** Both the calendar and the form's initial month came from
  `new Date()`, which is the *visitor's* device. A visitor in a different
  timezone got a calendar whose "today" disagreed with the server's, producing a
  hydration mismatch and occasionally greying out the wrong day. There's now
  `todayInTashkent()` in `src/lib/availability.ts`, and both use it.
- **Spam.** A honeypot field (off-screen, `tabIndex={-1}`, `aria-hidden`) plus a
  per-IP cap of 3 submissions a day. A filled honeypot gets a fake success so
  bots don't learn to work around it. **Caveat:** the cap lives in server memory,
  so it's per instance — it stops accidental double-taps and casual scripts, not
  a determined flood. If that ever becomes a real problem, move the counter to
  Upstash or similar.
- **Russian and Uzbek.** The booking flow had English hardcoded in about thirty
  places — the calendar legend, duration and time labels, error messages, the
  confirmation screen, the inspiration filters. All wired to the dictionary;
  20 new `book.*` keys plus `book.aria.*` for screen-reader day descriptions.
- Removed dead imports and the unused `DAYS` constant.

---

## 3. One palette

The landing design's warm near-black and amber accent now drive the whole app
through `src/app/globals.css`. Everything is a token — change `--sc-accent`
there and every button, link and 3D trim moves with it.

Swapped out: the navy `#000521` / `#021024` page backgrounds, the blue gradient
washes, and the black `bg-black` pages (portfolio, about, albums, services, 404,
loading and error states, bottom nav, sticky headers).

**Kept deliberately:** the green/amber/red in the calendar. Those aren't brand
colours, they're status — free, held, booked — and recolouring them to a single
accent would lose the meaning. The *selected* chip did move to amber, since
that's a control rather than a status.

Fonts are now Instrument Serif for display, IBM Plex Sans for body, IBM Plex
Mono for the small uppercase labels, matching the design. They're loaded through
`next/font`, so no layout shift.

---

## 4. Other fixes

- **Sitemap** listed one copy of each URL with no locale. It now emits all three
  and cross-links them with `hreflang` alternates — without that, Google treats
  the three languages as duplicate pages and picks one at random.
- **404 page** was English-only and linked to non-localised paths. It now reads
  the dictionary and keeps visitors in their language.
- **Portfolio grid** shuffled with `Math.random()` during render, so the server
  and browser produced different orders and React discarded the server HTML on
  hydration. It's now a seeded shuffle keyed to the calendar day — same order
  everywhere, rotates at midnight.
- **Lightbox** had two `setState`-inside-effect patterns; the reduced-motion one
  is now `useSyncExternalStore` and the drag reset happens during render.
- **Deleted:** `src/lib/db/`, `src/lib/scheduling/`, the top-level `lib/`
  Supabase files, and `src/app/home/` — all unreachable. Dropped the
  `@supabase/*` and `drizzle-orm`/`postgres` dependencies with them.
- Added `three` and `@types/three`.

`npx tsc --noEmit`, `npx eslint .` and `npm run build` are all clean —
82 pages, three locales.

---

## Before you launch

1. **`npm install`.** Dependencies changed, and `package-lock.json` is
   regenerated in this bundle.
2. **The testimonials are placeholders.** `src/lib/testimonials.ts` ships with
   three invented Tashkent clients. The landing page shows the first two. Real
   quotes or an empty array — the section hides itself when the file is empty —
   but don't launch with the fakes.
3. **`NEXT_PUBLIC_SITE_URL`** has to be your real domain, or the sitemap,
   `hreflang` tags and the Telegram approve/decline links all point at the
   fallback.
4. Service descriptions on `/services/[slug]` are still English in all three
   locales. The page furniture is translated; the body copy in
   `src/lib/services.ts` isn't. It's a content job, not a code one.
