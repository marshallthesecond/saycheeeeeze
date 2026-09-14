// Waits for Supabase to answer before the build starts.
//
// Free-tier projects idle down, and the first request after a quiet spell can
// take longer than the API gateway is willing to wait — a 504 that says
// nothing about the query. During `next build` that is fatal: a prerendered
// page whose data fetch throws takes the whole deploy with it, and the error
// surfaces well into static generation as a stack trace pointing at whichever
// page happened to be scheduled first.
//
// One wait here, before any page renders, turns a cold database into a slower
// build instead of a failed one. It is also the honest place to fail: if
// Supabase is genuinely unreachable, this says so in one line rather than
// halfway through prerendering ninety pages.
//
// Chained into the build script with && rather than named `prebuild`, because
// pnpm does not run pre/post scripts unless enable-pre-post-scripts is turned
// on, and a warm-up that silently never runs is worse than none.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Next loads .env.local itself; plain `node` does not, and this runs before
// Next starts. Without it the script finds nothing locally and skips every
// time — it only ever worked on Vercel, where the environment is already
// injected. Same parser and same precedence as scripts/reseed.ts.
function loadEnvFile(file) {
  const path = join(process.cwd(), file);
  if (!existsSync(path)) return false;

  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;

    const eq = line.indexOf("=");
    if (eq === -1) continue;

    const key = line.slice(0, eq).trim().replace(/^export\s+/, "");
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    // Anything already set wins, so Vercel's injected values are never
    // clobbered by a .env.local that happened to reach the build.
    if (!(key in process.env)) process.env[key] = value;
  }
  return true;
}

[".env.local", ".env"].forEach(loadEnvFile);

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

const DEADLINE_MS = Number(process.env.WARM_DEADLINE_MS ?? 120_000);
const ATTEMPT_TIMEOUT_MS = 15_000;
const GAP_MS = 3_000;

/**
 * One probe, with the response body always drained.
 *
 * Leaving a body unread holds its socket open, and a socket in that state is
 * what makes the process dangerous to kill abruptly — see the note on exiting
 * at the bottom of this file.
 */
async function attempt(probe) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ATTEMPT_TIMEOUT_MS);
  try {
    const res = await fetch(probe, {
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
      signal: ac.signal,
    });
    await res.arrayBuffer();
    // 4xx means it answered — a wrong key or a missing table is a real answer,
    // and not something waiting longer will fix.
    if (res.status < 500) return { ok: true, status: res.status };
    return { ok: false, why: `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, why: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  // No credentials is not a failure — a build that never calls Supabase should
  // still work. Anything that does need it will fail later with a better
  // message than this script could give.
  if (!URL_ || !KEY) {
    console.log("[warm] No Supabase credentials in the environment — skipping.");
    return 0;
  }

  // The cheapest query that still proves the database itself is awake, rather
  // than just the gateway in front of it.
  const probe = `${URL_.replace(/\/+$/, "")}/rest/v1/galleries?select=id&limit=1`;

  const started = Date.now();
  let n = 0;

  while (Date.now() - started < DEADLINE_MS) {
    n++;
    const { ok, status, why } = await attempt(probe);
    const secs = ((Date.now() - started) / 1000).toFixed(1);

    if (ok) {
      console.log(
        n === 1
          ? `[warm] Supabase responded (HTTP ${status}) in ${secs}s.`
          : `[warm] Supabase awake after ${n} attempts, ${secs}s (HTTP ${status}).`,
      );
      return 0;
    }

    console.log(`[warm] attempt ${n} at ${secs}s: ${why} — waiting…`);
    await new Promise((r) => setTimeout(r, GAP_MS));
  }

  console.error(
    `\n[warm] Supabase did not respond within ${DEADLINE_MS / 1000}s.\n` +
      `       The build would fail partway through prerendering, so it is\n` +
      `       stopping here instead. Check whether the project is paused:\n` +
      `       https://supabase.com/dashboard\n`,
  );
  return 1;
}

// process.exitCode, never process.exit().
//
// Calling process.exit() from inside a fetch continuation tears the process
// down while libuv still holds sockets in a closing state, and on Windows that
// trips an assertion in libuv itself — "Assertion failed: !(handle->flags &
// UV_HANDLE_CLOSING), src\win\async.c" — which kills the build with
// 0xC0000409 instead of a real exit code, so the && never even reports why.
//
// Setting exitCode and letting the loop drain costs nothing measurable: with
// the response body consumed above there is nothing left holding it open.
process.exitCode = await main();
