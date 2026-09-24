// Runs the Bunny → Supabase sync, then invalidates exactly the cache tags
// that went stale — in the same process, so new photos are live seconds after
// the sync finishes with no redeploy.

import { revalidateTag } from "next/cache";
import { timingSafeEqual } from "node:crypto";

import { syncGallery, syncAllGalleries, type SyncResult } from "@/src/lib/sync-bunny";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SECRET = process.env.REVALIDATE_SECRET;

// Constant-time compare, so response timing can't leak the secret one
// character at a time.
function authorized(req: Request): boolean {
  if (!SECRET) return false;
  const header = req.headers.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(provided);
  const b = Buffer.from(SECRET);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Next 16 wants a cacheLife profile as the second argument; the one-argument
// form is deprecated and fails the type check.
//
// "max" is stale-while-revalidate: the entry is marked stale, the next visitor
// gets the old page, and a fresh one regenerates behind them. So the first
// reload after a sync still shows the old photos and the second shows the new.
// Expected. Swap for { expire: 0 } to regenerate synchronously instead — at
// this traffic there is no herd to worry about either way.
const PROFILE = "max";

function revalidate(results: SyncResult[]): void {
  revalidateTag("albums", PROFILE);
  for (const r of results) revalidateTag(`album:${r.slug.toLowerCase()}`, PROFILE);
  revalidateTag("client-galleries", PROFILE); 
}

export async function POST(req: Request): Promise<Response> {
  if (!authorized(req)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const params = new URL(req.url).searchParams;

  if (params.get("only") === "revalidate") {
    revalidate([]);
    return Response.json({ ok: true, revalidated: ["albums", "client-galleries"] });
  }

  const gallery = params.get("gallery");

  try {
    // One gallery at a time: syncing everything can outrun the function timeout on a first run
    const results =
      !gallery || gallery === "all"
        ? await syncAllGalleries()
        : [await syncGallery(gallery)];

    revalidate(results);
    return Response.json({ ok: true, results });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("sync failed:", message);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}