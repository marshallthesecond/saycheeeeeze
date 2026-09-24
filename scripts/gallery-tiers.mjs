// What each client gallery hands over, and switching originals on or off.
//
//   node --env-file=.env.local scripts/gallery-tiers.mjs
//   node --env-file=.env.local scripts/gallery-tiers.mjs <slug> --originals
//   node --env-file=.env.local scripts/gallery-tiers.mjs <slug> --no-originals
//   node --env-file=.env.local scripts/gallery-tiers.mjs <slug> --downloads-off
//   node --env-file=.env.local scripts/gallery-tiers.mjs <slug> --downloads-on
//
// WHY ORIGINALS ARE OFF BY DEFAULT: galleries.download_tiers defaults to
// {share,full}. That is a decision, not an oversight — originals are 5-38 MB
// untouched camera files kept as an upsell, so a new gallery never hands them
// out until you say so. Every new client gallery starts this way; this is the
// switch, and forgetting it is why "the originals are missing" recurs.
//
//   share     2048px q82      ~150-500 KB    posting, messaging
//   full      download.jpg    ~3-5 MB        printing, cropping
//   original  untouched       5-38 MB        archive, a retoucher
//
// Nothing here is cached — getClientGallery() is a plain function and
// /galleries/[slug] is force-dynamic — so a change is live on the next reload.
// No /api/sync call, no redeploy, no clearing .next.

import process from "node:process";
import { createClient } from "@supabase/supabase-js";

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;

if (!URL_ || !KEY) {
  console.error("Missing Supabase env. Run with --env-file=.env.local");
  process.exit(1);
}

const db = createClient(URL_, KEY, { auth: { persistSession: false } });

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const slug = argv.find((a) => !a.startsWith("--")) ?? null;

const COLUMNS = "slug, title, visibility, is_published, is_listed, download_enabled, download_tiers";

// List

if (!slug) {
  const { data, error } = await db
    .from("galleries")
    .select(COLUMNS)
    .eq("kind", "client")
    .order("slug");

  if (error) {
    console.error(`Supabase: ${error.message}`);
    process.exit(1);
  }
  if (!data?.length) {
    console.log("\n  No client galleries.\n");
    process.exit(0);
  }

  console.log("\n  slug                  downloads  tiers                     visibility\n");
  for (const g of data) {
    const tiers = Array.isArray(g.download_tiers) && g.download_tiers.length
      ? g.download_tiers.join(",")
      : "(default: share,full)";
    const on = g.download_enabled === false ? "OFF" : "on ";
    const vis = g.visibility === "private" ? "private" : "PUBLIC ← no passkey!";
    console.log(`  ${String(g.slug).padEnd(21)} ${on.padEnd(10)} ${tiers.padEnd(25)} ${vis}`);
  }
  console.log("\n  Originals are the tier that is off unless you turned it on:");
  console.log("    node --env-file=.env.local scripts/gallery-tiers.mjs <slug> --originals\n");
  process.exit(0);
}

// Change

const { data: before, error: readErr } = await db
  .from("galleries")
  .select(COLUMNS + ", kind")
  .eq("slug", slug)
  .maybeSingle();

if (readErr) {
  console.error(`Supabase: ${readErr.message}`);
  process.exit(1);
}
if (!before) {
  console.error(`\n  No gallery with slug "${slug}".\n`);
  process.exit(1);
}
if (before.kind !== "client") {
  console.error(`\n  "${slug}" is kind='${before.kind}', not a client gallery.`);
  console.error("  Album download policy is the compiled default; this only edits client galleries.\n");
  process.exit(1);
}

const patch = {};
if (has("--originals")) patch.download_tiers = ["share", "full", "original"];
if (has("--no-originals")) patch.download_tiers = ["share", "full"];
if (has("--downloads-off")) patch.download_enabled = false;
if (has("--downloads-on")) patch.download_enabled = true;

if (Object.keys(patch).length === 0) {
  const tiers = Array.isArray(before.download_tiers) && before.download_tiers.length
    ? before.download_tiers.join(", ")
    : "(column empty — the app falls back to share, full)";
  console.log(`\n  ${slug}`);
  console.log(`    downloads        ${before.download_enabled === false ? "OFF" : "on"}`);
  console.log(`    tiers            ${tiers}`);
  console.log(`    visibility       ${before.visibility}`);
  console.log("\n  Nothing changed. Pass --originals / --no-originals / --downloads-off / --downloads-on.\n");
  process.exit(0);
}

const { data: after, error: writeErr } = await db
  .from("galleries")
  .update(patch)
  .eq("slug", slug)
  .select(COLUMNS)
  .single();

if (writeErr) {
  console.error(`\n  Update refused: ${writeErr.message}`);
  if (writeErr.message.includes("check")) {
    console.error("  download_tiers has a <@ CHECK constraint — only share, full, original are legal.");
  }
  console.error();
  process.exit(1);
}

console.log(`\n  ${slug} updated.`);
console.log(`    downloads        ${after.download_enabled === false ? "OFF" : "on"}`);
console.log(`    tiers            ${(after.download_tiers ?? []).join(", ")}`);

if ((after.download_tiers ?? []).includes("original")) {
  console.log(`
  Two things that surprise people about originals:

  1. "Full quality" may VANISH from the sheet. download.jpg is a q92 re-encode,
     so when the source was already a modest JPEG it comes out LARGER than the
     original and a generation worse. availableTiers() drops it in that case —
     strictly better for the client, and not a bug.

  2. The size beside "Original file" reads "—" unless photos.source_bytes was
     recorded when the ladder was built. Check it:

       node --env-file=.env.local scripts/ladder-status.mjs
`);
}

console.log("  Live on the next reload — nothing caches this.\n");
