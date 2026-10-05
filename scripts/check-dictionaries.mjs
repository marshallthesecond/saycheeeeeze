// Do en, ru and uz carry the same keys?
//
//   node scripts/check-dictionaries.mjs
//   node scripts/check-dictionaries.mjs --quiet    # exit code only
//
// Runs in about 30 ms and needs nothing installed. Put it in front of a push.
//
// WHY IT EXISTS. `getDictionary()` is typed to return the shape of en.json, so
// TypeScript DOES catch a missing key — but only at `next build`, as a TS2719
// reading "Two different types with this name exist, but they are unrelated",
// followed by a hundred-line type dump with the actual missing key names near
// the end. That error has now cost two Vercel builds. It is a three-word
// problem printed as an essay.
//
// Both failures were the same mistake and neither was a typo: a dictionary was
// edited starting from a STALE COPY, so keys added in an earlier session were
// silently dropped when it was written back.
//
//   2026-09-09  service.bookShort / service.telegramShort
//   2026-10-06  twelve book.* keys — the WIUTerian and ceremony toggles, the
//               CCA mini-session strings, the studio-consult line
//
// The typecheck harness could not catch either, because the harness compares an
// edit against a baseline built from the same stale source. This compares the
// three files against EACH OTHER, which has no such blind spot.
//
// It also reports values that are identical across languages — usually a key
// copied into ru/uz and never translated. Not an error: "Instagram" and
// "Telegram" are the same word everywhere.

import { readFileSync } from "node:fs";
import process from "node:process";

const LOCALES = ["en", "ru", "uz"];
const DIR = "src/lib/i18n/dictionaries";
const quiet = process.argv.includes("--quiet");

/** Every leaf path. Arrays compare by length, since they are ordered lists. */
function paths(value, prefix = "", out = new Map()) {
  if (Array.isArray(value)) {
    out.set(`${prefix}[${value.length}]`, value.join("\u0000"));
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) paths(v, prefix ? `${prefix}.${k}` : k, out);
  } else {
    out.set(prefix, String(value));
  }
  return out;
}

const dicts = {};
for (const l of LOCALES) {
  try {
    dicts[l] = paths(JSON.parse(readFileSync(`${DIR}/${l}.json`, "utf8")));
  } catch (e) {
    console.error(`\n  ${DIR}/${l}.json: ${e.message}\n`);
    process.exit(1);
  }
}

let failures = 0;
const report = [];

// en is the reference because Dictionary is derived from it — a key ru has and
// en does not is just as broken, it simply breaks differently.
for (const l of LOCALES.filter((x) => x !== "en")) {
  const missing = [...dicts.en.keys()].filter((k) => !dicts[l].has(k));
  const extra = [...dicts[l].keys()].filter((k) => !dicts.en.has(k));
  if (missing.length) {
    failures += missing.length;
    report.push([`${l}.json is MISSING ${missing.length}`, missing]);
  }
  if (extra.length) {
    failures += extra.length;
    report.push([`${l}.json has ${extra.length} en.json does not`, extra]);
  }
}

// An array whose length differs is a list someone half-translated.
for (const l of LOCALES.filter((x) => x !== "en")) {
  const shape = [...dicts.en.keys()]
    .filter((k) => k.includes("["))
    .filter((k) => !dicts[l].has(k))
    .map((k) => k.replace(/\[\d+\]$/, ""))
    .filter((base) => [...dicts[l].keys()].some((k) => k.startsWith(`${base}[`)));
  if (shape.length) {
    failures += shape.length;
    report.push([`${l}.json: list length differs`, shape]);
  }
}

if (!quiet) {
  console.log(`\n  ${LOCALES.map((l) => `${l} ${dicts[l].size}`).join("  ·  ")}\n`);
  for (const [heading, keys] of report) {
    console.log(`  ✗ ${heading}`);
    for (const k of keys.slice(0, 30)) console.log(`      ${k}`);
    if (keys.length > 30) console.log(`      … and ${keys.length - 30} more`);
    console.log("");
  }

  // Untranslated-looking values, reported but never fatal.
  const same = [...dicts.en.keys()].filter(
    (k) =>
      dicts.ru.has(k) && dicts.uz.has(k) &&
      dicts.en.get(k) === dicts.ru.get(k) && dicts.en.get(k) === dicts.uz.get(k) &&
      /[a-z]{4,}/i.test(dicts.en.get(k)) && !/^https?:/.test(dicts.en.get(k)),
  );
  if (same.length && failures === 0) {
    console.log(`  ${same.length} keys read identically in all three — check they are meant to:`);
    for (const k of same.slice(0, 12)) console.log(`      ${k.padEnd(34)} ${JSON.stringify(dicts.en.get(k)).slice(0, 44)}`);
    if (same.length > 12) console.log(`      … and ${same.length - 12} more`);
    console.log("");
  }
}

if (failures > 0) {
  if (!quiet) {
    console.log(`  ${failures} problems. \`next build\` would fail on this with a TS2719`);
    console.log("  in src/lib/i18n/dictionaries.ts that does not name the keys.\n");
  }
  process.exit(1);
}

if (!quiet) console.log("  All three dictionaries carry the same keys.\n");
