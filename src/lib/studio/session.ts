// Who is signed in to the Studio, and which account they are working in.
//
// Every Studio page and every Studio action starts with requireStudio(). The
// proxy also turns signed-out visitors away, but that check only reads the
// cookie and is there to save a round trip. This one asks Supabase, and it is
// the one that counts.

import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import { STUDIO_LOGIN, isAuthOutage } from "./config";
import { studioSupabase } from "./supabase";

export interface StudioAccount {
  id: string;
  username: string;
  displayName: string;
  plan: string;
  storageUsedBytes: number;
  /** null = no limit. */
  storageQuotaBytes: number | null;
  /** Folder in the storage zone this account's files sit under. '' = the zone root. */
  storagePrefix: string;
}

export interface StudioSession {
  userId: string;
  email: string | null;
  role: "owner" | "editor";
  account: StudioAccount;
}

export type StudioState =
  | { kind: "signed-out" }
  /** A valid login that belongs to no active account. */
  | { kind: "no-account" }
  | { kind: "ok"; session: StudioSession };

/**
 * cache(): the layout and the page both ask during one render, and the answer
 * is two requests to Supabase. Memoised per request, never across requests.
 */
export const getStudioState = cache(async (): Promise<StudioState> => {
  const supabase = await studioSupabase();

  // getUser() and not getSession(): getSession() trusts whatever is in the
  // cookie, getUser() has Supabase confirm the token is real and not revoked.
  const { data, error } = await supabase.auth.getUser();
  // No answer is not the same as "no". Throwing lands on the Studio's error
  // screen with a Try again button, and the session cookie is left alone, so
  // the photographer is back in as soon as Supabase answers.
  if (isAuthOutage(error)) {
    throw new Error(`Studio: Supabase did not answer (${error?.message ?? "no details"}).`);
  }
  const user = data?.user;
  if (error || !user) return { kind: "signed-out" };

  // Both reads go through Row Level Security: this user sees only the
  // accounts they belong to and only their own memberships.
  const [accounts, members] = await Promise.all([
    supabase
      .from("accounts")
      .select("id, username, display_name, plan, status, storage_used_bytes, storage_quota_bytes, storage_prefix")
      .eq("status", "active")
      .order("created_at", { ascending: true }),
    supabase.from("account_members").select("account_id, role").eq("user_id", user.id),
  ]);

  if (accounts.error || members.error) {
    const why = (accounts.error ?? members.error)?.message ?? "unknown error";
    throw new Error(
      `Studio: could not load the account (${why}). ` +
        "If the tables are missing, run supabase/migrations/20261114190000_accounts_and_members.sql.",
    );
  }

  // The first account, oldest first. An account switcher comes with the
  // second account; until then there is exactly one.
  const account = accounts.data?.[0];
  const member = members.data?.find((m) => m.account_id === account?.id);
  if (!account || !member) return { kind: "no-account" };

  return {
    kind: "ok",
    session: {
      userId: user.id,
      email: user.email ?? null,
      role: member.role === "editor" ? "editor" : "owner",
      account: {
        id: account.id,
        username: account.username,
        displayName: account.display_name,
        plan: account.plan,
        storageUsedBytes: account.storage_used_bytes,
        storageQuotaBytes: account.storage_quota_bytes,
        storagePrefix: account.storage_prefix,
      },
    },
  };
});

/** The session, or a redirect to the sign-in page. Never returns without one. */
export async function requireStudio(): Promise<StudioSession> {
  const state = await getStudioState();
  if (state.kind === "ok") return state.session;
  redirect(state.kind === "no-account" ? `${STUDIO_LOGIN}?e=no-access` : STUDIO_LOGIN);
}
