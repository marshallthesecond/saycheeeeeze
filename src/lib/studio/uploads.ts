// Uploading from the Studio, the server's half.
//
// The Studio asks for tickets (startUploadBatch); the browser then sends each
// file straight to the "upload door" those tickets name. Today the door is the
// worker on the laptop (scripts/studio-worker.mjs); later it can be Bunny S3,
// which changes what a ticket holds and nothing else.
//
// Everything runs as the signed-in photographer through Row Level Security
// and the studio_ functions in 20261116090000_studio_uploads.sql. Never the
// service key.

import "server-only";

import { studioSupabase } from "./supabase";
import type { StudioSession } from "./session";
import {
  UPLOAD_MAX_FILES,
  naturalCompare,
  storedFileName,
  uploadProblem,
  uploadType,
  type UploadCandidate,
  type UploadProblem,
} from "./upload-rules";

/** Where the browser sends the files. Only "worker" exists so far. */
export interface UploadDoor {
  kind: "worker";
  /** e.g. http://127.0.0.1:7811 — files go to `${url}/uploads/${id}`. */
  url: string;
  worker: string;
}

/** One file's ticket. The token is shown once; only its hash is kept. */
export interface UploadTicket {
  id: string;
  /** The file's own name. */
  name: string;
  /** The name it is stored under. */
  file: string;
  size: number;
  token: string;
  /** How much of it the door already has (renewed tickets only). */
  bytesReceived?: number;
}

export interface StartedBatch {
  batchId: string;
  door: UploadDoor;
  expiresAt: string;
  uploads: UploadTicket[];
}

export type UploadFileStatus =
  | "waiting"
  | "uploading"
  | "queued"
  | "processing"
  | "ready"
  | "failed"
  | "skipped"
  | "cancelled";

export interface UploadFileView {
  id: string;
  name: string;
  /** Where it is (or will be) in storage. */
  storagePath: string;
  size: number;
  bytesReceived: number;
  status: UploadFileStatus;
  /** A short reason: not_an_image, duplicate, storage, file_missing... */
  error: string | null;
  errorDetail: string | null;
  photoId: string;
}

export interface UploadBatchView {
  id: string;
  galleryId: string;
  /** Filled by listUploadBatches(). */
  gallery?: { slug: string; title: string } | null;
  status: "uploading" | "processing" | "done" | "cancelled";
  fileCount: number;
  totalBytes: number;
  ready: number;
  failed: number;
  skipped: number;
  cancelled: number;
  createdAt: string;
  finishedAt: string | null;
}

export interface WorkerStatus {
  online: boolean;
  name: string | null;
  lastSeenAt: string | null;
}

/** A refusal, as a short reason the Studio turns into a sentence. */
export class UploadRefused extends Error {
  constructor(
    readonly reason: string,
    readonly detail?: Record<string, unknown>,
  ) {
    super(reason);
  }
}

/** 'studio:worker_offline' -> 'worker_offline'. Anything else is a real error. */
function refusal(error: { message?: string } | null): UploadRefused | null {
  const m = error?.message?.match(/^studio:([a-z_]+)$/);
  return m ? new UploadRefused(m[1]) : null;
}

/** A worker counts as online for 90 seconds after it last said so. */
const ONLINE_MS = 90_000;

interface DoorAnswer {
  batch_id: string;
  door: string;
  worker: string;
  expires_at: string;
  uploads: { id: string; name?: string; file?: string; size?: number; token: string; bytes_received?: number }[];
}

function toDoor(answer: DoorAnswer): UploadDoor {
  return { kind: "worker", url: answer.door, worker: answer.worker };
}

/**
 * Tickets for a drop of files into a gallery.
 *
 * Files the rules refuse are refused here, all together, with which and why,
 * before anything is created. The rest are put in the order of the names
 * they are stored under, which is the order they will show in.
 */
export async function startUploadBatch(galleryId: string, files: UploadCandidate[]): Promise<StartedBatch> {
  if (!Array.isArray(files) || files.length === 0) throw new UploadRefused("files");
  if (files.length > UPLOAD_MAX_FILES) throw new UploadRefused("too_many_files", { max: UPLOAD_MAX_FILES });

  const refused: { name: string; problem: UploadProblem }[] = [];
  for (const f of files) {
    const problem = uploadProblem(f);
    if (problem) refused.push({ name: String(f.name), problem });
  }
  if (refused.length) throw new UploadRefused("refused_files", { files: refused });

  const ordered = files
    .map((f) => ({
      name: String(f.name).slice(0, 255),
      file: storedFileName(f),
      type: uploadType(f)!,
      size: f.size,
    }))
    // The stored names, because that is the order the gallery ends up in
    // (the worker sorts it by them when the drop is done).
    .sort((a, b) => naturalCompare(a.file, b.file));

  const supabase = await studioSupabase();
  const { data, error } = await supabase.rpc("studio_create_upload_batch", {
    p_gallery_id: galleryId,
    p_files: ordered,
  });
  if (error) throw refusal(error) ?? new Error(`Studio: could not start the upload: ${error.message}`);

  const answer = data as unknown as DoorAnswer;
  return {
    batchId: answer.batch_id,
    door: toDoor(answer),
    expiresAt: answer.expires_at,
    uploads: answer.uploads.map((u) => ({
      id: u.id,
      name: u.name ?? "",
      file: u.file ?? "",
      size: Number(u.size ?? 0),
      token: u.token,
    })),
  };
}

/** New tickets for the files of a drop still on their way. */
export async function renewUploadTickets(batchId: string): Promise<StartedBatch> {
  const supabase = await studioSupabase();
  const { data, error } = await supabase.rpc("studio_renew_upload_tickets", { p_batch_id: batchId });
  if (error) throw refusal(error) ?? new Error(`Studio: could not renew the tickets: ${error.message}`);
  const answer = data as unknown as DoorAnswer;
  return {
    batchId: answer.batch_id,
    door: toDoor(answer),
    expiresAt: answer.expires_at,
    uploads: answer.uploads.map((u) => ({
      id: u.id,
      name: "",
      file: "",
      size: 0,
      token: u.token,
      bytesReceived: Number(u.bytes_received ?? 0),
    })),
  };
}

export type RetryAnswer =
  | { status: "queued" }
  | { status: "waiting"; door: UploadDoor; ticket: { id: string; token: string } };

/** A failed file again: rebuilt from the worker's copy, or sent again. */
export async function retryUpload(uploadId: string): Promise<RetryAnswer> {
  const supabase = await studioSupabase();
  const { data, error } = await supabase.rpc("studio_retry_upload", { p_upload_id: uploadId });
  if (error) throw refusal(error) ?? new Error(`Studio: could not retry: ${error.message}`);
  const a = data as unknown as { id: string; status: string; door?: string; worker?: string; token?: string };
  if (a.status === "waiting" && a.door && a.worker && a.token) {
    return { status: "waiting", door: { kind: "worker", url: a.door, worker: a.worker }, ticket: { id: a.id, token: a.token } };
  }
  return { status: "queued" };
}

/** Takes files out of a drop (all of them when `uploadIds` is left out). */
export async function cancelUploads(batchId: string, uploadIds?: string[]): Promise<number> {
  const supabase = await studioSupabase();
  const { data, error } = await supabase.rpc("studio_cancel_uploads", {
    p_batch_id: batchId,
    ...(uploadIds ? { p_upload_ids: uploadIds } : {}),
  });
  if (error) throw refusal(error) ?? new Error(`Studio: could not cancel: ${error.message}`);
  return Number(data ?? 0);
}

const BATCH_COLUMNS =
  "id, gallery_id, status, file_count, total_bytes, ready_count, failed_count, skipped_count, cancelled_count, created_at, finished_at";
// ONE string literal: supabase-js reads the columns from it at the type level.
const BATCH_WITH_GALLERY =
  "id, gallery_id, status, file_count, total_bytes, ready_count, failed_count, skipped_count, cancelled_count, created_at, finished_at, galleries(slug, title)";

type BatchRow = {
  id: string;
  gallery_id: string;
  status: string;
  file_count: number;
  total_bytes: number;
  ready_count: number;
  failed_count: number;
  skipped_count: number;
  cancelled_count: number;
  created_at: string;
  finished_at: string | null;
  galleries?: { slug: string; title: string } | { slug: string; title: string }[] | null;
};

function toBatch(r: BatchRow): UploadBatchView {
  const g = Array.isArray(r.galleries) ? r.galleries[0] : r.galleries;
  return {
    id: r.id,
    galleryId: r.gallery_id,
    ...(r.galleries !== undefined ? { gallery: g ? { slug: g.slug, title: g.title } : null } : {}),
    status: r.status as UploadBatchView["status"],
    fileCount: r.file_count,
    totalBytes: Number(r.total_bytes),
    ready: r.ready_count,
    failed: r.failed_count,
    skipped: r.skipped_count,
    cancelled: r.cancelled_count,
    createdAt: r.created_at,
    finishedAt: r.finished_at,
  };
}

/** One drop and its files, or null when it is not this account's. */
export async function getUploadBatch(
  session: StudioSession,
  batchId: string,
): Promise<{ batch: UploadBatchView; files: UploadFileView[] } | null> {
  const supabase = await studioSupabase();
  const [batch, files] = await Promise.all([
    supabase
      .from("upload_batches")
      .select(BATCH_COLUMNS)
      .eq("id", batchId)
      .eq("account_id", session.account.id)
      .maybeSingle(),
    supabase
      .from("uploads")
      .select("id, original_name, storage_path, size_bytes, bytes_received, status, error, error_detail, photo_id")
      .eq("batch_id", batchId)
      .eq("account_id", session.account.id)
      .order("sort_order", { ascending: true }),
  ]);
  if (batch.error) throw new Error(`Studio: could not load the upload: ${batch.error.message}`);
  if (files.error) throw new Error(`Studio: could not load the files: ${files.error.message}`);
  if (!batch.data) return null;

  return {
    batch: toBatch(batch.data as BatchRow),
    files: (files.data ?? []).map((u) => ({
      id: u.id,
      name: u.original_name,
      storagePath: u.storage_path,
      size: Number(u.size_bytes),
      bytesReceived: Number(u.bytes_received),
      status: u.status as UploadFileStatus,
      error: u.error,
      errorDetail: u.error_detail,
      photoId: u.photo_id,
    })),
  };
}

/** The account's most recent drops, newest first; one gallery's when given. */
export async function listUploadBatches(
  session: StudioSession,
  options: { galleryId?: string; limit?: number } = {},
): Promise<UploadBatchView[]> {
  const supabase = await studioSupabase();
  let q = supabase
    .from("upload_batches")
    .select(BATCH_WITH_GALLERY)
    .eq("account_id", session.account.id)
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(options.limit ?? 20, 1), 100));
  if (options.galleryId) q = q.eq("gallery_id", options.galleryId);
  const { data, error } = await q;
  if (error) throw new Error(`Studio: could not load the uploads: ${error.message}`);
  return ((data ?? []) as unknown as BatchRow[]).map(toBatch);
}

/** A failed file, for the Uploads screen. */
export interface FailedUpload {
  id: string;
  batchId: string;
  name: string;
  error: string | null;
  errorDetail: string | null;
}

/** The failed files of these drops. */
export async function listFailedUploads(session: StudioSession, batchIds: string[]): Promise<FailedUpload[]> {
  if (batchIds.length === 0) return [];
  const supabase = await studioSupabase();
  const { data, error } = await supabase
    .from("uploads")
    .select("id, batch_id, original_name, error, error_detail")
    .eq("account_id", session.account.id)
    .eq("status", "failed")
    .in("batch_id", batchIds)
    .order("sort_order", { ascending: true });
  if (error) throw new Error(`Studio: could not load the failed files: ${error.message}`);
  return (data ?? []).map((u) => ({
    id: u.id,
    batchId: u.batch_id,
    name: u.original_name,
    error: u.error,
    errorDetail: u.error_detail,
  }));
}

/**
 * The drops of one gallery that still need attention, with their files, in
 * the shape the upload panel takes: not finished yet, or finished in the last
 * day with failed files.
 */
export async function unfinishedUploads(
  session: StudioSession,
  galleryId: string,
): Promise<{ batch: { id: string; status: string }; files: Omit<UploadFileView, "storagePath" | "errorDetail" | "photoId">[] }[]> {
  const recent = await listUploadBatches(session, { galleryId, limit: 10 });
  const dayAgo = Date.now() - 24 * 3600_000;
  const open = recent.filter(
    (b) =>
      b.status === "uploading" ||
      b.status === "processing" ||
      (b.failed > 0 && new Date(b.createdAt).getTime() > dayAgo),
  );
  const found = await Promise.all(open.map((b) => getUploadBatch(session, b.id)));
  return found
    .filter((f): f is NonNullable<typeof f> => f !== null)
    .map(({ batch, files }) => ({
      batch: { id: batch.id, status: batch.status },
      files: files.map((f) => ({
        id: f.id,
        name: f.name,
        size: f.size,
        bytesReceived: f.bytesReceived,
        status: f.status,
        error: f.error,
      })),
    }));
}

/** Is a worker ready to receive files? */
export async function getWorkerStatus(): Promise<WorkerStatus> {
  const supabase = await studioSupabase();
  const { data, error } = await supabase
    .from("workers")
    .select("name, last_seen_at, accepting_uploads")
    .order("last_seen_at", { ascending: false })
    .limit(5);
  if (error) throw new Error(`Studio: could not read the worker: ${error.message}`);

  const now = Date.now();
  const online = (data ?? []).find(
    (w) => w.accepting_uploads && now - new Date(w.last_seen_at).getTime() < ONLINE_MS,
  );
  const latest = online ?? data?.[0];
  return {
    online: Boolean(online),
    name: latest?.name ?? null,
    lastSeenAt: latest?.last_seen_at ?? null,
  };
}
