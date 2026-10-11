// A contact sheet of every public photograph, with its storage path under it.
//
//   node --env-file=.env.local scripts/contact-sheet.mjs
//   node --env-file=.env.local scripts/contact-sheet.mjs --folder Portraits
//   node --env-file=.env.local scripts/contact-sheet.mjs --open
//
// WHY THIS EXISTS. list-photos.mjs prints the paths, and a path is
// "Portraits/Sara/3M0A1432.png" — which says nothing about what the picture
// is. Choosing the eight best photographs on the site from a list of camera
// filenames is not a thing anyone can do. This writes an HTML page of
// thumbnails, each with its path underneath and click-to-copy, so the choice
// is made by looking.
//
// Read-only: one Supabase query and one HTML file. Touches nothing in Bunny
// and nothing in the database.
//
// CLIENT GALLERIES ARE EXCLUDED, the same way list-photos.mjs excludes them.
// Those photographs are behind a passkey, their derivatives live under
// clients/_d/ and are blocked at the public edge, and putting one on the About
// page would hand it out. A photograph from a shoot that was PUBLISHED into a
// public album appears here under its new public path — that is the path to
// use, never the clients/ one.
//
// ONLY PHOTOGRAPHS WITH A BUILT LADDER are listed. The thumbnails are the
// ladder's own 240px rung, so a photo that cannot be shown here is exactly a
// photo that would render as nothing on the About page: the pull zone's
// Optimizer is off, so there is no fallback to the original. If something you
// want is missing, run build-ladder.mjs for its gallery first.

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
const PULL_ZONE = process.env.NEXT_PUBLIC_BUNNY_PULL_ZONE;

if (!SUPABASE_URL || !SERVICE_KEY || !PULL_ZONE) {
  const missing = [
    !SUPABASE_URL && "NEXT_PUBLIC_SUPABASE_URL",
    !SERVICE_KEY && "SUPABASE_SERVICE_ROLE_KEY",
    !PULL_ZONE && "NEXT_PUBLIC_BUNNY_PULL_ZONE",
  ].filter(Boolean);
  console.error(`\n  Missing: ${missing.join(", ")}`);
  console.error("  Run with:  node --env-file=.env.local scripts/contact-sheet.mjs\n");
  process.exit(1);
}

const argv = process.argv.slice(2);
const val = (f) => {
  const i = argv.indexOf(f);
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : null;
};
const ONLY = val("--folder");
const OUT = resolve(val("--out") ?? "contact-sheet.html");

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const { data, error } = await db
  .from("photos")
  .select("id, gallery_id, storage_path, checksum8, variants, ladder_rev, galleries!inner(slug, kind)")
  .eq("galleries.kind", "album")
  .order("storage_path", { ascending: true });

if (error) {
  console.error(`\n  Supabase: ${error.message}\n`);
  process.exit(1);
}

/** Smallest rung, matching parseVariants() in src/lib/ladder.ts. */
function smallestWidth(variants) {
  if (!Array.isArray(variants)) return null;
  const widths = variants
    .map((v) => (v && typeof v === "object" ? v.w : null))
    .filter((w) => typeof w === "number" && Number.isFinite(w) && w > 0)
    .sort((a, b) => a - b);
  return widths[0] ?? null;
}

const base = PULL_ZONE.replace(/\/+$/, "");
const rows = [];
let noLadder = 0;

for (const p of data ?? []) {
  if (ONLY && !p.storage_path.startsWith(`${ONLY}/`)) continue;
  const w = smallestWidth(p.variants);
  if (w === null || !p.checksum8) {
    noLadder++;
    continue;
  }
  rows.push({
    path: p.storage_path,
    folder: p.storage_path.split("/").slice(0, -1).join("/") || "(root)",
    // Mirrors derivativePrefix("album", …) in src/lib/ladder.ts.
    thumb: `${base}/d/${p.gallery_id}/${p.id}/${p.checksum8}/v${p.ladder_rev}/${w}.webp`,
    slug: p.galleries?.slug ?? "",
  });
}

if (rows.length === 0) {
  console.log(`\n  Nothing to show${ONLY ? ` under ${ONLY}/` : ""}.`);
  if (noLadder > 0) console.log(`  ${noLadder} photo(s) have no ladder — run build-ladder.mjs.`);
  console.log("");
  process.exit(1);
}

const byFolder = new Map();
for (const r of rows) {
  if (!byFolder.has(r.folder)) byFolder.set(r.folder, []);
  byFolder.get(r.folder).push(r);
}

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );

const sections = [...byFolder.entries()]
  .map(
    ([folder, items]) => `
  <section>
    <h2>${esc(folder)} <span>${items.length}</span></h2>
    <div class="grid">
      ${items
        .map(
          (r) => `<figure data-path="${esc(r.path)}" title="click to copy">
        <img src="${esc(r.thumb)}" alt="" loading="lazy" />
        <figcaption>${esc(r.path)}</figcaption>
      </figure>`,
        )
        .join("\n      ")}
    </div>
  </section>`,
  )
  .join("\n");

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Contact sheet — ${rows.length} photographs</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; padding:24px; background:#0E1115; color:#F7F5F1;
         font:14px/1.5 ui-sans-serif,system-ui,sans-serif; }
  h1 { font-size:18px; margin:0 0 4px; }
  .hint { color:#8b9199; margin:0 0 28px; font-size:13px; }
  h2 { font-size:13px; font-weight:600; color:#aab1ba; margin:32px 0 12px;
       text-transform:uppercase; letter-spacing:.08em; }
  h2 span { color:#5e656d; font-weight:400; margin-left:6px; }
  .grid { display:grid; gap:12px;
          grid-template-columns:repeat(auto-fill,minmax(170px,1fr)); }
  figure { margin:0; cursor:pointer; border-radius:10px; overflow:hidden;
           background:#161a1f; border:1px solid #23282e; transition:border-color .15s; }
  figure:hover { border-color:#506477; }
  figure.copied { border-color:#7fd1a0; }
  img { display:block; width:100%; aspect-ratio:1; object-fit:cover; background:#1d2127; }
  figcaption { padding:7px 9px; font:11px/1.35 ui-monospace,monospace;
               color:#8b9199; word-break:break-all; }
  figure.copied figcaption { color:#7fd1a0; }
  #toast { position:fixed; left:50%; bottom:24px; transform:translateX(-50%);
           background:#7fd1a0; color:#06210f; padding:9px 16px; border-radius:999px;
           font-weight:600; font-size:13px; opacity:0; pointer-events:none;
           transition:opacity .18s; }
  #toast.on { opacity:1; }
</style></head><body>
<h1>Contact sheet — ${rows.length} photographs${ONLY ? ` under ${esc(ONLY)}/` : ""}</h1>
<p class="hint">Click any photograph to copy its storage path. Paste into
<code>BEST_PICKS</code> in src/app/[locale]/about/photos.ts.
Everything here has a built ladder, so anything you pick will render.</p>
${sections}
<div id="toast">copied</div>
<script>
  const toast = document.getElementById('toast');
  document.querySelectorAll('figure').forEach((f) => {
    f.addEventListener('click', async () => {
      const path = f.dataset.path;
      try { await navigator.clipboard.writeText('"' + path + '",'); }
      catch {
        // Clipboard needs a secure context; a file:// page is not always one.
        const t = document.createElement('textarea');
        t.value = '"' + path + '",';
        document.body.appendChild(t); t.select();
        document.execCommand('copy'); t.remove();
      }
      f.classList.add('copied');
      toast.textContent = path;
      toast.classList.add('on');
      setTimeout(() => toast.classList.remove('on'), 1200);
    });
  });
</script>
</body></html>`;

writeFileSync(OUT, html);

console.log(`\n  ${rows.length} photographs across ${byFolder.size} folder(s)`);
if (noLadder > 0) {
  console.log(`  ${noLadder} skipped — no ladder yet, so they would render as nothing.`);
  console.log("  Build them first:  node --env-file=.env.local scripts/build-ladder.mjs --gallery <slug>");
}
console.log(`\n  Written to  ${OUT}`);
console.log("  Open it, click a photograph, paste into BEST_PICKS.\n");
