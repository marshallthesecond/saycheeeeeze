// The Studio's uploads.
//
//   GET  /api/studio/uploads[?gallery=<id>]   is the worker on, and recent drops
//   POST /api/studio/uploads                  tickets for a new drop
//        { galleryId, files: [{ name, size, type }] }
//     -> 201 { batchId, door: { kind, url, worker }, expiresAt,
//              uploads: [{ id, name, file, size, token }] }
//     -> 4xx { error: "<reason>", ... }   reasons in uploads.ts / the migration
//
// The browser then sends each file to `${door.url}/uploads/${id}` (see
// scripts/studio-worker.mjs for how). Nothing here touches the files.

import { UploadRefused, getWorkerStatus, listUploadBatches, startUploadBatch } from "@/src/lib/studio/uploads";
import type { UploadCandidate } from "@/src/lib/studio/upload-rules";
import { fromThisSite, isUuid, json, readJson, refusalResponse, studioApiSession } from "@/src/lib/studio/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const session = await studioApiSession();
  if (session instanceof Response) return session;

  const gallery = new URL(req.url).searchParams.get("gallery");
  if (gallery !== null && !isUuid(gallery)) return json(400, { error: "gallery" });

  const [worker, batches] = await Promise.all([
    getWorkerStatus(),
    listUploadBatches(session, { galleryId: gallery ?? undefined }),
  ]);
  return json(200, { worker, batches });
}

export async function POST(req: Request): Promise<Response> {
  if (!fromThisSite(req)) return json(403, { error: "origin" });
  const session = await studioApiSession();
  if (session instanceof Response) return session;

  const body = (await readJson(req)) as { galleryId?: unknown; files?: unknown } | null;
  if (!body || !isUuid(body.galleryId)) return json(400, { error: "gallery" });
  if (!Array.isArray(body.files)) return json(400, { error: "files" });

  const files: UploadCandidate[] = [];
  for (const f of body.files) {
    if (!f || typeof f !== "object") return json(400, { error: "files" });
    const { name, size, type } = f as Record<string, unknown>;
    if (typeof name !== "string" || typeof size !== "number") return json(400, { error: "files" });
    files.push({ name, size, type: typeof type === "string" ? type : "" });
  }

  try {
    const started = await startUploadBatch(body.galleryId, files);
    return json(201, started);
  } catch (err) {
    if (err instanceof UploadRefused) return refusalResponse(err);
    throw err;
  }
}
