"use server";

// The Studio's sign-in, sign-out and language switch.
//
// Server Actions, so the password travels from the form to this server and on
// to Supabase, and never sits in browser JavaScript. The session cookie is
// written here and is httpOnly (see STUDIO_COOKIE_OPTIONS).

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { isLocale } from "@/src/lib/i18n/config";
import { STUDIO_HOME, STUDIO_LOGIN, isAuthOutage } from "@/src/lib/studio/config";
import { LOCALE_COOKIE } from "@/src/lib/studio/locale";
import { studioSupabase } from "@/src/lib/studio/supabase";

export interface SignInState {
  /** A key under `login.errors` in the Studio dictionaries. */
  error?: "missing" | "invalid" | "noAccess" | "rate" | "unavailable";
  /** Sent back so a failed attempt does not empty the email field. */
  email?: string;
}

export async function signIn(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "missing", email };

  const supabase = await studioSupabase();

  let failure: SignInState["error"] | undefined;
  try {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      // One message for a wrong email and a wrong password alike. Saying which
      // of the two was wrong tells a stranger which emails have accounts.
      if (isAuthOutage(error)) failure = "unavailable";
      else if (error.status === 429) failure = "rate";
      else failure = "invalid";
    }
  } catch {
    failure = "unavailable";
  }
  if (failure) return { error: failure, email };

  // A real login that belongs to no account is not allowed to stay signed in.
  // Read through Row Level Security: it returns only this user's accounts.
  const { data: accounts, error: accountsError } = await supabase
    .from("accounts")
    .select("id")
    .eq("status", "active")
    .limit(1);

  if (accountsError) {
    await supabase.auth.signOut();
    return { error: "unavailable", email };
  }
  if (!accounts || accounts.length === 0) {
    await supabase.auth.signOut();
    return { error: "noAccess", email };
  }

  // Outside any try/catch: redirect() works by throwing.
  redirect(STUDIO_HOME);
}

export async function signOut(): Promise<void> {
  const supabase = await studioSupabase();
  // "local": this browser only. Signing out on the laptop should not also
  // sign the phone out halfway through an upload.
  await supabase.auth.signOut({ scope: "local" });
  redirect(STUDIO_LOGIN);
}

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/**
 * Same cookie, name and lifetime as rememberLocale() on the public site, so a
 * language chosen in either place holds in both. Setting a cookie in an action
 * re-renders the page in the new language in the same round trip.
 */
export async function setStudioLocale(formData: FormData): Promise<void> {
  const next = String(formData.get("locale") ?? "");
  if (!isLocale(next)) return;
  (await cookies()).set(LOCALE_COOKIE, next, {
    path: "/",
    maxAge: ONE_YEAR_SECONDS,
    sameSite: "lax",
  });
}
