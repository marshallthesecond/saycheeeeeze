// src/lib/bunny-url.ts
//
// Just the URL builder. No storage-API calls, no AccessKey, nothing that must
// stay on the server — so this is safe to import from a client component, which
// src/lib/bunny.ts is not (see the note at the top of that file).

const PULL_ZONE = process.env.NEXT_PUBLIC_BUNNY_PULL_ZONE;

export interface BunnyTransform {
  /** Source width in px. See MAX_SOURCE_WIDTH below for why this matters. */
  width?: number;
  height?: number;
  /** 1–100. Bunny's default is 85. */
  quality?: number;
}

/**
 * Widest source anyone needs. next/image resizes for the client anyway, so the
 * only thing a larger original buys is a slower, hungrier optimiser pass on the
 * server — and several of the portraits on the landing page are PNGs, which at
 * full camera resolution are tens of megabytes each. Capping the *source* is
 * the cheap fix; re-encoding the originals to JPEG or WebP is the real one.
 */
const MAX_SOURCE_WIDTH = 1600;

export function bunnyUrl(path: string, t?: BunnyTransform): string {
  if (!PULL_ZONE) {
    console.warn(
      "NEXT_PUBLIC_BUNNY_PULL_ZONE is not set in your environment — " +
        "returning the path unchanged, which will 404. Check your .env.local.",
    );
    return path;
  }

  const base = PULL_ZONE.replace(/\/$/, ""); // strip trailing slash if present
  const clean = path.startsWith("/") ? path : `/${path}`;
  const url = `${base}${clean}`;

  // Bunny Optimizer parameters. They are inert unless the Optimizer add-on is
  // enabled on the pull zone, so this is safe to ship either way — but it does
  // nothing for you until it is switched on. Check in the Bunny dashboard
  // before assuming the PNGs got smaller.
  const q = new URLSearchParams();
  const width = t?.width ?? MAX_SOURCE_WIDTH;
  if (width) q.set("width", String(width));
  if (t?.height) q.set("height", String(t.height));
  if (t?.quality) q.set("quality", String(t.quality));

  const qs = q.toString();
  return qs ? `${url}?${qs}` : url;
}