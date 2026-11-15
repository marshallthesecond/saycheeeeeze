// What may be uploaded, and the name a file is stored under.
//
// Shared by the server (src/lib/studio/uploads.ts) and, from step 5, the
// browser, so both refuse the same files before anything is sent. The
// database checks the same rules again in studio_create_upload_batch()
// (supabase/migrations/20261116090000_studio_uploads.sql).

import { latinize } from "./slug";

/** 100 MB a file, the limit agreed on 2026-11-14. */
export const UPLOAD_MAX_BYTES = 100 * 1024 * 1024;
/** Files in one drop. More can be dropped again afterwards. */
export const UPLOAD_MAX_FILES = 500;
/** The size of each piece the browser sends to the worker. */
export const UPLOAD_PIECE_BYTES = 8 * 1024 * 1024;
/** Files sent at the same time. */
export const UPLOAD_PARALLEL = 3;

export type UploadType = "image/jpeg" | "image/png";

export type UploadProblem = "type" | "size" | "empty";

/** A file as the browser describes it. */
export interface UploadCandidate {
  name: string;
  size: number;
  type: string;
}

const EXTENSIONS: Record<string, UploadType> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
};

function splitName(name: string): { stem: string; ext: string } {
  const base = name.split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return { stem: base, ext: "" };
  return { stem: base.slice(0, dot), ext: base.slice(dot + 1).toLowerCase() };
}

/**
 * JPEG or PNG, decided by the extension first: browsers leave `type` empty
 * for some files, and the worker checks the real bytes anyway.
 */
export function uploadType(file: Pick<UploadCandidate, "name" | "type">): UploadType | null {
  const { ext } = splitName(file.name);
  if (ext) return EXTENSIONS[ext] ?? null;
  if (file.type === "image/jpeg" || file.type === "image/png") return file.type;
  return null;
}

/** Why a file cannot be uploaded, or null. */
export function uploadProblem(file: UploadCandidate): UploadProblem | null {
  if (!uploadType(file)) return "type";
  if (!Number.isSafeInteger(file.size) || file.size <= 0) return "empty";
  if (file.size > UPLOAD_MAX_BYTES) return "size";
  return null;
}

const STEM_MAX = 100;

/**
 * The name a file is stored under in the gallery's folder: Latin letters,
 * digits, dots, hyphens and underscores, a lower-case extension.
 *
 *   "IMG_0042.JPG"        -> "IMG_0042.jpg"
 *   "Фото Камилы (2).png" -> "Foto-Kamily-2.png"
 *   "ёлка.jpeg"           -> "yolka.jpeg"
 *
 * Only the stored name changes; the Studio keeps the original one. If the
 * gallery already has the name, the database adds "-2", "-3"...
 */
export function storedFileName(file: Pick<UploadCandidate, "name" | "type">): string {
  const type = uploadType(file);
  const { stem, ext } = splitName(file.name);
  const extension = ext && EXTENSIONS[ext] ? ext : type === "image/png" ? "png" : "jpg";

  const clean =
    latinize(ext ? stem : (file.name.split(/[\\/]/).pop() ?? ""))
      // o'zbek -> ozbek, not o-zbek.
      .replace(/['’ʻʼ`]/g, "")
      // é -> e
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/-{2,}/g, "-")
      .replace(/^[._-]+/, "")
      .slice(0, STEM_MAX)
      .replace(/[._-]+$/, "") || "photo";

  return `${clean}.${extension}`;
}

/** The same check the database makes on a stored name. */
export function isStoredFileName(name: string): boolean {
  return /^[A-Za-z0-9]([A-Za-z0-9._-]{0,98}[A-Za-z0-9])?\.(jpg|jpeg|png)$/.test(name);
}

/** "IMG_2.jpg" before "IMG_10.jpg", as reseed.ts and the worker sort. */
export function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, "en", { numeric: true });
}
