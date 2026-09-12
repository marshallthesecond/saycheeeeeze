// Proves the Bunny half of the setup is actually configured rather than
// looking configured. Run after any change to either pull zone:
//
//   node --env-file=.env.local scripts/verify-private-zone.mjs clients/sara-grad/IMG_1432.jpg
//
// Five requests, each checked. Test 3 is the one that matters — if it fails,
// everything else in the system is decoration.
//
// The signing logic is duplicated from src/lib/bunny-sign.ts on purpose. A
// test sharing its implementation with the thing it tests can only show the
// two agree, not that either is right; a disagreement here is the finding.

import { createHmac } from "node:crypto";

const PRIVATE_HOST = process.env.BUNNY_PRIVATE_PULL_ZONE;
const PUBLIC_HOST = process.env.NEXT_PUBLIC_BUNNY_PULL_ZONE;
const KEY = process.env.BUNNY_PRIVATE_TOKEN_KEY;

const path = process.argv[2];

if (!path) {
  console.error(
    "Pass the storage path of a real file inside clients/, e.g.\n" +
      "  node --env-file=.env.local scripts/verify-private-zone.mjs clients/sara-grad/IMG_1432.jpg",
  );
  process.exit(1);
}

for (const [name, value] of Object.entries({
  BUNNY_PRIVATE_PULL_ZONE: PRIVATE_HOST,
  NEXT_PUBLIC_BUNNY_PULL_ZONE: PUBLIC_HOST,
  BUNNY_PRIVATE_TOKEN_KEY: KEY,
})) {
  if (!value) {
    console.error(`${name} is not set. Check .env.local.`);
    process.exit(1);
  }
}

if (!path.startsWith("clients/")) {
  console.error(`"${path}" is not under clients/. That's the prefix this whole scheme keys on.`);
  process.exit(1);
}

const b64url = (b) =>
  b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");

function sign(storagePath, expires, params = {}) {
  const p = `/${storagePath.replace(/^\/+/, "")}`;
  const signingData = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
  const token = `HS256-${b64url(
    createHmac("sha256", KEY).update(`${p}${expires}${signingData}`, "utf8").digest(),
  )}`;
  const q = new URLSearchParams(params);
  q.set("token", token);
  q.set("expires", String(expires));
  const encoded = p.split("/").map(encodeURIComponent).join("/");
  return `${PRIVATE_HOST.replace(/\/$/, "")}${encoded}?${q.toString()}`;
}

async function status(url) {
  try {
    // GET, not HEAD: some CDN configurations answer HEAD differently, and a
    // test that passes on HEAD while GET leaks is the worst possible result.
    const res = await fetch(url, { redirect: "manual" });
    return res.status;
  } catch (err) {
    return `network error: ${err.message}`;
  }
}

const now = Math.floor(Date.now() / 1000);
const results = [];

function check(label, actual, expected, note) {
  const pass = Array.isArray(expected) ? expected.includes(actual) : actual === expected;
  results.push({ label, actual, expected, pass, note });
  const mark = pass ? "PASS" : "FAIL";
  console.log(`${mark}  ${label}`);
  console.log(`      got ${actual}, expected ${Array.isArray(expected) ? expected.join(" or ") : expected}`);
  if (!pass && note) console.log(`      → ${note}`);
  console.log();
}

console.log(`\nChecking ${path}\n`);

// 1. A valid signature opens the file.
check(
  "Signed URL on the private zone is served",
  await status(sign(path, now + 600)),
  200,
  "Token auth key mismatch, or the file isn't at that path. Re-copy the key from " +
    "Pull Zone → Security → URL Token Authentication Key.",
);

// 2. No signature, no file.
check(
  "Unsigned URL on the private zone is refused",
  await status(`${PRIVATE_HOST.replace(/\/$/, "")}/${path}`),
  403,
  "Token Authentication is OFF on the private pull zone. Everything below is moot until it's on.",
);

// 3. THE ONE THAT MATTERS. The public zone must not know this file exists.
check(
  "Public zone refuses the same file",
  await status(`${PUBLIC_HOST.replace(/\/$/, "")}/${path}`),
  [403, 404],
  "Your public pull zone is serving clients/ files to anyone. Add the Edge Rule: " +
    "Block Request when Request URL matches */clients/*. Nothing else in this " +
    "system compensates for this.",
);

// 4. An expired token is dead.
check(
  "Expired signature is refused",
  await status(sign(path, now - 60)),
  403,
  "Expiry isn't being enforced — check the zone is on Advanced token auth.",
);

// 5. A tampered parameter invalidates the signature.
const tampered = `${sign(path, now + 600)}&width=400`;
check(
  "Signed URL with an appended parameter is refused",
  await status(tampered),
  403,
  "If this returns 200, parameters aren't covered by the signature — which is " +
    "fine for security but means you could simplify thumbSrc away. Verify before relying on it.",
);

const failed = results.filter((r) => !r.pass);

if (failed.length === 0) {
  console.log("All five passed. The private zone is configured correctly.\n");
  process.exit(0);
}

console.log(`${failed.length} of ${results.length} failed:`);
for (const r of failed) console.log(`  - ${r.label}`);
console.log("\nDo not deliver a private gallery until these pass.\n");
process.exit(1);
