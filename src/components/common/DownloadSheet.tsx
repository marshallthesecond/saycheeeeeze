"use client";

// src/components/common/DownloadSheet.tsx
//
// What opens when a client taps Download. Same bottom-sheet shape as
// GalleryRequestSheet and GalleryPickerSheet — backdrop tap to close, Escape to
// close, body scroll locked, safe-area padding — because a third sheet that
// behaves differently from the first two is a bug with extra steps.
//
// ── Two questions, and why both are here ─────────────────────
// Which quality, and — for more than one photo — one archive or separate files.
// They are asked together because they are answered together, and because
// splitting them across two taps is how you get a client who picks "originals"
// and then discovers they have started a 2 GB download of separate files.
//
// ── Why every option shows its size ──────────────────────────
// This is the whole point of the sheet. "Full quality" and "Original file" are
// meaningless labels next to each other until one says 4.2 MB and the other
// says 24.6 MB; then nobody has to understand JPEG to choose correctly. On a
// phone on mobile data in Tashkent, that number is the decision.
//
// A size we do not have is rendered "—", never "0 B" — see totalBytes(), which
// withholds a total rather than quietly summing the photos it has figures for.

import { useEffect, useMemo, useState } from "react";
import { X, Download, Check, FileArchive, Files, AlertTriangle } from "lucide-react";

import {
  availableTiers,
  formatBytes,
  totalBytes,
  type DownloadablePhoto,
  type DownloadTier,
} from "@/src/lib/ladder";
import {
  BLOB_ZIP_LIMIT_BYTES,
  LARGE_DOWNLOAD_BYTES,
  ZIP_DEFAULT_ABOVE,
  ZIP_ONLY_ABOVE,
  canSaveStreamed,
  isMeteredConnection,
} from "@/src/lib/gallery";

export interface DownloadChoice {
  tier: DownloadTier;
  asZip: boolean;
  remember: boolean;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onConfirm: (choice: DownloadChoice) => void;
  /** Exactly the photos that will be downloaded, so the totals are real. */
  photos: DownloadablePhoto[];
  allowedTiers: DownloadTier[];
  /** Where the sheet starts, from the remembered preference. */
  initialTier?: DownloadTier | null;
  initialAsZip?: boolean | null;
  tx: (key: string, fallback: string) => string;
}

const TIER_COPY: Record<DownloadTier, { key: string; name: string; blurb: string }> = {
  share: {
    key: "share",
    name: "For sharing",
    blurb: "Small and quick. Instagram, Telegram, WhatsApp.",
  },
  full: {
    key: "full",
    name: "Full quality",
    blurb: "Full resolution. For printing, cropping and keeping.",
  },
  original: {
    key: "original",
    name: "Original file",
    blurb: "Exactly as it came off the camera. Large.",
  },
};

export default function DownloadSheet({
  open,
  onClose,
  onConfirm,
  photos,
  allowedTiers,
  initialTier = null,
  initialAsZip = null,
  tx,
}: Props) {
  const count = photos.length;
  const tiers = useMemo(
    () => availableTiers(photos, allowedTiers),
    [photos, allowedTiers],
  );

  // Below the first threshold separate files are genuinely nicer; above the
  // second the browser makes them unreliable and there is no choice to offer.
  // See the note on ZIP_DEFAULT_ABOVE in gallery.ts.
  const zipOnly = count > ZIP_ONLY_ABOVE;
  const packagingMatters = count > 1 && !zipOnly;

  const [tier, setTier] = useState<DownloadTier>(
    initialTier && tiers.includes(initialTier) ? initialTier : (tiers[tiers.length - 1] ?? "full"),
  );
  const [asZip, setAsZip] = useState<boolean>(
    zipOnly ? true : (initialAsZip ?? count > ZIP_DEFAULT_ABOVE),
  );
  const [remember, setRemember] = useState(true);

  // A remembered tier can name something this gallery no longer offers — you
  // switched originals off after the client had already chosen them. Re-seat
  // the selection on something real rather than confirming a tier that is not
  // in the list.
  useEffect(() => {
    if (!open) return;
    setTier((current) =>
      tiers.includes(current)
        ? current
        : (initialTier && tiers.includes(initialTier) ? initialTier : tiers[tiers.length - 1]),
    );
    setAsZip(zipOnly ? true : (initialAsZip ?? count > ZIP_DEFAULT_ABOVE));
  }, [open, tiers, initialTier, initialAsZip, zipOnly, count]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  const total = totalBytes(photos, tier);

  // Chromium streams the archive to disk and never holds it; everywhere else
  // client-zip's output has to be collected into a Blob first, and a couple of
  // gigabytes of originals in a Blob is a killed tab — on a phone especially.
  const blobZipRisk =
    asZip &&
    !canSaveStreamed() &&
    typeof total === "number" &&
    total > BLOB_ZIP_LIMIT_BYTES;

  // Read after mount, never during render: the Network Information API lives on
  // navigator, which does not exist on the server. Same reasoning as the guard
  // inside canSaveStreamed().
  const [metered, setMetered] = useState(false);
  useEffect(() => setMetered(isMeteredConnection()), [open]);

  // Warn when we KNOW the connection is poor, or when the download is large
  // enough to be worth a second thought on any connection. Not shown alongside
  // the archive warning — one alarm at a time, and that one is more specific.
  const heavy =
    !blobZipRisk &&
    typeof total === "number" &&
    (metered ? total > LARGE_DOWNLOAD_BYTES / 10 : total > LARGE_DOWNLOAD_BYTES);

  if (!open) return null;

  const heading =
    count === 1
      ? tx("download.headingOne", "Download photo")
      : tx("download.headingMany", "Download {n} photos").replace("{n}", String(count));

  return (
    <div
      className="fixed inset-0 z-70 flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center"
      onClick={onClose}
    >
      <div
        className="max-h-[85dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-neutral-950 ring-1 ring-white/10 sm:rounded-3xl"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={heading}
      >
        <div className="flex items-center justify-between px-6 pb-2 pt-6">
          <h2 className="text-lg font-semibold text-white">{heading}</h2>
          <button
            onClick={onClose}
            aria-label={tx("common.close", "Close")}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* ── Quality ── */}
        <fieldset className="mt-3 space-y-2 px-6">
          <legend className="sr-only">{tx("download.quality", "Quality")}</legend>
          {tiers.map((t) => {
            const copy = TIER_COPY[t];
            const bytes = totalBytes(photos, t);
            const active = t === tier;
            return (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setTier(t)}
                className={`flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition ${
                  active
                    ? "border-white/70 bg-white/[0.07]"
                    : "border-white/10 hover:border-white/30"
                }`}
              >
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                    active ? "border-white bg-white text-black" : "border-white/40 text-transparent"
                  }`}
                >
                  <Check className="h-3 w-3" strokeWidth={3} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-bold text-white">
                    {tx(`download.tier.${copy.key}`, copy.name)}
                  </span>
                  <span className="mt-0.5 block text-xs text-white/45">
                    {tx(`download.tier.${copy.key}Blurb`, copy.blurb)}
                  </span>
                </span>
                <span className="shrink-0 font-mono text-xs text-white/60">
                  {formatBytes(bytes)}
                </span>
              </button>
            );
          })}
        </fieldset>

        {/* ── Packaging ── */}
        {packagingMatters && (
          <div className="mt-5 px-6">
            <div className="grid grid-cols-2 gap-2">
              <PackagingOption
                active={!asZip}
                onClick={() => setAsZip(false)}
                icon={<Files className="h-4 w-4" />}
                label={tx("download.separate", "Separate files")}
              />
              <PackagingOption
                active={asZip}
                onClick={() => setAsZip(true)}
                icon={<FileArchive className="h-4 w-4" />}
                label={tx("download.zip", "One ZIP")}
              />
            </div>

            {/* Not a nicety. Chrome asks "Download multiple files?" on the
                SECOND file and silently drops the rest if the client dismisses
                it — and they find out by counting their photos a week later. */}
            {!asZip && (
              <p className="mt-2 text-xs text-white/40">
                {tx(
                  "download.separateNote",
                  "Your browser may ask permission to save several files at once.",
                )}
              </p>
            )}
          </div>
        )}

        {zipOnly && (
          <p className="mt-4 px-6 text-xs text-white/40">
            {tx(
              "download.zipOnlyNote",
              "Over {n} photos are always sent as one ZIP — browsers cannot save that many separately.",
            ).replace("{n}", String(ZIP_ONLY_ABOVE))}
          </p>
        )}

        {heavy && (
          <div className="mx-6 mt-4 flex gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-white/50" />
            <p className="text-xs text-white/60">
              {metered
                ? tx(
                    "download.meteredNote",
                    "That's {size}, and you appear to be on mobile data. It will still work — just slowly, and it counts against your plan.",
                  ).replace("{size}", formatBytes(total))
                : tx(
                    "download.largeNote",
                    "That's {size}. Worth doing on Wi-Fi, and keep this tab open until it finishes.",
                  ).replace("{size}", formatBytes(total))}
            </p>
          </div>
        )}

        {blobZipRisk && (
          <div className="mx-6 mt-4 flex gap-2 rounded-2xl border border-amber-400/30 bg-amber-400/[0.07] px-4 py-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
            <p className="text-xs text-amber-100/80">
              {tx(
                "download.tooBigForBrowser",
                "This browser has to build the whole archive in memory, and {size} is likely to fail. Choose a lighter quality, or download in smaller batches.",
              ).replace("{size}", formatBytes(total))}
            </p>
          </div>
        )}

        {/* ── Confirm ── */}
        <div className="px-6 py-6">
          <button
            type="button"
            onClick={() => onConfirm({ tier, asZip: zipOnly ? true : asZip, remember })}
            className="flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-white text-sm font-semibold text-black transition hover:bg-white/90"
          >
            <Download className="h-4 w-4" />
            {total === undefined
              ? tx("download.confirm", "Download")
              : `${tx("download.confirm", "Download")} · ${formatBytes(total)}`}
          </button>

          <label className="mt-4 flex cursor-pointer items-center gap-2.5 text-xs text-white/45">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="h-4 w-4 accent-white"
            />
            {tx("download.remember", "Remember this choice")}
          </label>
        </div>
      </div>
    </div>
  );
}

function PackagingOption({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={`flex min-h-12 items-center justify-center gap-2 rounded-2xl border text-sm font-semibold transition ${
        active
          ? "border-white/70 bg-white/[0.07] text-white"
          : "border-white/10 text-white/60 hover:border-white/30"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
