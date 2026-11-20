"use client";

// The menu on each photo in the Studio: the "..." button on its tile, like
// the one on a song in Spotify (Marshall, 2026-11-19).
//
// One action for now, "Add to...": the places on the site where the photo can
// be shown besides its album, Best picks on Home and the photo rail of each
// service page. Each place is ticked when the photo is on it; a tap puts it on
// (at the end of that list) or takes it off, saved at once. Later actions
// (move, rename, publish, delete) go in the same list, under "Add to...".
//
// A panel beside the button on a computer, a sheet from the bottom on a phone.
// A menu in the ARIA sense: arrow keys move, Esc closes and gives the focus
// back to the button, Tab leaves.

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronLeft, ChevronRight, CircleAlert, ListPlus, LoaderCircle, MoreHorizontal } from "lucide-react";
import PhotoFrame from "@/src/components/common/PhotoFrame";
import { useT } from "@/src/lib/i18n/LanguageProvider";
import type { LadderSources } from "@/src/lib/ladder";
import { BEST_PICKS_PLACE } from "@/src/lib/placements";

export interface PlaceOption {
  /** "best-picks" or "service:<slug>". */
  id: string;
  /** A service page's title in the Studio's language. Best picks is named by the dictionary. */
  title?: string;
  /** How many of its photos the site shows; the rest wait below them. */
  shows: number;
}

/** Where the photo is now; "missing" before the migration, "failed" if it could not be read. */
export type Placed = string[] | "missing" | "failed";

interface Props {
  fileName: string;
  ladder?: LadderSources;
  thumbhash?: string;
  /** Album photos can be added. A client photo is published to an album first. */
  canPlace: boolean;
  /** A client photo already published: the album it is in. */
  publishedIn?: string;
  places: PlaceOption[];
  placed: Placed;
  /** place → how many photos it holds. */
  counts: Record<string, number>;
  /** Saves one change. Resolves to an error key under `errors`, or nothing. */
  onToggle: (place: string, on: boolean) => Promise<string | undefined>;
}

const ITEM =
  "flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm text-foreground outline-none transition " +
  "hover:bg-foreground/6 focus-visible:bg-foreground/10 aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:hover:bg-transparent";
const ITEM_SELECTOR = '[role^="menuitem"]:not([aria-disabled="true"])';
const PANEL_WIDTH = 264;
/** Below this the menu is a sheet from the bottom (Tailwind's sm). */
const SHEET_BELOW = 640;

export default function PhotoActions({
  fileName,
  ladder,
  thumbhash,
  canPlace,
  publishedIn,
  places,
  placed,
  counts,
  onToggle,
}: Props) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"main" | "places">("main");
  const [sheet, setSheet] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  const close = useCallback((giveFocusBack: boolean) => {
    setOpen(false);
    setView("main");
    setStatus(null);
    if (giveFocusBack) trigger.current?.focus();
  }, []);

  // Where the panel goes: under the button, right edges lined up, inside the
  // window; above it when there is no room below. Written straight to the
  // panel's style, before the browser paints it. A sheet on a phone needs none.
  const placePanel = useCallback(() => {
    const r = trigger.current?.getBoundingClientRect();
    const el = panel.current;
    if (!r || !el) return;
    const h = el.offsetHeight;
    const left = Math.min(Math.max(8, r.right - PANEL_WIDTH), window.innerWidth - PANEL_WIDTH - 8);
    const below = r.bottom + 6;
    const top = below + h > window.innerHeight - 8 ? Math.max(8, r.top - 6 - h) : below;
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }, []);

  // Placed, then the first item gets the focus: when the menu opens and when
  // it changes view.
  useLayoutEffect(() => {
    if (!open) return;
    if (!sheet) placePanel();
    panel.current?.querySelector<HTMLElement>(ITEM_SELECTOR)?.focus({ preventScroll: true });
  }, [open, view, sheet, placePanel]);

  // Closes on a press outside it, on Esc and on resizing. Beside a button on a
  // computer it follows the button while the page scrolls, and closes once
  // the button has left the screen.
  useEffect(() => {
    if (!open) return;
    const inside = (n: EventTarget | null) =>
      n instanceof Node && (panel.current?.contains(n) || trigger.current?.contains(n));
    const onDown = (e: PointerEvent) => {
      if (!inside(e.target)) close(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close(true);
      }
    };
    const onScroll = (e: Event) => {
      if (sheet || (e.target instanceof Node && panel.current?.contains(e.target))) return;
      const r = trigger.current?.getBoundingClientRect();
      if (!r || r.bottom < 0 || r.top > window.innerHeight) close(false);
      else placePanel();
    };
    const onResize = () => close(false);
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open, sheet, close, placePanel]);

  const onPanelKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Tab") {
      close(false);
      return;
    }
    const keys = ["ArrowDown", "ArrowUp", "Home", "End"];
    if (!keys.includes(e.key)) return;
    e.preventDefault();
    const items = Array.from(panel.current?.querySelectorAll<HTMLElement>(ITEM_SELECTOR) ?? []);
    if (items.length === 0) return;
    const at = items.indexOf(document.activeElement as HTMLElement);
    const next =
      e.key === "Home"
        ? 0
        : e.key === "End"
          ? items.length - 1
          : e.key === "ArrowDown"
            ? (at + 1) % items.length
            : (at - 1 + items.length) % items.length;
    items[next].focus();
  };

  const labelOf = (p: PlaceOption) =>
    p.id === BEST_PICKS_PLACE ? t("gallery.photos.actions.bestPicks") : (p.title ?? p.id);

  const countLine = (p: PlaceOption) => {
    const n = counts[p.id] ?? 0;
    const line =
      n === 1 ? t("gallery.photos.actions.countOne") : t("gallery.photos.actions.count", { n });
    return n > p.shows ? `${line}, ${t("gallery.photos.actions.showsFirst", { n: p.shows })}` : line;
  };

  const toggle = async (p: PlaceOption) => {
    if (busy || !Array.isArray(placed)) return;
    const on = !placed.includes(p.id);
    setBusy(p.id);
    setStatus(null);
    const error = await onToggle(p.id, on);
    setBusy(null);
    setStatus(
      error
        ? { ok: false, text: t(`errors.${error}`) }
        : {
            ok: true,
            text: t(on ? "gallery.photos.actions.added" : "gallery.photos.actions.removed", { place: labelOf(p) }),
          },
    );
  };

  const placeItem = (p: PlaceOption) => {
    const isOn = Array.isArray(placed) && placed.includes(p.id);
    return (
      <button
        key={p.id}
        type="button"
        role="menuitemcheckbox"
        aria-checked={isOn}
        aria-disabled={busy !== null && busy !== p.id ? true : undefined}
        aria-busy={busy === p.id || undefined}
        onClick={() => toggle(p)}
        className={ITEM}
      >
        <span className="min-w-0 flex-1">
          <span className="block">{labelOf(p)}</span>
          <span className="block text-xs text-muted-foreground">{countLine(p)}</span>
        </span>
        <span
          aria-hidden
          className={`grid size-5 shrink-0 place-items-center rounded-full border-2 transition ${
            isOn ? "border-accent-warm bg-accent-warm text-white" : "border-foreground/30"
          }`}
        >
          {busy === p.id ? (
            <LoaderCircle className={`size-3.5 animate-spin ${isOn ? "" : "text-foreground"}`} />
          ) : (
            isOn && <Check className="size-3" strokeWidth={3} />
          )}
        </span>
      </button>
    );
  };

  const [best, ...services] = places;

  const menu = (
    <div
      ref={panel}
      role="menu"
      aria-label={t("gallery.photos.actions.open", { name: fileName })}
      onKeyDown={onPanelKey}
      style={sheet ? undefined : { width: PANEL_WIDTH }}
      className={
        sheet
          ? "fixed inset-x-0 bottom-0 z-[70] max-h-[85dvh] overflow-y-auto rounded-t-2xl border-t border-border bg-popover p-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] text-popover-foreground shadow-2xl"
          : "fixed z-[70] rounded-lg border border-border bg-popover p-1.5 text-popover-foreground shadow-2xl"
      }
    >
      {sheet && <div aria-hidden className="mx-auto mb-2 h-1 w-10 rounded-full bg-foreground/20" />}

      {view === "main" ? (
        <>
          <div className="mb-1 flex items-center gap-2.5 border-b border-border px-1.5 pb-2 pt-0.5">
            <PhotoFrame
              ladder={ladder}
              thumbhash={thumbhash}
              alt=""
              sizes="40px"
              className="size-10 shrink-0 overflow-hidden rounded-md"
            />
            <p className="min-w-0 truncate text-sm font-medium" title={fileName}>
              {fileName}
            </p>
          </div>
          <button
            type="button"
            role="menuitem"
            aria-haspopup="menu"
            aria-disabled={canPlace ? undefined : true}
            onClick={() => canPlace && setView("places")}
            className={ITEM}
          >
            <ListPlus aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            <span className="flex-1">{t("gallery.photos.actions.addTo")}</span>
            <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          </button>
          {!canPlace && (
            <p className="px-3 pb-1.5 pt-0.5 text-xs leading-relaxed text-muted-foreground">
              {publishedIn
                ? t("gallery.photos.actions.publishFirstIn", { album: publishedIn })
                : t("gallery.photos.actions.publishFirst")}
            </p>
          )}
        </>
      ) : (
        <>
          <div className="mb-1 flex items-center gap-1 border-b border-border pb-1.5">
            <button
              type="button"
              role="menuitem"
              aria-label={t("gallery.photos.actions.back")}
              onClick={() => {
                setView("main");
                setStatus(null);
              }}
              className="grid size-8 shrink-0 place-items-center rounded-md text-foreground outline-none hover:bg-foreground/6 focus-visible:bg-foreground/10"
            >
              <ChevronLeft aria-hidden className="size-4" />
            </button>
            <p className="text-sm font-semibold">{t("gallery.photos.actions.addToTitle")}</p>
          </div>

          {Array.isArray(placed) ? (
            <>
              {best && placeItem(best)}
              {services.length > 0 && (
                <>
                  <p className="px-3 pb-0.5 pt-2 text-xs text-muted-foreground">
                    {t("gallery.photos.actions.servicePages")}
                  </p>
                  {services.map(placeItem)}
                </>
              )}
            </>
          ) : (
            <p role="alert" className="flex items-start gap-2 px-3 py-2 text-xs leading-relaxed text-destructive">
              <CircleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
              <span>{t(placed === "missing" ? "errors.placesNotSetUp" : "errors.failed")}</span>
            </p>
          )}

          <div className="mt-1 flex items-center gap-2 border-t border-border px-1.5 pt-1.5">
            <p
              role="status"
              className={`min-h-4 min-w-0 flex-1 text-xs leading-snug ${
                status && !status.ok ? "text-destructive" : "text-muted-foreground"
              }`}
            >
              {status?.text}
            </p>
            <button
              type="button"
              role="menuitem"
              onClick={() => close(true)}
              className="inline-flex h-8 shrink-0 items-center rounded-md bg-foreground/6 px-3 text-[13px] font-semibold text-foreground outline-none hover:bg-foreground/12 focus-visible:bg-foreground/14"
            >
              {t("gallery.photos.actions.done")}
            </button>
          </div>
        </>
      )}
    </div>
  );

  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-label={t("gallery.photos.actions.open", { name: fileName })}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          if (open) {
            close(false);
            return;
          }
          setSheet(window.innerWidth < SHEET_BELOW);
          setOpen(true);
        }}
        className="absolute right-1.5 top-1.5 grid size-7 place-items-center rounded-md bg-black/60 text-white transition hover:bg-black/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <MoreHorizontal aria-hidden className="size-4" />
      </button>
      {open &&
        createPortal(
          sheet ? (
            <>
              <div aria-hidden className="fixed inset-0 z-[69] bg-black/50" />
              {menu}
            </>
          ) : (
            menu
          ),
          document.body,
        )}
    </>
  );
}
