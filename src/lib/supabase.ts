// Both Supabase clients. Server-only: nothing here reaches the browser.
//
//   supabaseRead()   anon key, RLS applies. Every page read.
//   supabaseAdmin()  service key, bypasses RLS. Seed, sync and bookings only.

import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

// Supabase renamed these keys; accept either spelling.
//
// Read inside the functions, never at module scope. Scripts load .env.local
// with dotenv, and imports are hoisted above it, so a module-scope read always
// sees undefined.
function readEnv() {
  return {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    anon:
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    service:
      process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY,
  };
}

/** Names the vars that ARE set, so the error says what you actually have. */
function present(): string {
  const found = Object.keys(process.env)
    .filter((k) => k.includes("SUPABASE"))
    .sort();
  return found.length ? found.join(", ") : "none";
}

const CLIENT_OPTIONS = {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
} as const;

let readClient: SupabaseClient<Database> | null = null;
let adminClient: SupabaseClient<Database> | null = null;

/** Anon-key client. RLS applies. Use for anything a visitor will see. */
export function supabaseRead(): SupabaseClient<Database> {
  const { url, anon } = readEnv();

  if (!url || !anon) {
    throw new Error(
      "Supabase read client needs NEXT_PUBLIC_SUPABASE_URL and one of " +
        "NEXT_PUBLIC_SUPABASE_ANON_KEY / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY. " +
        `Currently set: ${present()}. ` +
        "Check .env.local (and restart the dev server — env is read at startup).",
    );
  }

  readClient ??= createClient<Database>(url, anon, CLIENT_OPTIONS);
  return readClient;
}

/** Service-role client. Bypasses RLS entirely. Lazy, so a build without the
 *  key still succeeds as long as nothing calls it. */
export function supabaseAdmin(): SupabaseClient<Database> {
  const { url, service } = readEnv();

  if (!url || !service) {
    throw new Error(
      "Supabase admin client needs NEXT_PUBLIC_SUPABASE_URL and one of " +
        "SUPABASE_SERVICE_ROLE_KEY / SUPABASE_SECRET_KEY. " +
        `Currently set: ${present()}. ` +
        "This key bypasses RLS — it must never be prefixed NEXT_PUBLIC_.",
    );
  }

  adminClient ??= createClient<Database>(url, service, CLIENT_OPTIONS);
  return adminClient;
}

/**
 * Runs a read, retrying briefly before giving up.
 *
 * A Supabase project that has been idle takes a few seconds to wake, and the
 * first request against it can outlast the API gateway's own timeout — a 504
 * that says nothing about the query. That is survivable at request time and
 * was fatal at build time, because a prerendered page whose data fetch throws
 * fails the entire deploy.
 *
 * Two retries turn the usual cold start into a slower build rather than no
 * build. It deliberately does NOT swallow the error: the caller decides
 * whether an empty result is an acceptable answer, and for some of them it is
 * not.
 */
export async function withRetry<T>(label: string, run: () => Promise<T>): Promise<T> {
  const backoffMs = [2_000, 6_000];

  for (let attempt = 0; ; attempt++) {
    try {
      return await run();
    } catch (e) {
      if (attempt >= backoffMs.length) throw e;
      const why = e instanceof Error ? e.message : String(e);
      console.warn(`[${label}] attempt ${attempt + 1} failed, retrying: ${why}`);
      await new Promise((resolve) => setTimeout(resolve, backoffMs[attempt]));
    }
  }
}
