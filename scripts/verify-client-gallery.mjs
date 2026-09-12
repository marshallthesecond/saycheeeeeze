// Walks the entire private client gallery journey and checks the security
// property at each step, rather than clicking through and hoping.
//
//   npm run dev                                     # in another terminal
//   node --env-file=.env.local scripts/verify-client-gallery.mjs sara-grad THECODE
//
// Optional: --base http://localhost:3000
//
// Writes nothing. The passkey and the signed tokens are never printed — a test
// that leaks the thing it tests is worse than no test.
//
// Every check below can be true on its own while the journey is still broken,
// which is why they run in sequence:
//
//   0  the locked page leaks no photo URL             (the gate is a real gate)
//   1  the photos endpoint refuses a cookieless call  (the whole point)
//   2  a wrong passkey is refused                     (the bcrypt path works)
//   3  the right passkey mints a cookie               (unlock works)
//   4  the endpoint then returns photos               (the cookie is honoured)
//   5  a signed derivative actually loads             (token_path spelling)
//   6  the SAME url without the token is refused      (signing is load-bearing)
//   7  the public zone refuses the same path          (edge rule is load-bearing)
//   8  download.jpg loads and really is a JPEG        (the delivery file exists)
//   9  the cover is signed and loads                  (the hero)
//  10  signedUntil is a sane deadline                 (the re-sign loop has a clock)
//
// Steps 6 and 7 are the ones that matter. If either fails, a client's photos
// are readable by anyone holding a URL.

import process from "node:process";

// args
// Parsed in one pass so that a value belonging to a flag can never be mistaken
// for a positional argument — which is exactly how a passkey ends up being
// read as a base URL.
const argv = process.argv.slice(2);
const positional = [];
let BASE = "http://localhost:3000";

for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--base") {
    BASE = argv[++i] ?? BASE;
  } else if (argv[i].startsWith("--")) {
    console.error(`Unknown flag: ${argv[i]}`);
    process.exit(1);
  } else {
    positional.push(argv[i]);
  }
}

const SLUG = positional[0];
const CODE = positional[1];
BASE = BASE.replace(/\/$/, "");
const PUBLIC_ZONE = (process.env.NEXT_PUBLIC_BUNNY_PULL_ZONE ?? "").replace(/\/$/, "");

if (!SLUG || !CODE) {
  console.error(
    "Usage: node --env-file=.env.local scripts/verify-client-gallery.mjs <slug> <passkey> [--base URL]",
  );
  process.exit(1);
}

let passed = 0;
let failed = 0;

const ok = (label, detail = "") => {
  passed++;
  console.log(`  PASS  ${label}${detail ? `  — ${detail}` : ""}`);
};
const bad = (label, detail = "") => {
  failed++;
  console.log(`  FAIL  ${label}${detail ? `  — ${detail}` : ""}`);
};
const skip = (label, detail = "") =>
  console.log(`  SKIP  ${label}${detail ? `  — ${detail}` : ""}`);

/** Never print a token or a passkey. */
const redact = (url) =>
  url.replace(/([?&])(token|expires|token_path)=[^&]*/g, "$1$2=…");

async function probe(url, init = {}) {
  try {
    const res = await fetch(url, { redirect: "manual", ...init });
    return { status: res.status, res };
  } catch (e) {
    return { status: 0, error: e.message };
  }
}

function finish() {
  console.log(`\n${passed} passed, ${failed} failed.\n`);
  if (failed > 0) {
    console.log(
      "Steps 6 and 7 are the security ones. If either failed, a client gallery\n" +
        "is readable by anyone holding a URL — fix that before anything else.\n",
    );
    process.exitCode = 1;
  }
}

console.log(`\nClient gallery journey — ${SLUG} @ ${BASE}\n`);

// 0. the locked page must not ship the photos it is hiding
// A gate that renders the real page and hides it with CSS is not a gate. This
// looks for the private zone's hostname anywhere in the server-rendered HTML.
{
  const privateHost = (process.env.BUNNY_PRIVATE_PULL_ZONE ?? "")
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "");
  const { status, res, error } = await probe(`${BASE}/en/galleries/${encodeURIComponent(SLUG)}`);
  if (error) {
    bad("0  locked page", `${error} — is \`npm run dev\` running at ${BASE}?`);
    finish();
    process.exit(1);
  }
  if (!privateHost) {
    skip("0  locked page", "BUNNY_PRIVATE_PULL_ZONE not set");
  } else if (status !== 200) {
    bad("0  locked page", `expected 200, got ${status}`);
  } else {
    const html = await res.text();
    if (html.includes(privateHost))
      bad("0  LOCKED PAGE CONTAINS PRIVATE-ZONE URLS", "the gate renders the photos it hides");
    else ok("0  locked page leaks no photo URL");
  }
}

// 1. the endpoint must refuse an anonymous caller
{
  const { status } = await probe(`${BASE}/api/galleries/${encodeURIComponent(SLUG)}/photos`);
  if (status === 401) ok("1  photos endpoint refuses a cookieless call", "401");
  else if (status === 404)
    bad("1  photos endpoint", "404 — wrong slug, or the gallery is not published");
  else if (status === 410) bad("1  photos endpoint", "410 — the gallery has expired");
  else if (status === 200)
    bad("1  photos endpoint returned 200 WITHOUT a cookie", "visibility is not 'private'");
  else bad("1  photos endpoint", `expected 401, got ${status}`);
}

// 2. a wrong passkey must be refused
{
  const { status } = await probe(`${BASE}/api/galleries/unlock`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slug: SLUG, code: `${CODE}-definitely-wrong` }),
  });
  if (status === 401) ok("2  wrong passkey refused", "401");
  else if (status === 429)
    bad("2  wrong passkey", "429 — rate limited; wait it out, then re-run");
  else if (status === 503)
    bad("2  wrong passkey", "503 — unlock_gallery() is missing or erroring in Postgres");
  else if (status === 200)
    bad("2  A WRONG PASSKEY WAS ACCEPTED", "the gate is not checking anything");
  else bad("2  wrong passkey", `expected 401, got ${status}`);
}

// 3. the right passkey mints a cookie
let cookie = null;
{
  const { status, res, error } = await probe(`${BASE}/api/galleries/unlock`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slug: SLUG, code: CODE }),
  });
  if (status !== 200) {
    bad("3  unlock with the real passkey", error ?? `got ${status}`);
    console.log("\nCannot continue without a cookie.\n");
    finish();
    process.exit(1);
  }
  const setCookies = res.headers.getSetCookie?.() ?? [];
  const jar = setCookies.map((c) => c.split(";")[0]).join("; ");
  if (!jar) {
    bad("3  unlock returned no Set-Cookie");
    finish();
    process.exit(1);
  }
  cookie = jar;
  const flags = setCookies[0].toLowerCase();
  ok("3  unlock mints a cookie", setCookies[0].split("=")[0]);
  if (flags.includes("httponly")) ok("3b cookie is httpOnly");
  else bad("3b cookie is NOT httpOnly", "page scripts can read the access token");
}

// 4. with the cookie, photos come back
let payload = null;
{
  const { status, res } = await probe(
    `${BASE}/api/galleries/${encodeURIComponent(SLUG)}/photos`,
    { headers: { cookie } },
  );
  if (status !== 200) {
    bad("4  photos with the cookie", `expected 200, got ${status}`);
    finish();
    process.exit(1);
  }
  payload = await res.json();
  const n = Array.isArray(payload.photos) ? payload.photos.length : 0;
  if (n > 0) ok("4  photos returned with the cookie", `${n} photo(s)`);
  else bad("4  photos returned with the cookie", "empty list");
}

const first = payload.photos?.[0];
const ladder = first?.ladder;

if (!ladder?.base || !ladder.widths?.length) {
  bad("5–8  ladder", "the first photo has no ladder — run build-ladder.mjs for this gallery");
} else {
  const widest = ladder.widths[ladder.widths.length - 1];
  const signed = `${ladder.base}/${widest}.avif${ladder.query}`;

  // 5. the signed derivative loads
  {
    const { status, error } = await probe(signed);
    if (status === 200) ok("5  signed derivative loads", `${widest}.avif`);
    else bad("5  signed derivative", `${error ?? `got ${status}`} — ${redact(signed)}`);
  }

  // 6. the same file WITHOUT the token must be refused
  {
    const { status } = await probe(`${ladder.base}/${widest}.avif`);
    if (status === 403 || status === 401) ok("6  same file unsigned is refused", `${status}`);
    else if (status === 200)
      bad("6  THE SAME FILE LOADS WITHOUT A TOKEN", "token auth is off on the private zone");
    else bad("6  same file unsigned", `expected 403, got ${status}`);
  }

  // 7. the public zone must refuse it too
  if (PUBLIC_ZONE) {
    const path = ladder.base.replace(/^https?:\/\/[^/]+/, "");
    const { status } = await probe(`${PUBLIC_ZONE}${path}/${widest}.avif`);
    if (status >= 400) ok("7  public zone refuses the client path", `${status} — edge rule works`);
    else
      bad("7  PUBLIC ZONE SERVED A CLIENT DERIVATIVE", `${status} — the */clients/* edge rule is missing`);
  } else {
    skip("7  public zone", "NEXT_PUBLIC_BUNNY_PULL_ZONE not set");
  }

  // 8. the delivery JPEG exists and really is a JPEG
  {
    const url = `${ladder.base}/download.jpg${ladder.query}`;
    const { status, res } = await probe(url);
    const type = res?.headers.get("content-type") ?? "";
    if (status === 200 && type.includes("jpeg")) ok("8  download.jpg loads", type);
    else if (status === 200) bad("8  download.jpg", `loads but content-type is ${type}`);
    else bad("8  download.jpg", `expected 200, got ${status}`);
  }
}

// 9. the cover is signed and loads
{
  const cl = payload.coverLadder;
  if (cl?.base && cl.widths?.length) {
    const w = cl.widths[Math.min(3, cl.widths.length - 1)];
    const { status } = await probe(`${cl.base}/${w}.avif${cl.query}`);
    if (status === 200) ok("9  signed cover loads", `${w}.avif`);
    else bad("9  signed cover", `expected 200, got ${status}`);
  } else if (payload.cover) {
    skip("9  cover", "no ladder — falls back to the original file");
  } else {
    bad("9  cover", "none returned at all");
  }
}

// 10. the refresh loop has a deadline to work from
{
  const until = payload.signedUntil;
  const now = Math.floor(Date.now() / 1000);
  if (typeof until !== "number") {
    bad("10 signedUntil", "missing — the page will never re-sign");
  } else {
    const hours = (until - now) / 3600;
    if (hours > 0.5 && hours < 24) ok("10 signedUntil is a sane deadline", `${hours.toFixed(1)}h`);
    else bad("10 signedUntil", `${hours.toFixed(1)}h from now — expected ~6h`);
  }
}

finish();
