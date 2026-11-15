// One drop of files.
//
//   GET  /api/studio/uploads/<batch>    the drop and every file in it
//   POST /api/studio/uploads/<batch>    { action: "retry", uploadId }
//                                       { action: "cancel", uploadIds? }   all when left out
//                                       { action: "renew" }   new tickets for files still on their way

import {
  UploadRefused,
  cancelUploads,
  getUploadBatch,
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

  const found = await getUploadBatch(session, batch);
  if (!found) return json(404, { error: "not_found" });
  return json(200, found);
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
      default:
        return json(400, { error: "action" });
    }
  } catch (err) {
    if (err instanceof UploadRefused) return refusalResponse(err);
    throw err;
  }
}
