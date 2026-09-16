"use client";

// The three buttons a client presses on one photograph, and the badge that
// shows what it currently carries.
//
// One component for both places they appear — the grid tile and the lightbox —
// because three buttons that disagree about which one is "on" is the bug this
// feature would most obviously have, and the cheapest way not to have it is to
// only write them once.
//
// Nothing here talks to the network. It reports a press upward and re-renders
// from the `mark` prop it is given, so the optimistic update, the rollback and
// the toast all live in one place (ClientGalleryView) rather than three.

import { Check, Trash2, Globe } from "lucide-react";

import {
  MARK_FALLBACK,
  MARK_KEYS,
  PHOTO_MARKS,
  type PhotoMark,
} from "@/src/lib/photo-marks";

const ICONS: Record<PhotoMark, React.ComponentType<{ className?: string }>> = {
  keep: Check,
  publish: Globe,
  delete: Trash2,
};

/**
 * Colour per mark, on the pressed state only.
 *
 * Deliberately NOT the gallery accent: these three mean different things and
 * one of them is destructive, so they are the one place on this page where
 * colour has to carry meaning rather than brand. Red is the only red in the
 * client gallery.
 */
const ON: Record<PhotoMark, string> = {
  keep: "bg-emerald-500 text-white ring-emerald-300",
  publish: "bg-sky-500 text-white ring-sky-300",
  delete: "bg-rose-600 text-white ring-rose-300",
};

const DOT: Record<PhotoMark, string> = {
  keep: "bg-emerald-400",
  publish: "bg-sky-400",
  delete: "bg-rose-500",
};

export interface MarkButtonsProps {
  /** The current mark, or null. */
  mark: PhotoMark | null;
  /** Pressing the mark a photograph already carries clears it — the caller
   *  receives null and is expected to treat that as "un-mark". */
  onMark: (next: PhotoMark | null) => void;
  /** AlbumView's tx(key, fallback). Passed in rather than imported so this
   *  component does not pull the dictionary into every surface that uses it. */
  tx: (key: string, fallback: string) => string;
  /** `tile` is the compact row over a grid photograph; `bar` is the lightbox,
   *  where there is room for the words. */
  variant?: "tile" | "bar";
  /** True while this photograph's request is in flight. */
  busy?: boolean;
}

export default function MarkButtons({
  mark,
  onMark,
  tx,
  variant = "tile",
  busy = false,
}: MarkButtonsProps) {
  const tile = variant === "tile";

  return (
    <div
      className={
        tile
          ? "flex items-center gap-1 rounded-full bg-black/65 p-1 backdrop-blur-sm"
          : "flex items-center gap-1.5"
      }
      // The grid tile is a click target that opens the lightbox; without this
      // every mark press would also open the photograph it just marked.
      onClick={(e) => e.stopPropagation()}
    >
      {PHOTO_MARKS.map((value) => {
        const Icon = ICONS[value];
        const active = mark === value;
        const label = tx(MARK_KEYS[value].label, MARK_FALLBACK[value].label);

        return (
          <button
            key={value}
            type="button"
            disabled={busy}
            aria-pressed={active}
            aria-label={label}
            title={label}
            onClick={(e) => {
              e.stopPropagation();
              onMark(active ? null : value);
            }}
            className={[
              "flex shrink-0 items-center justify-center transition disabled:opacity-40",
              tile
                ? "h-7 w-7 rounded-full"
                : "min-h-11 gap-1.5 rounded-full px-3 text-xs font-semibold",
              active
                ? `${ON[value]} ring-1`
                : "bg-white/10 text-white/70 hover:bg-white/20 hover:text-white",
            ].join(" ")}
          >
            <Icon className={tile ? "h-3.5 w-3.5" : "h-4 w-4"} />
            {!tile && <span>{label}</span>}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The corner dot on a grid tile, so a marked photograph reads as marked while
 * scrolling past at speed — before the buttons are legible and without having
 * to compare three small icons against each other.
 */
export function MarkDot({ mark }: { mark: PhotoMark | null }) {
  if (!mark) return null;
  return (
    <span
      aria-hidden
      className={`pointer-events-none absolute right-2 top-2 h-2.5 w-2.5 rounded-full shadow ring-2 ring-black/40 ${DOT[mark]}`}
    />
  );
}
