// One drop of files.
//
//   GET  /api/studio/uploads/<batch>    the drop, every file in it, and the worker
//   POST /api/studio/uploads/<batch>    { action: "retry", uploadId }
//                                       { action: "cancel", uploadIds? }   all when left out
//                                       { action: "renew" }   new tickets for files still on their way
//                                       { action: "refresh" } this site's pages for the drop's gallery, once
//                                                             the worker is done with it

import { revalidateTag } from "next/cache";

import {
  UploadRefused,
  cancelUploads,
  dropRefresh,
  getUploadBatch,
  getWorkerStatus,
  renewUploadTickets,
  retryUpload,
} from "@/src/lib/studio/uploads";
import { fromThisSite, isUuid, json, readJson, refusalResponse, studioApiSession } from "@/src/lib/studio/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ batch: string }> };

export async function GET(_req: Request, { params }: Ctx): Promise<Response> {
  const session = await studioApiSession();
  if (session instanceof Response) return session;

  const { batch } = await params;
  if (!isUuid(batch)) return json(404, { error: "not_found" });

  const [found, worker] = await Promise.all([getUploadBatch(session, batch), getWorkerStatus()]);
  if (!found) return json(404, { error: "not_found" });
  return json(200, { ...found, worker });
}

export async function POST(req: Request, { params }: Ctx): Promise<Response> {
  if (!fromThisSite(req)) return json(403, { error: "origin" });
  const session = await studioApiSession();
  if (session instanceof Response) return session;

  const { batch } = await params;
  if (!isUuid(batch)) return json(404, { error: "not_found" });

  const body = (await readJson(req)) as { action?: unknown; uploadId?: unknown; uploadIds?: unknown } | null;
  if (!body) return json(400, { error: "action" });

  try {
    switch (body.action) {
      case "retry": {
        if (!isUuid(body.uploadId)) return json(400, { error: "upload" });
        // The file must belong to this drop, not just to the account.
        const found = await getUploadBatch(session, batch);
        if (!found?.files.some((f) => f.id === body.uploadId)) return json(404, { error: "not_found" });
        return json(200, await retryUpload(body.uploadId));
      }
      case "cancel": {
        let ids: string[] | undefined;
        if (body.uploadIds !== undefined) {
          if (!Array.isArray(body.uploadIds) || body.uploadIds.length > 500 || !body.uploadIds.every(isUuid)) {
            return json(400, { error: "upload" });
          }
          ids = body.uploadIds;
        }
        return json(200, { cancelled: await cancelUploads(batch, ids) });
      }
      case "renew":
        return json(200, await renewUploadTickets(batch));
      case "refresh": {
        // After a drop the worker refreshes www, and only www. This does the
        // same for the site the Studio is open on, which may be another one
        // (a dev preview, pnpm dev) with a cache of its own.
        const drop = await dropRefresh(session, batch);
        if (!drop) return json(404, { error: "not_found" });
        if (drop.state !== "ready") return json(200, { state: drop.state });
        // { expire: 0 }: the next visitor waits for the new page instead of
        // being given the cached one first. Same tags as /api/sync.
        revalidateTag("albums", { expire: 0 });
        revalidateTag(`album:${drop.slug.toLowerCase()}`, { expire: 0 });
        revalidateTag("client-galleries", { expire: 0 });
        return json(200, { state: "refreshed" });
      }
      default:
        return json(400, { error: "action" });
    }
  } catch (err) {
    if (err instanceof UploadRefused) return refusalResponse(err);
    throw err;
  }
}
