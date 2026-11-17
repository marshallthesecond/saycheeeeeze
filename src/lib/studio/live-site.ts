// After a change in the Studio, the site's pages are expired where the Studio
// runs (updateTag in gallery-actions.ts). When that is not the live site, a
// dev preview or `pnpm dev` against the real database, the live site keeps
// its own cache and would show the old state for up to an hour: an album
// just unpublished, a photo just deleted. So it is asked as well, through
// the same /api/sync the worker uses.
//
// The secret goes only to NEXT_PUBLIC_SITE_URL, a setting, never to an
// address taken from the request.

import "server-only";

import { headers } from "next/headers";
import { after } from "next/server";
import { SITE_URL } from "@/src/lib/seo";

const bare = (host: string) => host.toLowerCase().replace(/^www\./, "");

export async function alsoRefreshLiveSite(slug: string): Promise<void> {
  const secret = process.env.REVALIDATE_SECRET;
  if (!secret) return;

  let live: URL;
  try {
    live = new URL(SITE_URL);
  } catch {
    return;
  }
  const h = await headers();
  const here = h.get("x-forwarded-host") ?? h.get("host");
  // On the live site itself (www or not): updateTag already did it.
  if (!here || bare(here) === bare(live.host)) return;

  const url = `${live.origin}/api/sync?only=revalidate&now=1&gallery=${encodeURIComponent(slug)}`;
  // After the answer, so the photographer does not wait on another site.
  after(async () => {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${secret}` },
        cache: "no-store",
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) console.error(`Studio: ${live.host} answered ${res.status} when asked to refresh "${slug}"`);
    } catch (err) {
      console.error(`Studio: could not ask ${live.host} to refresh "${slug}": ${err instanceof Error ? err.message : err}`);
    }
  });
}
