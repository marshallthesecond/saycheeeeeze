// A contact sheet of every public photograph — now a header picker too.
//
//   node --env-file=.env.local scripts/contact-sheet.mjs
//   node --env-file=.env.local scripts/contact-sheet.mjs --folder Portraits
//   node --env-file=.env.local scripts/contact-sheet.mjs --out sheet.html
//
// WHY THIS EXISTS. list-photos.mjs prints the paths, and a path is
// "Portraits/Sara/3M0A1432.png" — which says nothing about what the picture
// is. Choosing the best photograph on the site from a list of camera filenames
// is not a thing anyone can do. This writes an HTML page of thumbnails so the
// choice is made by looking.
//
// PICKING A HEADER IS NOT PICKING A PHOTOGRAPH. A service hero is full-bleed
// and wide; a portrait-orientation frame that is beautiful on its own gets
// its subject's head cropped off at 21:9. So selecting a photo here shows it
// back at the three shapes the hero is actually rendered at, before the choice
// is committed to a file. That is the whole reason this is a picker rather
// than a prettier list.
//
// Read-only: one Supabase query, one read of services.ts, one HTML file.
// Nothing in Bunny or the database is touched.
//
// CLIENT GALLERIES ARE EXCLUDED, the same way list-photos.mjs excludes them.
// Those photographs sit behind a passkey, their derivatives live under
// clients/_d/ and are blocked at the public edge. A shoot that was PUBLISHED
// into a public album appears here under its new public path — that is the
// path to use, never the clients/ one.
//
// ONLY PHOTOGRAPHS WITH A BUILT LADDER are listed. The thumbnails are the
// ladder's own rungs, so a photo that cannot be shown here is exactly a photo
// that would render as nothing on the page: the pull zone's Optimizer is off,
// so there is no fallback to the original. Run build-ladder.mjs first if
// something is missing.

import { writeFileSync, readFileSync } from "node:fs";
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

/**
 * Which photograph each service currently uses as its header.
 *
 * Read straight out of services.ts rather than maintained here, so the sheet
 * cannot disagree with the file it is helping you edit. A regex is enough
 * because the shape is machine-written and stable: every service block opens
 * with `slug: '…'` and carries exactly one `coverPath: '…'`. If the file is
 * ever reformatted past recognition this degrades to "no current headers
 * marked", which costs a badge, not correctness.
 */
function currentCovers() {
  const out = new Map(); // storage path -> [slug, …]
  try {
    const src = readFileSync(resolve("src/lib/services.ts"), "utf8");
    const blocks = src.split(/\n    slug: '/).slice(1);
    for (const block of blocks) {
      const slug = block.slice(0, block.indexOf("'"));
      const m = block.match(/coverPath: '([^']+)'/);
      if (!slug || !m) continue;
      if (!out.has(m[1])) out.set(m[1], []);
      out.get(m[1]).push(slug);
    }
  } catch {
    // Run from somewhere other than the repo root — not fatal.
  }
  return out;
}

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const { data, error } = await db
  .from("photos")
  .select(
    "id, gallery_id, storage_path, width, height, checksum8, variants, ladder_rev, galleries!inner(slug, kind)",
  )
  .eq("galleries.kind", "album")
  .order("storage_path", { ascending: true });

if (error) {
  console.error(`\n  Supabase: ${error.message}\n`);
  process.exit(1);
}

/** Rungs, smallest first — matches parseVariants() in src/lib/ladder.ts. */
function widthsOf(variants) {
  if (!Array.isArray(variants)) return [];
  return variants
    .map((v) => (v && typeof v === "object" ? v.w : null))
    .filter((w) => typeof w === "number" && Number.isFinite(w) && w > 0)
    .sort((a, b) => a - b);
}

const base = PULL_ZONE.replace(/\/+$/, "");
const covers = currentCovers();
const rows = [];
let noLadder = 0;

for (const p of data ?? []) {
  if (ONLY && !p.storage_path.startsWith(`${ONLY}/`)) continue;
  const widths = widthsOf(p.variants);
  if (widths.length === 0 || !p.checksum8) {
    noLadder++;
    continue;
  }
  // Mirrors derivativePrefix("album", …) in src/lib/ladder.ts.
  const prefix = `${base}/d/${p.gallery_id}/${p.id}/${p.checksum8}/v${p.ladder_rev}`;
  rows.push({
    path: p.storage_path,
    folder: p.storage_path.split("/").slice(0, -1).join("/") || "(root)",
    thumb: `${prefix}/${widths[0]}.webp`,
    // The widest rung for the crop preview: a hero is full-bleed, and judging
    // a 21:9 crop from a 240px thumbnail is judging nothing.
    full: `${prefix}/${widths[widths.length - 1]}.webp`,
    w: p.width ?? null,
    h: p.height ?? null,
    usedBy: covers.get(p.storage_path) ?? [],
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

const tile = (r) => {
  const portrait = r.w && r.h && r.h > r.w;
  const ratio = r.w && r.h ? (r.w / r.h).toFixed(2) : "?";
  return `<figure data-path="${esc(r.path)}" data-full="${esc(r.full)}" data-ratio="${ratio}"${
    portrait ? ' data-portrait="1"' : ""
  }>
        <img src="${esc(r.thumb)}" alt="" loading="lazy" />
        ${r.usedBy.length ? `<span class="badge">header · ${esc(r.usedBy.join(", "))}</span>` : ""}
        ${portrait ? '<span class="tall" title="portrait orientation — crops hard in a wide hero">↕</span>' : ""}
        <figcaption>${esc(r.path)}</figcaption>
      </figure>`;
};

const sections = [...byFolder.entries()]
  .map(
    ([folder, items]) => `
  <section>
    <h2>${esc(folder)} <span>${items.length}</span></h2>
    <div class="grid">
      ${items.map(tile).join("\n      ")}
    </div>
  </section>`,
  )
  .join("\n");

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Header picker — ${rows.length} photographs</title>
<style>
  :root { color-scheme: dark; --accent:#506477; --ok:#7fd1a0; }
  * { box-sizing: border-box; }
  body { margin:0; padding:0 24px 160px; background:#0E1115; color:#F7F5F1;
         font:14px/1.5 ui-sans-serif,system-ui,sans-serif; }
  header.top { position:sticky; top:0; z-index:5; background:#0E1115;
               padding:20px 0 12px; border-bottom:1px solid #23282e; }
  h1 { font-size:17px; margin:0 0 4px; }
  .hint { color:#8b9199; margin:0; font-size:13px; }
  h2 { font-size:12px; font-weight:600; color:#aab1ba; margin:30px 0 11px;
       text-transform:uppercase; letter-spacing:.08em; }
  h2 span { color:#5e656d; font-weight:400; margin-left:6px; }
  .grid { display:grid; gap:12px; grid-template-columns:repeat(auto-fill,minmax(168px,1fr)); }
  figure { position:relative; margin:0; cursor:pointer; border-radius:10px;
           overflow:hidden; background:#161a1f; border:2px solid #23282e;
           transition:border-color .15s, transform .1s; }
  figure:hover { border-color:var(--accent); }
  figure:active { transform:scale(.985); }
  figure.on { border-color:var(--ok); }
  img { display:block; width:100%; aspect-ratio:1; object-fit:cover; background:#1d2127; }
  figcaption { padding:7px 9px; font:11px/1.35 ui-monospace,monospace;
               color:#8b9199; word-break:break-all; }
  figure.on figcaption { color:var(--ok); }
  .badge { position:absolute; top:6px; left:6px; background:#0E1115d9; color:#d8c08a;
           border:1px solid #d8c08a55; padding:2px 7px; border-radius:999px;
           font:10px/1.4 ui-monospace,monospace; }
  .tall { position:absolute; top:6px; right:6px; background:#0E1115d9; color:#e0a89f;
          border:1px solid #e0a89f55; width:20px; height:20px; border-radius:50%;
          display:grid; place-items:center; font-size:11px; }

  /* The crop preview — the point of the whole thing. */
  #bar { position:fixed; inset:auto 0 0 0; z-index:10; background:#131720f2;
         backdrop-filter:blur(12px); border-top:1px solid #2a3038;
         padding:14px 24px; transform:translateY(110%); transition:transform .22s cubic-bezier(.22,.61,.36,1); }
  #bar.on { transform:translateY(0); }
  .barInner { max-width:1200px; margin:0 auto; display:flex; gap:18px; align-items:flex-start; }
  .crops { display:flex; gap:10px; flex:1; min-width:0; }
  .crop { flex:1; min-width:0; }
  .crop span { display:block; font:10px/1.6 ui-monospace,monospace; color:#6f767f;
               text-transform:uppercase; letter-spacing:.06em; }
  .crop div { width:100%; background:#0b0e12 center/cover no-repeat; border-radius:6px;
              border:1px solid #2a3038; }
  .c219 div { aspect-ratio:21/9; } .c169 div { aspect-ratio:16/9; } .c32 div { aspect-ratio:3/2; }
  .side { width:330px; flex:none; }
  .side code { display:block; background:#0b0e12; border:1px solid #2a3038; border-radius:7px;
               padding:9px 11px; font:11px/1.5 ui-monospace,monospace; color:#cfd4da;
               word-break:break-all; margin-bottom:8px; }
  .side button { width:100%; border:0; border-radius:999px; padding:9px; font-weight:700;
                 font-size:12px; cursor:pointer; background:var(--ok); color:#06210f; }
  .side button.ghost { background:#242a31; color:#aab1ba; margin-top:6px; }
  .warn { color:#e0a89f; font-size:11px; margin:0 0 8px; }
  #toast { position:fixed; left:50%; bottom:200px; transform:translateX(-50%);
           background:var(--ok); color:#06210f; padding:8px 15px; border-radius:999px;
           font-weight:600; font-size:12px; opacity:0; pointer-events:none; transition:opacity .18s; z-index:11; }
  #toast.on { opacity:1; }
</style></head><body>

<header class="top">
  <h1>Header picker — ${rows.length} photographs${ONLY ? ` under ${esc(ONLY)}/` : ""}</h1>
  <p class="hint">Click a photograph to see it cropped the way a hero actually renders,
  then copy the <code>coverPath</code> line into <code>src/lib/services.ts</code>.
  Everything shown has a built ladder, so anything you pick will display.</p>
</header>

${sections}

<div id="bar"><div class="barInner">
  <div class="crops">
    <div class="crop c219"><span>21:9 — desktop hero</span><div id="p219"></div></div>
    <div class="crop c169"><span>16:9 — social preview</span><div id="p169"></div></div>
    <div class="crop c32"><span>3:2 — phone</span><div id="p32"></div></div>
  </div>
  <div class="side">
    <p class="warn" id="warn" hidden>Portrait orientation — heads and feet will be cut in the wide crops.</p>
    <code id="snippet">—</code>
    <button id="copyCover">Copy coverPath line</button>
    <button id="copyPath" class="ghost">Copy just the path</button>
  </div>
</div></div>
<div id="toast">copied</div>

<script>
  const bar = document.getElementById('bar');
  const toast = document.getElementById('toast');
  const snippet = document.getElementById('snippet');
  const warn = document.getElementById('warn');
  const panes = ['p219','p169','p32'].map((id) => document.getElementById(id));
  let current = null;

  function say(msg) {
    toast.textContent = msg;
    toast.classList.add('on');
    setTimeout(() => toast.classList.remove('on'), 1200);
  }

  async function copy(text, msg) {
    try { await navigator.clipboard.writeText(text); }
    catch {
      // Clipboard needs a secure context, and a file:// page is not always one.
      const t = document.createElement('textarea');
      t.value = text; document.body.appendChild(t); t.select();
      document.execCommand('copy'); t.remove();
    }
    say(msg);
  }

  document.querySelectorAll('figure').forEach((f) => {
    f.addEventListener('click', () => {
      document.querySelectorAll('figure.on').forEach((o) => o.classList.remove('on'));
      f.classList.add('on');
      current = f.dataset.path;
      for (const p of panes) p.style.backgroundImage = 'url("' + f.dataset.full + '")';
      snippet.textContent = "coverPath: '" + current + "',";
      warn.hidden = f.dataset.portrait !== '1';
      bar.classList.add('on');
    });
  });

  document.getElementById('copyCover').addEventListener('click', () => {
    if (current) copy("coverPath: '" + current + "',", 'coverPath line copied');
  });
  document.getElementById('copyPath').addEventListener('click', () => {
    if (current) copy(current, current);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { bar.classList.remove('on'); current = null;
      document.querySelectorAll('figure.on').forEach((o) => o.classList.remove('on')); }
  });
</script>
</body></html>`;

writeFileSync(OUT, html);

const marked = rows.filter((r) => r.usedBy.length).length;
console.log(`\n  ${rows.length} photographs across ${byFolder.size} folder(s)`);
if (marked > 0) console.log(`  ${marked} already in use as a service header, badged in the sheet.`);
if (noLadder > 0) {
  console.log(`  ${noLadder} skipped — no ladder yet, so they would render as nothing.`);
  console.log("  Build them:  node --env-file=.env.local scripts/build-ladder.mjs --gallery <slug>");
}
console.log(`\n  Written to  ${OUT}`);
console.log("  Open it, click a photograph, check the crops, copy the line.\n");
