// Are the "pending" photos actually unbuilt, or just mislabelled?
//
//   node --env-file=.env.local scripts/audit-pending.mjs --gallery Diyora-at-CCA
//   node --env-file=.env.local scripts/audit-pending.mjs --gallery X --sample 20
//
// build-ladder writes checksum8, variants, delivery_bytes AND status='ready' in
// one PATCH, so a row cannot legitimately hold derivative metadata while still
// reading 'pending'. When it does, either the ladder is really there and only
// the status was reset — in which case rebuilding is hours of wasted transfer —
// or the metadata is stale and the files are gone.
//
// The trap this exists to avoid: `variants is not null` answers nothing,
// because the column defaults to an empty array and is therefore non-null on
// every row reseed has ever created. A census built on it reports 100% of
// every status group as "has a ladder" and looks like confirmation. checksum8
// is the column that means something.
//
// Only Bunny can settle it. This asks, with HEAD requests, whether every file
// the row claims to have actually exists. Nothing is written, nothing is
// uploaded, no rows are touched, and it is safe to run while a build is going.

// process.exitCode, never process.exit().
//
// This is a module with top-level awaits and an open supabase client, so
// process.exit() tears the process down while undici still holds sockets in a
// closing state. On Windows that trips an assertion inside libuv itself —
// "Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), src\win\async.c" —
// and you get 0xC0000409 after the output instead of a clean exit. Setting
// exitCode and letting the loop drain costs nothing: every response body here
// is a HEAD with no body to consume.

import process from "node:process";
import { createClient } from "@supabase/supabase-js";

const argv = process.argv.slice(2);
const val = (f, d = null) => {
  const exact = argv.find((a) => a.startsWith(`--${f}=`));
  if (exact) return exact.slice(f.length + 3);
  const i = argv.indexOf(`--${f}`);
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d;
};

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
const ZONE = process.env.BUNNY_STORAGE_ZONE;
const KEY = process.env.BUNNY_STORAGE_API_KEY;
const HOST = (process.env.BUNNY_STORAGE_HOST ?? "storage.bunnycdn.com")
  .replace(/^https?:\/\//, "")
  .replace(/\/$/, "");
const LADDER_REV = Number(process.env.LADDER_REV ?? 1);

const ENV_OK = SUPABASE_URL && SERVICE_KEY && ZONE && KEY;

const GALLERY = val("gallery");
const SAMPLE = Number(val("sample", "12"));


async function main() {
  if (!ENV_OK) {
    console.error(
      "Missing env. Run with:\n" +
        "  node --env-file=.env.local scripts/audit-pending.mjs --gallery <slug>",
    );
    return 1;
  }
  if (!GALLERY) {
    console.error("Need --gallery <slug>.");
    return 1;
  }
  if (!Number.isInteger(SAMPLE) || SAMPLE < 1) {
    console.error("--sample must be a whole number of 1 or more.");
    return 1;
  }

  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  /** HEAD: proves existence and transfers no bytes. */
  async function exists(path) {
    try {
      const res = await fetch(`https://${HOST}/${ZONE}/${path}`, {
        method: "HEAD",
        headers: { AccessKey: KEY },
        signal: AbortSignal.timeout(20_000),
      });
      return res.ok;
    } catch {
      return null; // a network problem is not the same answer as "absent"
    }
  }

  async function pool(items, limit, fn) {
    const out = new Array(items.length);
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (next < items.length) {
          const i = next++;
          out[i] = await fn(items[i], i);
        }
      }),
    );
    return out;
  }

  const { data, error } = await db
    .from("photos")
    .select("id, gallery_id, storage_path, status, checksum8, variants, ladder_rev, delivery_bytes, share_bytes, galleries!inner(slug, kind)")
    .eq("galleries.slug", GALLERY)
    .neq("status", "ready")
    .order("storage_path", { ascending: true });

  if (error) {
    console.error(`Supabase: ${error.message}`);
    return 1;
  }

  const rows = data ?? [];
  console.log(`\nAudit  ${GALLERY} — ${rows.length} row(s) not yet 'ready'\n`);

  if (rows.length === 0) {
    console.log("Nothing to audit. Every photo in this gallery is 'ready'.\n");
    return 0;
  }

  // Split on what the ROW claims before asking Bunny anything.
  const claimsBuilt = rows.filter(
    (r) => r.checksum8 && Array.isArray(r.variants) && r.variants.length > 0,
  );
  const claimsNothing = rows.filter((r) => !claimsBuilt.includes(r));

  console.log(`  ${claimsBuilt.length} row(s) carry derivative metadata (checksum8 + a non-empty variants)`);
  console.log(`  ${claimsNothing.length} row(s) carry none — genuinely unbuilt\n`);

  // Spelled out, because "variants is not null" is NOT the same question:
  // the column defaults to an empty array, so it is non-null on every row from
  // the moment reseed creates it. Counting non-nulls therefore counts rows, not
  // ladders. checksum8 is the honest signal — nothing sets it but a completed
  // build.
  if (claimsNothing.length) {
    const noChecksum = rows.filter((r) => !r.checksum8).length;
    const emptyVariants = rows.filter(
      (r) => r.checksum8 && (!Array.isArray(r.variants) || r.variants.length === 0),
    ).length;
    console.log(`    of those: ${noChecksum} have no checksum8, ${emptyVariants} have an empty variants\n`);
  }

  if (claimsBuilt.length === 0) {
    console.log(
      "Every pending row is genuinely unbuilt. Let build-ladder run; there is\n" +
        "nothing here to reclaim.\n",
    );
    return 0;
  }

  const checking = claimsBuilt.slice(0, SAMPLE);
  console.log(`Checking ${checking.length} of them against ${ZONE} (HEAD only)\n`);

  let intact = 0;
  let broken = 0;
  let unreachable = 0;
  const intactIds = [];

  for (const r of checking) {
    const root = (Array.isArray(r.galleries) ? r.galleries[0] : r.galleries)?.kind === "client"
      ? "clients/_d"
      : "d";
    const prefix = `${root}/${r.gallery_id}/${r.id}/${r.checksum8}/v${r.ladder_rev ?? LADDER_REV}`;

    const widths = r.variants.map((v) => v.w).filter(Boolean).sort((a, b) => a - b);
    // Exactly what processPhoto() uploads: every width as avif and webp, plus
    // the two delivery JPEGs.
    const expect = [
      ...widths.map((w) => `${prefix}/${w}.avif`),
      ...widths.map((w) => `${prefix}/${w}.webp`),
      `${prefix}/share.jpg`,
      `${prefix}/download.jpg`,
    ];

    const found = await pool(expect, 6, exists);
    const missing = found.filter((f) => f === false).length;
    const errored = found.filter((f) => f === null).length;
    const name = r.storage_path.split("/").pop();

    if (errored) {
      unreachable++;
      console.log(`  ?  ${name.padEnd(20)} ${errored}/${expect.length} unreachable — network, not a verdict`);
    } else if (missing === 0) {
      intact++;
      intactIds.push(r.id);
      console.log(`  ✓  ${name.padEnd(20)} all ${expect.length} files present`);
    } else {
      broken++;
      console.log(`  ✗  ${name.padEnd(20)} ${missing}/${expect.length} MISSING`);
    }
  }

  console.log(`\n  intact      ${intact}`);
  console.log(`  incomplete  ${broken}`);
  if (unreachable) console.log(`  unreachable ${unreachable}`);
  console.log("\n" + "─".repeat(64));

  if (unreachable > checking.length / 3) {
    console.log(
      "\nToo many requests failed to get an answer. The verdict would be noise.\n" +
        "Run it again when the connection is behaving.\n",
    );
    return 2;
  } else if (broken === 0 && intact > 0) {
    console.log(
      `\nThe ladders ARE there. All ${intact} sampled rows have every file in\n` +
        `Bunny — only the status column is wrong, and rebuilding them re-uploads\n` +
        `bytes that already exist.\n\n` +
        `Stop build-ladder, then flip the metadata-carrying rows to 'ready':\n\n` +
        `  update photos p\n` +
        `     set status = 'ready', error = null, claimed_at = null\n` +
        `    from galleries g\n` +
        `   where g.id = p.gallery_id\n` +
        `     and g.slug = '${GALLERY}'\n` +
        `     and p.status <> 'ready'\n` +
        `     and p.checksum8 is not null\n` +
        `     and p.variants is not null\n` +
        `     and jsonb_array_length(to_jsonb(p.variants)) > 0;\n\n` +
        `Then re-run this script: it should report nothing left to audit. Widen\n` +
        `the sample first with --sample ${Math.min(claimsBuilt.length, 40)} if you want more\n` +
        `confidence before writing.\n`,
    );
  } else {
    console.log(
      `\nMixed. ${broken} of ${checking.length} sampled rows are missing files, so the\n` +
        `metadata is not trustworthy on its own — let build-ladder rebuild these\n` +
        `rather than flipping statuses. Re-run with a larger --sample to see\n` +
        `whether the breakage is confined to part of the set.\n`,
    );
  }

  return 0;
}

process.exitCode = await main();
