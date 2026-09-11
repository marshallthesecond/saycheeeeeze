// src/lib/gallery.ts
//
// Browser-side helpers for client galleries: thumbnails, downloads, zip,
// sharing and the "ask the photographer" message builder.
//
// Everything here assumes it runs in the browser — import it from client
// components only.
//
// ── Two things must be true on the Bunny pull zone for this to work ──
//   1. CORS enabled (Access-Control-Allow-Origin). Without it every fetch()
//      below fails and downloads silently fall back to opening a tab, and
//      sharing the actual image file stops working entirely.
//   2. Bunny Optimizer enabled, if you want thumbUrl() to do anything. Set
//      BUNNY_OPTIMIZER to false to serve originals into the grid instead.

import {
  downloadOptions,
  hasLadder,
  preferredTier,
  shareSrc,
  tierFileName,
  urlFileName,
  type DownloadablePhoto,
  type DownloadTier,
} from "./ladder";

export type { DownloadablePhoto, DownloadTier };

/** Set to false if Image Optimizer isn't enabled on the pull zone. */
export const BUNNY_OPTIMIZER = true;

// ─────────────────────────────────────────────────────────────
// Thresholds
// ─────────────────────────────────────────────────────────────

/**
 * When many photos stop being separate files and become an archive.
 *
 * This is not a tidiness preference. Chrome asks "Download multiple files?" on
 * the SECOND file of a batch and silently drops every one after it if the
 * client dismisses the prompt; iOS Safari is worse. So a hundred individual
 * saves is not a noisier experience than a zip, it is an unreliable one — and
 * the client discovers that by counting their files a week later.
 *
 * Below the first threshold individual files genuinely are nicer: nothing to
 * unpack, and they go straight into a share sheet.
 */
export const ZIP_DEFAULT_ABOVE = 10;
export const ZIP_ONLY_ABOVE = 30;

/**
 * The ceiling for the in-memory zip path.
 *
 * Chromium streams the archive to disk through showSaveFilePicker and never
 * holds it. Safari and Firefox have no picker, so client-zip's output has to be
 * collected into a Blob first — and a couple of gigabytes of originals in a
 * Blob is a killed tab, on a phone especially. Above this, offer batches.
 */
export const BLOB_ZIP_LIMIT_BYTES = 1.5 * 1024 * 1024 * 1024;

/**
 * Above this, a single download goes through the save picker and streams,
 * rather than being assembled as a Blob in memory.
 */
const STREAM_ABOVE_BYTES = 12 * 1024 * 1024;

/** Never cache a File this big for sharing — see fetchPhotoFile. */
const MAX_CACHEABLE_BYTES = 4 * 1024 * 1024;

// ─────────────────────────────────────────────────────────────
// What a download actually is
// ─────────────────────────────────────────────────────────────

/**
 * Does this browser let a page stream a download straight to a file the user
 * picked?
 *
 * The `typeof window` guard is not decoration. This is called from a component
 * body, and Next renders client components on the server too, where `window`
 * does not exist — an unguarded reference is a ReferenceError that takes the
 * whole page down. It happens to have been safe until now only because the
 * expression that calls it short-circuits before reaching it during SSR, which
 * is not a property worth relying on.
 */
export function canSaveStreamed(): boolean {
  if (typeof window === "undefined") return false;
  return typeof (window as unknown as { showSaveFilePicker?: unknown })
    .showSaveFilePicker === "function";
}

/**
 * Is the client on a connection where a large download is a bad idea?
 *
 * Network Information API — Chrome and most Android browsers have it, Safari
 * and Firefox do not, and there is no substitute. So this is a one-way signal:
 * true means "we know this is a poor moment for 1.8 GB", false means "we have
 * no idea", never "the connection is fine". The UI treats it accordingly and
 * warns on size alone as well.
 *
 * saveData is the strongest signal there is — the client has explicitly asked
 * every site to send less.
 */
export function isMeteredConnection(): boolean {
  if (typeof navigator === "undefined") return false;
  const c = (navigator as Navigator & {
    connection?: { saveData?: boolean; effectiveType?: string };
  }).connection;
  if (!c) return false;
  if (c.saveData) return true;
  return c.effectiveType === "slow-2g" || c.effectiveType === "2g" || c.effectiveType === "3g";
}

/** Warn above this, whatever the connection says. */
export const LARGE_DOWNLOAD_BYTES = 500 * 1024 * 1024;

/**
 * Numbering for files that arrive as a SET.
 *
 * A client who downloads forty photos gets forty files named after camera
 * counters — 3M0A0217, 3M0A0231 — which sort in shooting order only by
 * accident and mean nothing to the print shop they get handed to. A leading
 * index preserves the gallery's own order and survives being copied around.
 *
 * The camera name is kept rather than replaced, because it is the shared
 * vocabulary between you and the client: "can you retouch 3M0A0217" has to
 * keep working. Single downloads are not numbered — one file is not a set.
 *
 * Set to false to go back to plain camera names everywhere.
 */
export const NUMBER_FILES_IN_SETS = true;

function numbered(name: string, index: number, total: number): string {
  if (!NUMBER_FILES_IN_SETS) return name;
  const width = Math.max(3, String(total).length);
  return `${String(index + 1).padStart(width, "0")}-${name}`;
}

/**
 * The URL a download should fetch, for a chosen tier.
 *
 * Falls back through preferredTier() rather than trusting the argument,
 * because a remembered choice can name a tier this gallery no longer offers —
 * you switched originals off after the client had already picked them — and
 * the honest response to that is the best available option, not a broken URL.
 */
export function downloadUrl(
  photo: DownloadablePhoto,
  tier: DownloadTier | null = null,
  allowed?: DownloadTier[],
): string {
  return preferredTier(downloadOptions(photo, allowed), tier).url;
}

export function downloadName(
  photo: DownloadablePhoto,
  tier: DownloadTier | null = null,
  allowed?: DownloadTier[],
): string {
  const chosen = preferredTier(downloadOptions(photo, allowed), tier);
  return tierFileName(photo, chosen.tier);
}

/**
 * The URL to use for SHARING, which is never the original.
 *
 * A share sheet hands the file to Instagram or Telegram, which recompress it
 * anyway. Sending a 30 MB original into that is 30 MB of someone's mobile data
 * spent to arrive at the same picture.
 */
export function sharePhotoUrl(photo: DownloadablePhoto): string {
  return hasLadder(photo.ladder) ? shareSrc(photo.ladder) : photo.src;
}

/** Where clients reach you. Defined in contact.ts so server components can
 *  read it without importing this browser-only module; imported AND re-exported
 *  here so every existing client-side import keeps working unchanged — and so
 *  mailtoUrl()/telegramUrl() below still have it in scope, which a bare
 *  `export { CONTACT } from` would not have given them. */
import { CONTACT } from "./contact";
export { CONTACT };

// ─────────────────────────────────────────────────────────────
// URLs and filenames
// ─────────────────────────────────────────────────────────────

/**
 * A resized variant for the grid. Originals are full-resolution PNGs — a
 * 40-photo grid of those is tens of megabytes and several seconds of blank
 * boxes on a phone.
 */
export function thumbUrl(src: string, width: number, quality = 82): string {
  if (!BUNNY_OPTIMIZER || !/^https?:\/\//.test(src)) return src;
  try {
    const u = new URL(src);
    u.searchParams.set("width", String(width));
    u.searchParams.set("quality", String(quality));
    return u.toString();
  } catch {
    return src;
  }
}

/** "…/Portraits/Sara/3M0A1432.png?width=800" -> "3M0A1432.png" */
export const fileName = urlFileName;

/** Slug-safe name for the zip: "Sara — WIUT, Tashkent" -> "sara-wiut-tashkent" */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "gallery";
}

/**
 * A link that reopens the gallery on one specific photo. This is what makes
 * single-photo sharing worth anything without a backend — the recipient lands
 * on the photo, inside the gallery, and can keep browsing.
 */
export function photoDeepLink(index: number): string {
  const u = new URL(window.location.href);
  u.searchParams.set("p", String(index + 1));
  return u.toString();
}

/** Returns the 0-based photo index from ?p=, or null. */
export function readDeepLinkIndex(total: number): number | null {
  const raw = new URLSearchParams(window.location.search).get("p");
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > total) return null;
  return n - 1;
}

/** Keeps ?p= in step with the lightbox without triggering a Next.js navigation. */
export function syncDeepLink(index: number | null): void {
  const u = new URL(window.location.href);
  if (index === null) u.searchParams.delete("p");
  else u.searchParams.set("p", String(index + 1));
  window.history.replaceState(null, "", u.toString());
}

// ─────────────────────────────────────────────────────────────
// Fetching originals
// ─────────────────────────────────────────────────────────────

// navigator.share({ files }) has to be called while the tap that triggered it
// is still "active". Awaiting a fetch first blows that window on iOS Safari
// and throws NotAllowedError. So we warm this cache the moment a photo is
// opened or selected, and share reads from it instantly.
const fileCache = new Map<string, File>();
const MAX_CACHED_FILES = 24;

/**
 * ── Why there is a size guard on the cache ────────────────────
 * This map holds up to 24 whole files in memory, which was fine while every
 * caller fetched a ~400 KB share file or a ~4 MB delivery JPEG. Downloading
 * originals through it would mean 24 × 30 MB — most of a gigabyte held live in
 * a tab, on a phone, for a share sheet that will never be opened.
 *
 * The guard is on the RESPONSE size rather than on the URL, because it is the
 * bytes that are the problem and a rule that reads the path would need updating
 * every time a new tier appears.
 */
export async function fetchPhotoFile(src: string): Promise<File> {
  const cached = fileCache.get(src);
  if (cached) return cached;

  const res = await fetch(src, { mode: "cors", credentials: "omit" });
  if (!res.ok) throw new Error(`Could not fetch ${src} (${res.status})`);

  const blob = await res.blob();
  const file = new File([blob], fileName(src), {
    type: blob.type || "image/jpeg",
  });

  if (blob.size > MAX_CACHEABLE_BYTES) return file;

  if (fileCache.size >= MAX_CACHED_FILES) {
    const oldest = fileCache.keys().next().value;
    if (oldest) fileCache.delete(oldest);
  }
  fileCache.set(src, file);
  return file;
}

/** Fire-and-forget warm-up. Failures are fine — share falls back to a link. */
export function prefetchPhotoFile(src: string): void {
  void fetchPhotoFile(src).catch(() => {});
}

// ─────────────────────────────────────────────────────────────
// Downloads
// ─────────────────────────────────────────────────────────────

function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export interface TransferProgress {
  /** Bytes so far. */
  loaded: number;
  /** Total, when the server sent a Content-Length. */
  total?: number;
}

/**
 * Streams one response to disk through the save picker, counting as it goes.
 *
 * Returns false if the browser has no picker, so the caller can fall back to
 * the Blob path. Throws AbortError, which the caller treats as a cancel.
 *
 * The picker MUST be opened before any await that outlives the tap's user
 * activation, which is why it is the first thing this does.
 */
async function saveStreamed(
  url: string,
  name: string,
  onProgress?: (p: TransferProgress) => void,
): Promise<boolean> {
  const picker = (
    window as unknown as {
      showSaveFilePicker?: (opts: unknown) => Promise<FileSystemFileHandle>;
    }
  ).showSaveFilePicker;
  if (typeof picker !== "function") return false;

  const handle = await picker({
    suggestedName: name,
    types: [{ description: "Image", accept: { "image/jpeg": [".jpg", ".jpeg"] } }],
  });
  const writable = await handle.createWritable();

  try {
    const res = await fetch(url, { mode: "cors", credentials: "omit" });
    if (!res.ok || !res.body) throw new Error(`Could not fetch (${res.status})`);

    const header = res.headers.get("content-length");
    const total = header ? Number(header) : undefined;
    let loaded = 0;

    const counter = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        loaded += chunk.byteLength;
        onProgress?.({ loaded, total });
        controller.enqueue(chunk);
      },
    });

    await res.body.pipeThrough(counter).pipeTo(writable);
    return true;
  } catch (err) {
    // The handle already exists on disk at this point, so a failed transfer
    // leaves a truncated file. Closing is the best we can do from here; the
    // caller reports the failure.
    await writable.close().catch(() => {});
    throw err;
  }
}

/**
 * One photo, at one tier.
 *
 * The `download` attribute is ignored on cross-origin URLs, so a plain
 * <a download> pointed at Bunny just opens a tab — the bytes have to be fetched
 * and saved from a blob URL. Opening a tab is the fallback for when CORS isn't
 * available.
 *
 * Anything large goes through the save picker instead, which streams straight
 * to disk. That is not only about memory: a 30 MB original assembled as a Blob
 * gives the client no progress and no idea whether anything is happening, and
 * "nothing is happening" is when people tap the button a second time.
 */
export async function downloadPhoto(
  photo: DownloadablePhoto,
  tier: DownloadTier | null = null,
  allowed?: DownloadTier[],
  onProgress?: (p: TransferProgress) => void,
): Promise<void> {
  const chosen = preferredTier(downloadOptions(photo, allowed), tier);
  const name = tierFileName(photo, chosen.tier);
  const big =
    chosen.tier === "original" ||
    (chosen.bytes ?? 0) > STREAM_ABOVE_BYTES ||
    chosen.bytes === undefined;

  if (big) {
    try {
      if (await saveStreamed(chosen.url, name, onProgress)) return;
    } catch (err) {
      if ((err as Error)?.name === "AbortError") return; // client cancelled
      // Anything else: fall through and try the simple path.
    }
  }

  try {
    const file = await fetchPhotoFile(chosen.url);
    // file.name comes from the URL, which is "share.jpg" or "download.jpg" for
    // every ladder photo — so save under the real name instead.
    saveBlob(file, name);
  } catch {
    window.open(chosen.url, "_blank", "noopener,noreferrer");
  }
}

export interface BatchProgress {
  done: number;
  total: number;
}

/**
 * Many photos, as separate files.
 *
 * Offered only below ZIP_ONLY_ABOVE, and the reason is in the comment on that
 * constant: browsers gate this. The small stagger between saves is what keeps
 * Chrome and Firefox from treating the batch as a burst, and it is the only
 * lever available from here — the permission prompt itself is not something a
 * page can suppress or detect.
 *
 * Failures are counted and returned rather than thrown, because stopping a
 * twenty-file batch on the one photo that 404s helps nobody.
 */
export async function downloadPhotosIndividually(
  photos: DownloadablePhoto[],
  tier: DownloadTier | null = null,
  allowed?: DownloadTier[],
  onProgress?: (p: BatchProgress) => void,
): Promise<{ saved: number; failed: number }> {
  let saved = 0;
  let failed = 0;
  const total = photos.length;

  for (const [i, photo] of photos.entries()) {
    const chosen = preferredTier(downloadOptions(photo, allowed), tier);
    try {
      const res = await fetch(chosen.url, { mode: "cors", credentials: "omit" });
      if (!res.ok) throw new Error(String(res.status));
      saveBlob(await res.blob(), numbered(tierFileName(photo, chosen.tier), i, total));
      saved++;
    } catch {
      failed++;
    }
    onProgress?.({ done: saved + failed, total });
    await new Promise((r) => setTimeout(r, 300));
  }

  return { saved, failed };
}

export interface ZipProgress {
  done: number;
  total: number;
  phase: "fetching" | "packing";
}

/**
 * Many photos, as a single zip, entirely in the browser.
 *
 * On Chromium desktop we ask for a save location up front and stream each
 * photo straight to disk, so a 3 GB gallery never lands in memory. Everywhere
 * else we build the zip as a blob, which is fine for normal gallery sizes but
 * is the reason the picker is tried first.
 *
 * Photos are stored, not compressed — they're already compressed, so deflate
 * would cost CPU for nothing. client-zip does that by default.
 */
export async function downloadPhotosAsZip(
  photos: DownloadablePhoto[],
  zipName: string,
  tier: DownloadTier | null = null,
  allowed?: DownloadTier[],
  onProgress?: (p: ZipProgress) => void,
): Promise<void> {
  // Ask for the save location BEFORE any await that could outlive the tap's
  // user activation, or the picker throws.
  let writable: FileSystemWritableFileStream | null = null;
  const picker = (
    window as unknown as {
      showSaveFilePicker?: (opts: unknown) => Promise<FileSystemFileHandle>;
    }
  ).showSaveFilePicker;

  if (typeof picker === "function") {
    try {
      const handle = await picker({
        suggestedName: zipName,
        types: [
          { description: "Zip archive", accept: { "application/zip": [".zip"] } },
        ],
      });
      writable = await handle.createWritable();
    } catch (err) {
      // User closed the dialog — that's a cancel, not an error.
      if ((err as Error)?.name === "AbortError") return;
      writable = null; // any other failure: fall through to the blob path
    }
  }

  const { downloadZip } = await import("client-zip");

  const used = new Map<string, number>();
  const nextName = (name: string) => {
    const n = used.get(name) ?? 0;
    used.set(name, n + 1);
    if (n === 0) return name;
    const dot = name.lastIndexOf(".");
    return dot === -1
      ? `${name} (${n})`
      : `${name.slice(0, dot)} (${n})${name.slice(dot)}`;
  };

  const total = photos.length;
  let done = 0;

  async function* entries() {
    let index = 0;
    for (const photo of photos) {
      const chosen = preferredTier(downloadOptions(photo, allowed), tier);
      const position = index++;
      try {
        const res = await fetch(chosen.url, {
          mode: "cors",
          credentials: "omit",
        });
        if (res.ok) {
          yield {
            // tierFileName(), not fileName(res.url) — every ladder photo is
            // served from a path ending "share.jpg" or "download.jpg", so
            // parsing the URL would put 300 identically-named files into the
            // archive and the client would end up with one.
            name: nextName(
              numbered(tierFileName(photo, chosen.tier), position, total),
            ),
            input: res,
            lastModified: new Date(),
          };
        }
      } catch {
        // Skip anything unreachable rather than failing the whole archive.
      }
      onProgress?.({ done: ++done, total, phase: "fetching" });
    }
  }

  const zipped = downloadZip(entries(), { buffersAreUTF8: true });

  if (writable) {
    await zipped.body!.pipeTo(writable);
    return;
  }

  onProgress?.({ done, total, phase: "packing" });
  saveBlob(await zipped.blob(), zipName);
}

// ─────────────────────────────────────────────────────────────
// Sharing
// ─────────────────────────────────────────────────────────────

export type ShareResult = "shared" | "copied" | "cancelled" | "unavailable";

/**
 * Shares the actual image files, which is what opens Instagram stories,
 * Telegram and WhatsApp with the photo already attached. Multi-file share
 * works on iOS 15+ and recent Android.
 */
export async function sharePhotoFiles(
  sources: string[],
  title: string,
): Promise<ShareResult> {
  let files: File[];
  try {
    files = await Promise.all(sources.map(fetchPhotoFile));
  } catch {
    return "unavailable";
  }

  if (!navigator.canShare?.({ files })) return "unavailable";

  try {
    await navigator.share({ files, title });
    return "shared";
  } catch (err) {
    if ((err as Error)?.name === "AbortError") return "cancelled";
    return "unavailable";
  }
}

/** Share sheet if there is one, clipboard if there isn't. */
export async function shareLink(url: string, title: string): Promise<ShareResult> {
  if (navigator.share) {
    try {
      await navigator.share({ title, url });
      return "shared";
    } catch (err) {
      if ((err as Error)?.name === "AbortError") return "cancelled";
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    return "copied";
  } catch {
    return "unavailable";
  }
}

// ─────────────────────────────────────────────────────────────
// Requests to the photographer
// ─────────────────────────────────────────────────────────────

export type RequestKind = "hide" | "delete" | "private" | "approve";

export interface RequestInput {
  kind: RequestKind;
  galleryTitle: string;
  galleryUrl: string;
  photoNames: string[];
  note: string;
}

const REQUEST_LINES: Record<RequestKind, string> = {
  hide: "Please take these photos down:",
  delete: "Please delete this whole gallery.",
  private: "Please make this gallery private, so it's only reachable by link.",
  approve: "You're welcome to post these publicly:",
};

/**
 * Builds the message the client sends you. Photo filenames are included so
 * you can act on it without a back-and-forth — "the third one from the top"
 * is not something you can act on two weeks later.
 */
export function buildRequestMessage(input: RequestInput): string {
  const { kind, galleryTitle, galleryUrl, photoNames, note } = input;
  const lines: string[] = [
    `Gallery: ${galleryTitle}`,
    galleryUrl,
    "",
    REQUEST_LINES[kind],
  ];

  if (kind === "hide" || kind === "approve") {
    lines.push(
      photoNames.length
        ? photoNames.map((n) => `• ${n}`).join("\n")
        : "• (none selected)",
    );
  }

  if (note.trim()) lines.push("", note.trim());
  return lines.join("\n");
}

export function requestSubject(kind: RequestKind, galleryTitle: string): string {
  const label: Record<RequestKind, string> = {
    hide: "Photo removal",
    delete: "Gallery deletion",
    private: "Make gallery private",
    approve: "Permission to post",
  };
  return `${label[kind]} — ${galleryTitle}`;
}

export function mailtoUrl(subject: string, body: string): string {
  return `mailto:${CONTACT.email}?subject=${encodeURIComponent(
    subject,
  )}&body=${encodeURIComponent(body)}`;
}

/**
 * t.me can't prefill a message to a personal account (only bots and the share
 * sheet can), so the sheet copies the text first and opens the chat second.
 */
export function telegramUrl(): string {
  return `https://t.me/${CONTACT.telegram}`;
}