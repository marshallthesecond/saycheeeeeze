# saycheeeeeze

The website for a photographer working in Tashkent. It shows the portfolio,
takes bookings, and hands finished work to clients through passkey-gated
galleries.

Next.js 16 (App Router), React 19, TypeScript, Tailwind 4. Photographs live in
Bunny.net storage and are served from two CDN pull zones; everything else lives
in Supabase.

---

## Getting it running

```bash
pnpm install
cp .env.example .env.local     # then fill it in — see Environment below
pnpm dev                       # http://localhost:3000
```

`/` redirects to `/ru`. The three locales are `ru` (default), `en` and `uz`.

## How it fits together

**Three languages, one tree.** Every page lives under `src/app/[locale]/`.
`src/proxy.ts` redirects a bare URL to the right prefix — saved cookie first,
then `Accept-Language`, then the default. Copy is resolved on the server from
`src/lib/i18n/dictionaries/*.json`, so only the active language reaches the
browser.

**Photographs are not in this repo.** The Bunny storage zone is the source of
truth. `scripts/reseed.ts` walks it and makes Supabase match: a folder holding
images becomes a gallery, each image becomes a `photos` row.

**Nothing is resized on the fly.** `scripts/build-ladder.mjs` turns each
original into a fixed ladder of derivatives — six AVIF widths, six WebP, a
`share.jpg` and a `download.jpg` — and records the dimensions, a ThumbHash and
the variant list on the row. Pages read those, so `next/image` never has to
transform anything and there is no per-image cost at the edge.

**Derivative paths are content-addressed.** They carry the original's checksum
and a ladder revision, so nothing at a given URL ever changes and the files can
be cached for a year without a purge. Change the encoder settings and you bump
`LADDER_REV`; new files land at new URLs and the old ones age out.

**Client galleries are private by construction.** They are keyed on
`galleries.kind`, not on a visibility flag: anything belonging to a client is
stored under `clients/`, and the public pull zone has an edge rule refusing any
URL containing that segment. Their derivatives are only reachable from the
private zone, with a signed token that expires in six hours. Flipping a column
cannot expose them, because the path decides.

A visitor trades a passkey for a cookie at `/api/galleries/unlock`; the passkey
itself is bcrypt-hashed in Postgres and checked by `unlock_gallery()`, which
rate-limits by slug and IP. The page then re-signs its URLs in the background,
so a tab left open overnight still works in the morning.

**Bookings are priced on the server.** The form sends a package id and never a
price. `/api/booking` resolves the price and the duration from the catalogue or
the database, and the INSERT itself is the lock on the day — a clash raises a
unique-violation and comes back as a 409 rather than a double booking. The
`bookings` table has RLS on with no policies; pages read it through the
service-role client and send down only `{ date, status }`.

## Layout

```
src/
  proxy.ts                locale redirect (Next 16's replacement for middleware)
  app/
    [locale]/             every page — about, portfolio, albums, services,
                          book, galleries
    api/                  booking, gallery unlock, gallery photos, sync
  components/common/      the shared UI: grid, lightbox, sheets, bottom nav
  lib/
    albums.ts             portfolio and album reads
    client-galleries.ts   client gallery reads, signed
    ladder.ts             derivative ladder: srcset, tiers, sizes
    bunny-sign.ts         Bunny token signing
    gallery-access.ts     the unlock cookie
    services.ts           the service catalogue and its packages
    i18n/                 dictionaries and the locale provider
scripts/                  seeding, the ladder build, and the verifiers
supabase/                 migrations and config
```

## Scripts

Each takes `--help`-ish flags documented in its own header. All of them want
`--env-file=.env.local` on Node 20+.

| | |
|---|---|
| `reseed.ts` | walk the storage zone, make Supabase match |
| `build-ladder.mjs` | build derivatives for everything pending |
| `ladder-status.mjs` | read-only: is the build landing, is the prune running |
| `backfill-blur.mjs` | fill in blur placeholders |
| `probe-colour.mjs` | what colour space are the originals in |
| `diagnose-bunny.mjs` | work out why a pull zone is returning 403 |
| `verify-private-zone.mjs` | prove the Bunny zones are configured as intended |
| `verify-client-gallery.mjs` | walk the whole private-gallery journey end to end |
| `prove-directory-token.mjs` | which directory-token spelling this zone accepts |

`verify-client-gallery.mjs` is the one to run after touching anything on the
private path. Steps 6 and 7 are the load-bearing ones: if either fails, a
client's photographs are readable by anyone holding a URL.

## Environment

`.env.local`, never committed.

| | |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon / publishable key — RLS applies |
| `SUPABASE_SERVICE_ROLE_KEY` | secret key, bypasses RLS. Seed and sync only |
| `NEXT_PUBLIC_BUNNY_PULL_ZONE` | public CDN host |
| `BUNNY_PRIVATE_PULL_ZONE` | private CDN host, for client galleries |
| `BUNNY_PRIVATE_TOKEN_KEY` | token-auth key for the private zone |
| `BUNNY_STORAGE_ZONE` | storage zone name |
| `BUNNY_STORAGE_API_KEY` | storage password, for uploads |
| `GALLERY_COOKIE_SECRET` | signs the gallery unlock cookie |
| `REVALIDATE_SECRET` | authenticates `/api/sync` |
| `TELEGRAM_BOT_TOKEN` | the bot that sends booking notifications |
| `TELEGRAM_BOT_USERNAME` | used to build the client's deep link |
| `TELEGRAM_ADMIN_CHAT_ID` | where admin notifications go |
| `IP_HASH_SALT` | salts the hashed IP on booking attempts |
| `NEXT_PUBLIC_SITE_URL` | production origin, for canonical and OG URLs |
| `GOOGLE_SERVICE_EMAIL`, `GOOGLE_PRIVATE_KEY`, `GOOGLE_SHEET_ID` | booking mirror into a sheet |

Supabase renamed its keys; `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and
`SUPABASE_SECRET_KEY` are accepted as aliases for the two above.

## Working on it

This is Next 16. The conventions moved — `middleware.ts` is now `proxy.ts` and
defaults to the Node runtime, `cacheLife` takes a profile argument, and a few
other things besides. `AGENTS.md` says the same thing more bluntly: read
`node_modules/next/dist/docs/` rather than trusting what you remember.

Every string a visitor reads comes from a dictionary. Adding copy means adding
the key to all three of `en.json`, `ru.json` and `uz.json` — a missing key
renders as the key itself, which is loud on purpose.
