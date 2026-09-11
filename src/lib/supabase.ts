// src/lib/supabase.ts
//
// Both clients live here and the whole module is server-only. Nothing in this
// app reads Supabase from the browser — album data is fetched during render,
// so there is no reason for either key to reach the client bundle.
//
//   supabaseRead()  — anon/publishable key, subject to RLS. Every page read
//                     goes through this, so a wrong query still can't reach
//                     an unpublished gallery.
//   supabaseAdmin() — service role/secret key, bypasses RLS. Seed and sync
//                     only. Never import from anything that renders.

import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

// Supabase renamed these keys. Older projects and older docs say ANON_KEY and
// SERVICE_ROLE_KEY; the current dashboard says PUBLISHABLE and SECRET. Accept
// either so it doesn't matter which one you copied.
//
// Read inside the functions, never at module scope: scripts load .env.local
// with dotenv, and ES imports are hoisted above every statement in the file
// that imports this one, so a module-scope read always runs first and always
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

/** Names the vars that ARE set, so the error tells you what you actually have. */
function present(): string {
  const found = Object.keys(process.env)
    .filter((k) => k.includes("SUPABASE"))
    .sort();
  return found.length ? found.join(", ") : "none";
}

// No sessions, no token refresh, no URL parsing — this is a stateless server
// process reading public rows, not a browser holding a login.
const CLIENT_OPTIONS = {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
} as const;

let readClient: SupabaseClient<Database> | null = null;
let adminClient: SupabaseClient<Database> | null = null;

/** Anon-key client. RLS applies. Use this for anything a visitor will see. */
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

/**
 * Service-role client. Bypasses RLS — it can read and write anything.
 * Seed and sync only. Lazy, so a build without the key still succeeds as long
 * as nothing calls it.
 */
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