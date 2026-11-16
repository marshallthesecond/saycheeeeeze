// Compares a database copy made by the worker with the database, and puts
// back what is missing or different.
//
//   pnpm db-restore <copy.json.gz>                                 # compare only
//   pnpm db-restore <copy.json.gz> --apply                         # put it back
//   pnpm db-restore <copy.json.gz> --table galleries,photos [--apply]
//   (= node --env-file=.env.local scripts/db-restore.mjs ...)
//
// The copies are in the saycheeeeeze-backups folder in your home folder
// (WORKER_BACKUP_DIR), one a day, made by `pnpm worker`, or right now with
// `pnpm worker --backup`.
//
// WHAT IT DOES
//   - Reads every table of the copy and of the database, row by row by
//     primary key.
//   - Without --apply: prints, per table, how many rows are missing here,
//     how many differ, and how many are here but not in the copy. Writes
//     nothing.
//   - With --apply: writes the missing and differing rows back (an upsert by
//     primary key), parents before children, then reads them again and puts
//     right whatever a trigger changed on the way in (a client gallery is
//     made private on insert, for one).
//   - Never deletes. A row that is here but not in the copy stays.
//
// WHAT IT DOES NOT
//   - The tables' structure. On a new, empty Supabase project, run the
//     migrations first (supabase/migrations, in order), then this.
//   - Logins and passwords: those live in Supabase Auth. Make the login
//     again (same email) in the dashboard; rows that point at the old login
//     are pointed at the new one by email. Rows for a login that is not here
//     are skipped and listed.
//   - jobs and workers (the worker's own state), and log tables whose key
//     the database makes itself (booking_attempts, gallery_unlock_attempts).
//   - Files in storage. Restoring a photo row does not bring back its files.

import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { gunzipSync } from "node:zlib";

import { createClient } from "@supabase/supabase-js";

const env = process.env;
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL ?? env.SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY ?? env.SUPABASE_SECRET_KEY;
const SITE_URL = (env.WORKER_SITE_URL ?? env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/+$/, "");
const REVALIDATE_SECRET = env.REVALIDATE_SECRET;

const PAGE = 1000;
const BATCH = 200;
/** The worker's own state: never restored. */
const NEVER = new Set(["jobs", "workers"]);
/** Changed by a trigger on every write; not a difference worth restoring. */
const IGNORED_COLUMNS = new Set(["updated_at"]);

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const tableFlag = args.indexOf("--table");
const ONLY = tableFlag >= 0 ? new Set((args[tableFlag + 1] ?? "").split(",").map((t) => t.trim()).filter(Boolean)) : null;
const FILE = args.find((a, i) => !a.startsWith("--") && (tableFlag < 0 || i !== tableFlag + 1));

function fail(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

if (!FILE) fail("Which copy? pnpm db-restore <copy.json.gz> [--apply]");
if (!SUPABASE_URL || !SERVICE_KEY) fail("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are needed. Run it with --env-file=.env.local.");

const db = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

const keyOf = (pk, row) => JSON.stringify(pk.map((k) => row[k] ?? null));
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

async function rpc(fn) {
  const { data, error } = await db.rpc(fn);
  if (error) {
    if (error.code === "PGRST202") fail(`${fn} is not in this database. Run the migrations first (20261116170000 is the one with it).`);
    fail(`${fn}: ${error.message}`);
  }
  return data;
}

async function readTable(name, pk) {
  const rows = [];
  let total = null;
  for (let from = 0; ; ) {
    let qb = db.from(name).select("*", from === 0 ? { count: "exact" } : undefined);
    for (const k of pk) qb = qb.order(k, { ascending: true });
    const { data, error, count } = await qb.range(from, from + PAGE - 1);
    if (error) throw new Error(`${name}: ${error.message}`);
    if (from === 0) total = count;
    rows.push(...(data ?? []));
    from += data?.length ?? 0;
    if (!data?.length || (total !== null && from >= total)) break;
  }
  return rows;
}

/** Parents before children; whatever is left (a cycle) by name. */
function inOrder(tables) {
  const names = new Set(tables.map((t) => t.name));
  const deps = new Map(tables.map((t) => [t.name, new Set((t.depends_on ?? []).filter((d) => names.has(d) && d !== t.name))]));
  const out = [];
  while (deps.size) {
    const ready = [...deps].filter(([, d]) => [...d].every((x) => !deps.has(x))).map(([n]) => n).sort();
    const next = ready.length ? ready : [[...deps.keys()].sort()[0]];
    for (const n of next) {
      out.push(n);
      deps.delete(n);
    }
  }
  return out.map((n) => tables.find((t) => t.name === n));
}

function pad(text, width, right = false) {
  const s = String(text);
  return right ? s.padStart(width) : s.padEnd(width);
}

// ---------------------------------------------------------------------------

let copy;
try {
  copy = JSON.parse(gunzipSync(await readFile(FILE)).toString("utf8"));
} catch (err) {
  fail(`Could not read ${FILE}: ${err.message}`);
}
if (copy?.format !== "saycheeeeeze-db-copy" || copy.version !== 1 || !Array.isArray(copy.tables)) {
  fail(`${path.basename(FILE)} is not a database copy made by the worker.`);
}

const here = new Map((await rpc("worker_backup_tables")).map((t) => [t.table_name, t]));
const loginsHere = await rpc("worker_backup_users");

// Logins: the same id, or the same email with a new id.
const byId = new Set(loginsHere.map((u) => u.id));
const byEmail = new Map(loginsHere.filter((u) => u.email).map((u) => [u.email.toLowerCase(), u.id]));
const loginMap = new Map();
const missingLogins = [];
for (const u of copy.users ?? []) {
  if (byId.has(u.id)) loginMap.set(u.id, u.id);
  else if (u.email && byEmail.has(u.email.toLowerCase())) loginMap.set(u.id, byEmail.get(u.email.toLowerCase()));
  else missingLogins.push(u);
}

console.log(
  `\nCopy made ${new Date(copy.made_at).toLocaleString()} by ${copy.worker ?? "?"} from ${copy.database ?? "?"}, ${copy.tables.length} tables.` +
    `\nThis database: ${new URL(SUPABASE_URL).host}.` +
    `\nLogins: ${(copy.users ?? []).length} in the copy; ${[...loginMap].filter(([a, b]) => a === b).length} here with the same id, ` +
    `${[...loginMap].filter(([a, b]) => a !== b).length} here under a new id (matched by email), ${missingLogins.length} not here` +
    `${missingLogins.length ? ` (${missingLogins.map((u) => u.email ?? u.id).join(", ")})` : ""}.\n`,
);

const report = [];
const skipped = [];
let written = 0;
let toWrite = 0;

for (const t of inOrder(copy.tables)) {
  const info = here.get(t.name);
  if (ONLY && !ONLY.has(t.name)) continue;
  if (NEVER.has(t.name)) {
    skipped.push(`${t.name}: the worker's own state`);
    continue;
  }
  if (!t.rows) {
    skipped.push(`${t.name}: not in the copy (${t.error ?? "could not be read"})`);
    continue;
  }
  if (!info) {
    skipped.push(`${t.name}: not in this database`);
    continue;
  }
  const pk = info.primary_key;
  if (!pk.length) {
    skipped.push(`${t.name}: no primary key`);
    continue;
  }
  if (pk.some((k) => info.generated.includes(k))) {
    skipped.push(`${t.name}: a log whose key the database makes itself`);
    continue;
  }

  // What can be written: columns of this database, not generated ones.
  const writable = info.columns.filter((c) => !info.generated.includes(c));
  const compared = writable.filter((c) => !IGNORED_COLUMNS.has(c));
  const authCols = info.auth_user_columns ?? [];
  let noLogin = 0;
  const wanted = [];
  for (const raw of t.rows) {
    const row = {};
    for (const c of writable) if (c in raw) row[c] = raw[c];
    let ok = true;
    for (const c of authCols) {
      if (row[c] == null) continue;
      if (loginMap.has(row[c])) row[c] = loginMap.get(row[c]);
      else ok = false;
    }
    if (ok) wanted.push(row);
    else noLogin++;
  }

  const current = new Map((await readTable(t.name, pk)).map((r) => [keyOf(pk, r), r]));
  const missing = [];
  const different = [];
  for (const row of wanted) {
    const cur = current.get(keyOf(pk, row));
    if (!cur) missing.push(row);
    else if (compared.some((c) => c in row && !same(row[c], cur[c]))) different.push(row);
  }
  // Keys as they are here: a login's new id where it was mapped.
  const copyKeys = new Set(wanted.map((r) => keyOf(pk, r)));
  const onlyHere = [...current.keys()].filter((k) => !copyKeys.has(k)).length;
  const line = { name: t.name, copy: t.rows.length, here: current.size, missing: missing.length, different: different.length, onlyHere, noLogin, fixed: 0, errors: [] };
  report.push(line);
  toWrite += missing.length + different.length;

  if (!APPLY || missing.length + different.length === 0) continue;

  // Write: in batches, one by one where a batch is refused.
  const rows = [...missing, ...different];
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const { error } = await db.from(t.name).upsert(batch, { onConflict: pk.join(",") });
    if (!error) {
      written += batch.length;
      continue;
    }
    for (const row of batch) {
      const { error: e } = await db.from(t.name).upsert(row, { onConflict: pk.join(",") });
      if (e) line.errors.push(`${keyOf(pk, row)}: ${e.message}`);
      else written++;
    }
  }

  // Read back, and put right what a trigger changed on the way in.
  const after = new Map((await readTable(t.name, pk)).map((r) => [keyOf(pk, r), r]));
  for (const row of rows) {
    const cur = after.get(keyOf(pk, row));
    if (!cur) continue;
    const patch = {};
    for (const c of compared) if (c in row && !same(row[c], cur[c]) && !pk.includes(c)) patch[c] = row[c];
    if (!Object.keys(patch).length) continue;
    let qb = db.from(t.name).update(patch);
    for (const k of pk) qb = qb.eq(k, row[k]);
    const { error } = await qb;
    if (error) line.errors.push(`${keyOf(pk, row)}: ${error.message}`);
    else line.fixed++;
  }
}

// ---------------------------------------------------------------------------

const w = Math.max(5, ...report.map((r) => r.name.length));
console.log(`  ${pad("table", w)}  ${pad("copy", 6, true)}  ${pad("here", 6, true)}  ${pad("missing", 7, true)}  ${pad("different", 9, true)}  ${pad("only here", 9, true)}`);
for (const r of report) {
  console.log(
    `  ${pad(r.name, w)}  ${pad(r.copy, 6, true)}  ${pad(r.here, 6, true)}  ${pad(r.missing, 7, true)}  ${pad(r.different, 9, true)}  ${pad(r.onlyHere, 9, true)}` +
      `${r.noLogin ? `  (${r.noLogin} skipped: their login is not here)` : ""}`,
  );
}
if (skipped.length) console.log(`\nNot restored:\n${skipped.map((s) => `  ${s}`).join("\n")}`);

const errors = report.flatMap((r) => r.errors.map((e) => `${r.name} ${e}`));
if (errors.length) {
  console.log(`\nRefused (${errors.length}):\n${errors.slice(0, 20).map((e) => `  ${e}`).join("\n")}${errors.length > 20 ? "\n  ..." : ""}`);
}

if (!APPLY) {
  console.log(toWrite ? `\nNothing written. Add --apply to put back ${toWrite} row${toWrite === 1 ? "" : "s"}.\n` : "\nNothing to put back.\n");
  process.exit(0);
}

console.log(`\nWritten: ${written} row${written === 1 ? "" : "s"}${errors.length ? `, ${errors.length} refused` : ""}.`);
if (written && SITE_URL && REVALIDATE_SECRET) {
  try {
    const res = await fetch(`${SITE_URL}/api/sync?only=revalidate`, {
      method: "POST",
      headers: { Authorization: `Bearer ${REVALIDATE_SECRET}` },
      signal: AbortSignal.timeout(20_000),
    });
    console.log(res.ok ? `${new URL(SITE_URL).host} refreshed.` : `Could not refresh ${new URL(SITE_URL).host} (HTTP ${res.status}).`);
  } catch (err) {
    console.log(`Could not refresh ${SITE_URL}: ${err.message}`);
  }
}
console.log("");
process.exit(errors.length ? 1 : 0);
