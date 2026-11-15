// The derivative ladder itself: what gets built from one original, and where
// it goes. Shared by scripts/build-ladder.mjs (photos already in storage) and
// scripts/studio-worker.mjs (photos uploaded from the Studio), so the two can
// never produce different files for the same photograph.
//
// For each photo: {width}.avif ×6, {width}.webp ×6, share.jpg, download.jpg.
//
// Change ANY setting below and you must bump LADDER_REV (an environment
// variable read by both scripts), or the new bytes land at URLs that browsers
// and the CDN have cached for a year. See derivativePrefix in src/lib/ladder.ts.

import { createHash } from "node:crypto";

import sharp from "sharp";
import { rgbaToThumbHash } from "thumbhash";

// Grid tiles never display above ~720 CSS px; lightbox frames go to the
// display width. So 3840 for a grid tile is waste and grid sizes alone leave
// the lightbox mushy. No 2560 or 3840 on purpose — 2048 covers every device a
// client actually opens their gallery on, and each width dropped is ~8% off
// encode time, storage and bandwidth. Bump LADDER_REV if you change this list.
export const GRID_WIDTHS = [240, 480, 720];
export const FULL_WIDTHS = [1080, 1440, 2048];
export const ALL_WIDTHS = [...GRID_WIDTHS, ...FULL_WIDTHS];

export const ENCODERS = {
  // AVIF is the primary. effort 4 is the knee of the curve — effort 6 costs
  // roughly double the CPU for low single-digit percent extra compression.
  avif: { quality: 50, effort: 4, chromaSubsampling: "4:2:0" },
  // WebP is the only fallback worth shipping. AVIF covers Chrome, Firefox and
  // Safari 16+; JPEG as a third source is dead weight.
  webp: { quality: 78, effort: 5 },
};

// What the client downloads. Full resolution, visually indistinguishable from
// the 37 MB PNG original, roughly a tenth the size — which is the difference
// between a 300-photo gallery being an 11 GB download and a 1.5 GB one.
export const DELIVERY = { quality: 92, mozjpeg: true, chromaSubsampling: "4:2:0" };

// The light download — "For sharing" in the client's chooser.
//
// From the master rather than the original, because this is the one output
// whose whole purpose is to be small: the master is already at the widest rung
// so this costs one extra encode and no extra decode of the full-size file.
// q82 rather than q92 because it will be seen on a phone, recompressed by
// whatever app it is posted to, and never printed — roughly 500 KB against
// 4 MB.
export const SHARE_JPEG = { quality: 82, mozjpeg: true, chromaSubsampling: "4:2:0" };

/** An error not worth another attempt: the input is wrong, not the network. */
export function permanent(err) {
  err.permanent = true;
  return err;
}

/** The ladder revision from the environment, as both scripts read it. */
export function ladderRev() {
  return Number(process.env.LADDER_REV ?? 1);
}

/**
 * Where a photo's derivatives live.
 *
 *   album   → d/{gallery}/{photo}/{checksum8}/v{rev}            public zone
 *   client  → clients/_d/{gallery}/{photo}/{checksum8}/v{rev}   private zone only
 *
 * Keyed on galleries.kind, not visibility, and that distinction is the whole
 * security model. The public pull zone blocks any URL containing "/clients/",
 * so nesting client derivatives there means the CDN refuses them without a
 * token — the same mechanism that protects the originals rather than a second
 * one to keep in step. Visibility is a column you flip from a dashboard;
 * keying paths on it would make every flip either expose files or break them
 * until someone re-ran a script. `kind` never changes, so files never move.
 *
 * The revision is in the path because checksum8 hashes the original and
 * nothing else — it covers a new or replaced photo, but not a change to the
 * encoder settings above. These files carry a one-year immutable cache, and
 * silently changing what lives at an immutable URL is the one thing that
 * breaks the promise a content-addressed path makes.
 *
 * KEEP IN STEP with derivativePrefix() in src/lib/ladder.ts. Duplicated rather
 * than imported because a plain node script cannot import a "server-only"
 * TypeScript module.
 */
export function prefixFor(kind, galleryId, photoId, checksum8, rev) {
  // Fail closed. Defaulting an unknown kind to the public path would let a
  // change to the query — a dropped join, a renamed column — silently publish
  // client work instead of breaking loudly.
  if (kind !== "album" && kind !== "client") {
    throw permanent(
      new Error(
        `gallery kind missing or unrecognised (${JSON.stringify(kind)}) — ` +
          "refusing to guess a derivative path",
      ),
    );
  }

  const root = kind === "client" ? "clients/_d" : "d";
  return `${root}/${galleryId}/${photoId}/${checksum8}/v${rev}`;
}

/**
 * Builds every derivative of one original, in memory. Uploads nothing.
 *
 * Returns the files in upload order, each with a name relative to the prefix,
 * and everything the photos row records about them.
 */
export async function encodeLadder(src) {
  const tEncodeStart = Date.now();
  const checksum8 = createHash("sha256").update(src).digest("hex").slice(0, 8);

  // .rotate() with NO argument bakes EXIF orientation into the pixels and then
  // drops the tag. Skip it and a third of phone uploads come out sideways —
  // and unlike a wrong colour profile, nobody notices until a client does.
  const base = sharp(src, { failOn: "none" }).rotate();
  const meta = await base.metadata();
  // metadata() describes the file as stored. A phone photo taken upright is
  // stored sideways with an EXIF note to turn it, which .rotate() does to the
  // pixels; autoOrient is the size after that. Reading width and height
  // instead recorded such a photo as landscape (fixed 2026-11-16).
  const srcWidth = meta.autoOrient?.width ?? meta.width ?? 0;
  const srcHeight = meta.autoOrient?.height ?? meta.height ?? 0;
  if (!srcWidth || !srcHeight) throw new Error("could not read image dimensions");

  // ThumbHash from a 100px RGBA raster. ~25 bytes, decodes client-side to a
  // blurred preview with the right aspect and average colour. This is what
  // replaced blur_data_url, which Bunny's resizer was returning at ~12 KB.
  const { data: rgba, info } = await base
    .clone()
    .resize(100, 100, { fit: "inside" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const thumbhash = Buffer.from(rgbaToThumbHash(info.width, info.height, rgba)).toString("base64");

  // Never upscale. A 900px original gets 240/480/720 and stops; if it is
  // smaller than even the narrowest rung, emit its own width so the photo
  // still has exactly one variant to render.
  let targets = ALL_WIDTHS.filter((w) => w <= srcWidth);
  if (targets.length === 0) targets = [srcWidth];

  // Decode-once. Every rung is derived from a master already reduced to the
  // widest target rather than from the 37 MB original, which avoids re-decoding
  // a 24 MP PNG twelve times. The quality difference is not visible; the time
  // difference very much is.
  const master = await base
    .clone()
    .resize({ width: Math.max(...targets), withoutEnlargement: true })
    .toColourspace("srgb")
    .png({ compressionLevel: 0 })
    .toBuffer();

  const files = [];
  const variants = [];

  for (const w of targets) {
    const step = sharp(master).resize({ width: w, withoutEnlargement: true });
    const [avif, webp] = await Promise.all([
      step.clone().avif(ENCODERS.avif).toBuffer(),
      step.clone().webp(ENCODERS.webp).toBuffer(),
    ]);
    files.push(
      { name: `${w}.avif`, body: avif, type: "image/avif" },
      { name: `${w}.webp`, body: webp, type: "image/webp" },
    );
    variants.push({ w, a: avif.length, p: webp.length });
  }

  // The light download. One more encode off the master, which is already
  // decoded and already at the widest rung — see SHARE_JPEG.
  const share = await sharp(master).jpeg(SHARE_JPEG).toBuffer();
  files.push({ name: "share.jpg", body: share, type: "image/jpeg" });

  // The download deliverable. Full resolution, from the ORIGINAL rather than
  // the master, because this is the one output where downscaling would be a
  // real loss.
  const delivery = await base.clone().jpeg(DELIVERY).toBuffer();
  files.push({ name: "download.jpg", body: delivery, type: "image/jpeg" });

  return {
    checksum8,
    thumbhash,
    variants,
    width: srcWidth,
    height: srcHeight,
    format: meta.format,
    delivery_bytes: delivery.length,
    share_bytes: share.length,
    files,
    totalOut: files.reduce((n, f) => n + f.body.length, 0),
    msEncode: Date.now() - tEncodeStart,
  };
}
