// The Supabase client the Studio uses: the signed-in photographer's own
// session, read from their cookies. Row Level Security applies to everything
// it does, so it can only see and change what that photographer may.
//
// Not supabaseRead() (no session, visitor rules) and not supabaseAdmin()
// (service key, no rules at all). See src/lib/supabase.ts for those two.
//
// A NEW CLIENT PER REQUEST, never a module-level one. It holds one person's
// session; sharing it between requests would hand that session to the next
// visitor.

import "server-only";

import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/src/lib/database.types";
import { STUDIO_COOKIE_OPTIONS, studioSupabaseEnv } from "./config";

export async function studioSupabase(): Promise<SupabaseClient<Database>> {
  const env = studioSupabaseEnv();
  if (!env) {
    throw new Error(
      "The Studio needs NEXT_PUBLIC_SUPABASE_URL and one of " +
        "NEXT_PUBLIC_SUPABASE_ANON_KEY / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.",
    );
  }

  const store = await cookies();

  return createServerClient<Database>(env.url, env.anon, {
    cookieOptions: STUDIO_COOKIE_OPTIONS,
    cookies: {
      getAll: () => store.getAll(),
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            store.set(name, value, options);
          }
        } catch {
          // Thrown while a Server Component is rendering, where cookies are
          // read-only. Safe to ignore: src/proxy.ts refreshes the session
          // before any Studio page renders, so there is nothing new to write
          // here. In a Server Action the write succeeds, and that is where
          // sign-in and sign-out happen.
        }
      },
    },
  });
}
