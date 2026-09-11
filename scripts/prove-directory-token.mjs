// scripts/prove-directory-token.mjs
//
// Phase 0 of the Optimizer → ladder migration. Answers ONE question:
//
//   Which spelling of Bunny's directory token does this pull zone accept?
//
// This has to be settled before a single derivative is written, because the
// answer decides the storage layout. If one token can cover a whole gallery,
// derivatives go to /d/{galleryId}/{photoId}/{checksum8}/{width}.{ext} and a
// 300-photo page needs one signature. If it can't, the path drops galleryId
// and every photo needs its own. Choosing wrong means re-uploading everything.
//
//   node --env-file=.env.local scripts/prove-directory-token.mjs clients/sara-grad/IMG_1432.jpg
//
// Reads nothing, writes nothing, changes nothing. Pass a real file inside
// clients/ — the same kind of path verify-private-zone.mjs wants.
//
// ── Why four variants and not one ────────────────────────────
// Bunny documents directory tokens twice and the two descriptions disagree:
//
//   • The Advanced Token Authentication page describes a `token_path` QUERY
//     PARAMETER that replaces the file path as the signed `signature_path`.
//     It does not say whether token_path is ALSO included in signing_data
//     (the sorted "k=v&k=v" blob of every other parameter). Both readings are
//     defensible, so both are tested — A1 and A2 below.
//
//   • BunnyWay's own reference implementation puts the token IN THE PATH:
//     /bcdn_token=HS256-…&expires=…/rest/of/path. That is variant B.
//
// The failure mode for all of them is a silent 403 that looks identical to a
// wrong key, so guessing is not an option. Tests 0 and 1 exist to tell a
// wrong-spelling 403 apart from a wrong-key 403.
//
// This deliberately duplicates the signing logic from src/lib/bunny-sign.ts
// rather than importing it, for the reason verify-private-zone.mjs already
// gives: a test that shares an implementation with the thing it tests can only
// prove they agree with each other.

import { createHmac } from "node:crypto";

const HOST = (process.env.BUNNY_PRIVATE_PULL_ZONE ?? "").replace(/\/$/, "");
const KEY = process.env.BUNNY_PRIVATE_TOKEN_KEY;

const filePath = process.argv[2];

if (!HOST || !KEY) {
  console.error(
    "BUNNY_PRIVATE_PULL_ZONE and BUNNY_PRIVATE_TOKEN_KEY must both be set.\n" +
      "Run with:  node --env-file=.env.local scripts/prove-directory-token.mjs <path>",
  );
  process.exit(1);
}

if (!filePath) {
  console.error(
    "Pass the storage path of a real file inside clients/, e.g.\n" +
      "  node --env-file=.env.local scripts/prove-directory-token.mjs clients/sara-grad/3M0A0217.png",
  );
  process.exit(1);
}

const TTL_SECONDS = 300;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36";

// ── Path helpers — same rules as bunny-sign.ts ───────────────
// The path is HASHED decoded and REQUESTED encoded. Getting that backwards
// only breaks files with spaces or Cyrillic in the name, which is a miserable
// bug to find later.

function normalise(p) {
  return `/${String(p).replace(/^\/+/, "")}`;
}

function encodePath(decoded) {
  return decoded.split("/").map(encodeURIComponent).join("/");
}

function base64url(buf) {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

/** token = "HS256-" + base64url(HMAC-SHA256(key, signaturePath + expires + signingData)) */
function sign(signaturePath, expires, params = {}) {
  const signingData = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
  return `HS256-${base64url(
    createHmac("sha256", KEY).update(`${signaturePath}${expires}${signingData}`, "utf8").digest(),
  )}`;
}

const decodedFile = normalise(filePath);
const encodedFile = encodePath(decodedFile);

// The directory the file sits in, trailing slash included. This is what a
// gallery-wide token would sign.
const decodedDir = decodedFile.slice(0, decodedFile.lastIndexOf("/") + 1);

const expires = Math.floor(Date.now() / 1000) + TTL_SECONDS;

// ── The candidates ───────────────────────────────────────────

const tests = [];

// Test 0 — control. No token at all. MUST be refused.
// If this returns 200, token authentication is not actually enabled on the
// private zone and every "pass" below is meaningless: the zone is open.
tests.push({
  name: "0. unsigned (control — MUST fail)",
  expect: "fail",
  url: `${HOST}${encodedFile}`,
});

// Test 1 — control. Single-file token, exactly as bunny-sign.ts builds it.
// MUST pass. If it doesn't, the key or the zone is wrong and nothing else in
// this script tells you anything.
{
  const token = sign(decodedFile, expires);
  const q = new URLSearchParams({ token, expires: String(expires) });
  tests.push({
    name: "1. single-file token (control — MUST pass)",
    expect: "pass",
    url: `${HOST}${encodedFile}?${q}`,
  });
}

// Test A1 — token_path as a query parameter, INCLUDED in signing_data.
// Reading: signing_data is "every query parameter except token and expires",
// and token_path is a query parameter, so it counts.
{
  const params = { token_path: decodedDir };
  const token = sign(decodedDir, expires, params);
  const q = new URLSearchParams({ ...params, token, expires: String(expires) });
  tests.push({
    name: "A1. ?token_path= , included in signing_data",
    expect: "?",
    url: `${HOST}${encodedFile}?${q}`,
  });
}

// Test A2 — token_path as a query parameter, EXCLUDED from signing_data.
// Reading: token_path is metadata about the signature rather than part of the
// signed payload, so it is excluded like token and expires are.
{
  const token = sign(decodedDir, expires, {});
  const q = new URLSearchParams({
    token_path: decodedDir,
    token,
    expires: String(expires),
  });
  tests.push({
    name: "A2. ?token_path= , excluded from signing_data",
    expect: "?",
    url: `${HOST}${encodedFile}?${q}`,
  });
}

// Test B — the in-path form from BunnyWay's reference implementation.
// The token and expiry become a path segment before the rest of the path.
{
  const token = sign(decodedDir, expires, {});
  const rest = encodedFile.slice(encodePath(decodedDir).length);
  tests.push({
    name: "B. /bcdn_token=…&expires=…/path (in-path form)",
    expect: "?",
    url: `${HOST}${encodePath(decodedDir)}bcdn_token=${encodeURIComponent(
      token,
    )}&expires=${expires}/${rest}`,
  });
}

// ── Run ──────────────────────────────────────────────────────

async function probe(url) {
  try {
    // HEAD would be lighter, but some CDN configurations answer HEAD and GET
    // differently, and GET is what the browser will actually send.
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "image/avif,image/webp,image/*,*/*;q=0.8" },
      redirect: "follow",
    });
    if (!res.ok) {
      const body = (await res.text().catch(() => "")).trim().slice(0, 100).replace(/\s+/g, " ");
      return { ok: false, status: res.status, body };
    }
    const bytes = Buffer.from(await res.arrayBuffer()).length;
    return { ok: true, status: res.status, bytes, type: res.headers.get("content-type") ?? "—" };
  } catch (e) {
    return { ok: false, status: 0, body: `network error: ${e.message}` };
  }
}

console.log(`\nZone:      ${HOST}`);
console.log(`File:      ${decodedFile}`);
console.log(`Directory: ${decodedDir}`);
console.log(`Expires:   ${expires} (in ${TTL_SECONDS}s)\n`);
console.log("─".repeat(68) + "\n");

const results = [];

for (const t of tests) {
  const r = await probe(t.url);
  const verdict = r.ok ? "200 OK" : `${r.status || "ERR"} ${r.body ?? ""}`.trim();
  console.log(`  ${t.name}`);
  console.log(`     ${r.ok ? `PASS  ${r.bytes} bytes  ${r.type}` : `FAIL  ${verdict}`}`);
  console.log(`     ${t.url.slice(0, 150)}${t.url.length > 150 ? "…" : ""}\n`);
  results.push({ ...t, ok: r.ok });
}

// ── Interpretation ───────────────────────────────────────────

console.log("─".repeat(68));
console.log("\nReading:\n");

const control0 = results[0];
const control1 = results[1];
const candidates = results.slice(2);

if (control0.ok) {
  console.log(
    "  STOP. The UNSIGNED request succeeded, which means token authentication\n" +
      "  is not switched on for this pull zone. Every client gallery is public\n" +
      "  to anyone holding a URL right now, and the directory-token results\n" +
      "  below are meaningless because nothing is being checked.\n\n" +
      "  Fix that first: Pull Zone → Security → Token Authentication.\n",
  );
  process.exit(0);
}

if (!control1.ok) {
  console.log(
    "  STOP. The single-file token was refused, so this is not about directory\n" +
      "  tokens at all — the key, the zone or the path is wrong. Nothing below\n" +
      "  can be trusted until this control passes.\n\n" +
      "  Check BUNNY_PRIVATE_TOKEN_KEY against Pull Zone → Security → Token\n" +
      "  Authentication, and confirm the file exists at that exact path.\n",
  );
  process.exit(0);
}

console.log("  Controls are good: unsigned is refused, single-file signing works.\n");

const winners = candidates.filter((c) => c.ok);

if (winners.length === 0) {
  console.log(
    "  No directory-token spelling was accepted.\n\n" +
      "  That means one token per PHOTO, not per gallery. Derivatives should go\n" +
      "  to /d/{photoId}/{checksum8}/{width}.{ext} — drop galleryId, it buys\n" +
      "  nothing — and getGalleryContent() signs once per photo.\n\n" +
      "  Cost of that: a 300-photo gallery ships ~300 tokens instead of 1.\n" +
      "  Workable, but it makes the JSON payload noticeably fatter and it is\n" +
      "  worth checking the zone has directory tokens ENABLED before accepting\n" +
      "  it — some Bunny plans gate the feature separately.\n",
  );
} else {
  console.log(`  Directory tokens WORK. Accepted spelling(s):\n`);
  for (const w of winners) console.log(`     ✓ ${w.name}`);
  console.log(
    "\n  Use the first one. Derivatives go to\n" +
      "     /d/{galleryId}/{photoId}/{checksum8}/{width}.{ext}\n" +
      "  and one token signed over /d/{galleryId}/ covers the whole gallery —\n" +
      "  one signature per page load instead of thousands, and ClientGalleryView's\n" +
      "  existing refresh loop keeps working untouched.\n",
  );
  if (winners.length > 1) {
    console.log(
      "  NOTE: more than one spelling passed. That usually means the zone is\n" +
        "  lenient about signing_data, not that both are officially supported.\n" +
        "  Prefer A1 (token_path included) — it is the stricter reading, so it\n" +
        "  stays correct if Bunny tightens validation later.\n",
    );
  }
}

console.log(
  "  Re-run this after any Bunny security change. It is five requests and it\n" +
    "  is the only thing standing between you and a silent 403 in production.\n",
);
