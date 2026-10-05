// Which service copy is still English in /ru and /uz.
//
//   npx tsx scripts/check-translations.ts
//   npx tsx scripts/check-translations.ts --quiet     # exit code only, for CI
//
// WHY THIS CANNOT BE A TYPE ERROR. `Localized` is deliberately
// `string | { en, ru?, uz? }` so a field can be converted one at a time, and a
// bare string legitimately means "the same in every language" — "WIUT",
// "Instagram", a price. The type system cannot tell that apart from an English
// sentence nobody has translated yet, and `pickLocale` returns it either way.
//
// So the failure is silent and total: /ru is the DEFAULT LOCALE, which means a
// Tashkent visitor gets a Russian shell — nav, buttons, prices, durations, all
// correct, because those come from the dictionaries and from service-format.ts
// — wrapped around an English H1, tagline, intro, "what's included", "how to
// prepare" and every FAQ. It looks deliberate rather than broken. It went
// unnoticed on fifteen of the sixteen service pages from launch until
// 2026-10-05.
//
// This is the check that would have caught it. Run it when you add a service.

import { servicesData, type Localized, type ServiceData } from "../src/lib/services";

const LOCALES = ["ru", "uz"] as const;

/**
 * A bare string that is fine as-is: a proper noun, a brand, a format.
 *
 * Kept deliberately short. The point of the list is that adding to it is a
 * decision you make once and can be questioned later, rather than the check
 * quietly passing everything with no letters in it.
 */
const SAME_IN_EVERY_LANGUAGE = /^(WIUT|CCA|Instagram|Telegram|TikTok|LinkedIn|[\d\s.,–—-]+)$/;

type Finding = { slug: string; field: string; text: string };

function check(value: Localized | undefined, slug: string, field: string, out: Finding[]) {
  if (value === undefined) return;
  if (typeof value === "string") {
    if (!SAME_IN_EVERY_LANGUAGE.test(value.trim())) {
      out.push({ slug, field, text: value });
    }
    return;
  }
  for (const l of LOCALES) {
    if (!value[l] || !value[l]!.trim()) {
      out.push({ slug, field: `${field} (no ${l})`, text: value.en });
    }
  }
}

function walk(s: ServiceData, out: Finding[]) {
  check(s.title, s.slug, "title", out);
  check(s.tagline, s.slug, "tagline", out);
  check(s.description, s.slug, "description", out);
  (s.includes ?? []).forEach((v, i) => check(v, s.slug, `includes[${i}]`, out));
  (s.howToPrepare ?? []).forEach((v, i) => check(v, s.slug, `howToPrepare[${i}]`, out));
  (s.faqs ?? []).forEach((f, i) => {
    check(f.question, s.slug, `faqs[${i}].question`, out);
    check(f.answer, s.slug, `faqs[${i}].answer`, out);
  });
  // Package copy too. standardTiers() emits none of these, so in practice this
  // only catches a service with hand-written tiers — graduation today.
  const groups = s.packageGroups ?? [];
  groups.forEach((g, gi) => {
    check(g.title, s.slug, `packageGroups[${gi}].title`, out);
    g.packages.forEach((p, pi) => {
      check(p.duration, s.slug, `packageGroups[${gi}].packages[${pi}].duration`, out);
      check(p.note, s.slug, `packageGroups[${gi}].packages[${pi}].note`, out);
      (p.perks ?? []).forEach((x, xi) =>
        check(x, s.slug, `packageGroups[${gi}].packages[${pi}].perks[${xi}]`, out));
    });
  });
  (s.packages ?? []).forEach((p, pi) => {
    check(p.duration, s.slug, `packages[${pi}].duration`, out);
    check(p.note, s.slug, `packages[${pi}].note`, out);
    (p.perks ?? []).forEach((x, xi) => check(x, s.slug, `packages[${pi}].perks[${xi}]`, out));
  });
  if (s.audience) {
    check(s.audience.prompt, s.slug, "audience.prompt", out);
    check(s.audience.eyebrow, s.slug, "audience.eyebrow", out);
    check(s.audience.description, s.slug, "audience.description", out);
  }
  if (s.hero) check(s.hero.eyebrow, s.slug, "hero.eyebrow", out);
  if (s.event) {
    check(s.event.venue, s.slug, "event.venue", out);
    check(s.event.note, s.slug, "event.note", out);
  }
}

const quiet = process.argv.includes("--quiet");
const findings: Finding[] = [];
for (const s of servicesData) walk(s, findings);

const byService = new Map<string, Finding[]>();
for (const f of findings) byService.set(f.slug, [...(byService.get(f.slug) ?? []), f]);

if (!quiet) {
  console.log(`\n  ${servicesData.length} services, ru + uz\n`);
  for (const s of servicesData) {
    const bad = byService.get(s.slug) ?? [];
    const label = typeof s.title === "string" ? s.title : s.title.en;
    console.log(
      bad.length === 0
        ? `  ok   ${s.slug.padEnd(24)} ${label}`
        : `  ✗    ${s.slug.padEnd(24)} ${bad.length} untranslated`,
    );
    for (const f of bad.slice(0, 40)) {
      console.log(`         ${f.field.padEnd(28)} ${JSON.stringify(f.text.slice(0, 60))}`);
    }
  }
  console.log("");
}

if (findings.length > 0) {
  if (!quiet) {
    console.log(`  ${findings.length} strings would render in English on /ru and /uz.`);
    console.log("  /ru is the default locale, so this is what most visitors see.\n");
  }
  process.exit(1);
}

if (!quiet) console.log("  Every service reads in all three languages.\n");
