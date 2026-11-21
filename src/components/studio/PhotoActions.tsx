// The menu on each photo in the Studio: the "..." button on its tile, like
// the one on a song in Spotify (Marshall, 2026-11-19; the full list
// 2026-11-21).
//
//   Details              opens the photo panel
//   Add to...            Best picks and the service pages (albums)
//   Move to album...     (albums) / Publish to album... (client galleries)
//   Rename...
//   Set as cover
//   Hide from the gallery / Show in the gallery
//   Share, Copy link, Copy filename, Copy details
//   Delete...
//
// A panel beside the button on a computer, a sheet from the bottom on a phone.
// A menu in the ARIA sense: arrow keys move, Esc closes and gives the focus
// back to the button, Tab leaves.

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  ClipboardList,
  Copy,
  Eye,
  EyeOff,
  FolderInput,
  ImageIcon,
  Info,
  Link2,
  ListPlus,
  LoaderCircle,
  MoreHorizontal,
  Pencil,
  Share2,
  Trash2,
} from "lucide-react";
import PhotoFrame from "@/src/components/common/PhotoFrame";
import { useT } from "@/src/lib/i18n/LanguageProvider";
import { BEST_PICKS_PLACE } from "@/src/lib/placements";
import type { AlbumTarget, StudioPhoto } from "@/src/lib/studio/gallery";
import { copyText, shareLink } from "./photo-info";
import type { PhotoOps } from "./photo-ops";

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
  photo: StudioPhoto;
  isClient: boolean;
  /** The photo details are in the database (20261121120000_photo_details.sql). */
  detailsReady: boolean;
  /** Its address on the site; null while it is hidden. */
  link: string | null;
  /** Its details as lines of text, for Copy details. */
  details: string;
  /** Where it can be moved or published. */
  albums: AlbumTarget[];
  categories: string[];
  places: PlaceOption[];
  placed: Placed;
  /** place → how many photos it holds. */
  counts: Record<string, number>;
  /** Saves one place change. Resolves to an error key under `errors`, or nothing. */
  onToggle: (place: string, on: boolean) => Promise<string | undefined>;
  onOpenDetails: () => void;
  ops: PhotoOps;
}

type View = "main" | "places" | "move" | "rename" | "delete";

const ITEM =
  "flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm text-foreground outline-none transition " +
  "hover:bg-foreground/6 focus-visible:bg-foreground/10 aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:hover:bg-transparent";
const ICON = "size-4 shrink-0 text-muted-foreground";
const ITEM_SELECTOR = '[role^="menuitem"]:not([aria-disabled="true"])';
const PANEL_WIDTH = 280;
/** Below this the menu is a sheet from the bottom (Tailwind's sm). */
const SHEET_BELOW = 640;
const FIELD =
  "h-9 w-full min-w-0 rounded-md border border-input bg-card px-2.5 text-sm text-foreground placeholder:text-muted-foreground " +
  "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring";
const SMALL =
  "inline-flex h-8 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 text-[13px] font-semibold outline-none transition " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50";
const SMALL_QUIET = `${SMALL} bg-foreground/6 text-foreground hover:bg-foreground/12`;
const SMALL_MAIN = `${SMALL} bg-primary text-primary-foreground hover:bg-primary-hover`;
const SMALL_DANGER = `${SMALL} border border-destructive text-destructive hover:ring-1 hover:ring-destructive`;

export default function PhotoActions({
  photo,
  isClient,
  detailsReady,
  link,
  details,
  albums,
  categories,
  places,
  placed,
  counts,
  onToggle,
  onOpenDetails,
  ops,
}: Props) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>("main");
  const [sheet, setSheet] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const canPlace = !isClient;

  const close = useCallback((giveFocusBack: boolean) => {
    setOpen(false);
    setView("main");
    setStatus(null);
    setBusy(null);
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
  // it changes view. Back on the first view, the item that led away has it.
  const lastView = useRef<View>("main");
  useLayoutEffect(() => {
    if (!open) {
      lastView.current = "main";
      return;
    }
    if (!sheet) placePanel();
    const from = lastView.current;
    lastView.current = view;
    // A view with a field (Rename, a new album) starts in the field.
    const field = panel.current?.querySelector<HTMLElement>("[data-menu-field]");
    const opener =
      view === "main" && from !== "main" ? panel.current?.querySelector<HTMLElement>(`[data-opens="${from}"]`) : null;
    (field ?? opener ?? panel.current?.querySelector<HTMLElement>(ITEM_SELECTOR))?.focus({ preventScroll: true });
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
      // Inside a form view Tab moves between its fields as usual.
      if (view === "rename" || view === "move") return;
      close(false);
      return;
    }
    const keys = ["ArrowDown", "ArrowUp", "Home", "End"];
    if (!keys.includes(e.key)) return;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    e.preventDefault();
    const items = Array.from(panel.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([aria-disabled="true"])') ?? []);
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

  const openDetails = () => {
    close(false);
    onOpenDetails();
  };

  const say = (ok: boolean, text: string) => setStatus({ ok, text });
  const fail = (error: string) => say(false, t(`errors.${error}`));

  /** Runs one action, with the menu busy meanwhile. */
  const run = async (key: string, fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(key);
    setStatus(null);
    try {
      await fn();
    } catch {
      fail("failed");
    }
    setBusy(null);
  };

  const copy = (key: string, text: string, done: string) =>
    run(key, async () => {
      if (await copyText(text)) say(true, done);
      else fail("failed");
    });

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

  const back = (title: string) => (
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
      <p className="min-w-0 truncate text-sm font-semibold">{title}</p>
    </div>
  );

  const statusLine = (
    <p
      role="status"
      className={`min-h-4 px-3 pt-1 text-xs leading-snug ${status && !status.ok ? "text-destructive" : "text-muted-foreground"}`}
    >
      {status?.text}
    </p>
  );

  const [best, ...services] = places;
  const hiddenNote = !detailsReady ? t("errors.detailsNotSetUp") : undefined;

  let content: React.ReactNode;
  if (view === "main") {
    content = (
      <>
        <div className="mb-1 flex items-center gap-2.5 border-b border-border px-1.5 pb-2 pt-0.5">
          <PhotoFrame
            ladder={photo.ladder}
            thumbhash={photo.thumbhash}
            alt=""
            sizes="40px"
            className="size-10 shrink-0 overflow-hidden rounded-md"
          />
          <p className="min-w-0 truncate text-sm font-medium" title={photo.name}>
            {photo.name}
          </p>
        </div>
        <MenuItem
          icon={<Info aria-hidden className={ICON} />}
          label={t("gallery.photos.actions.details")}
          blocked={busy !== null}
          onClick={openDetails}
        />
        <MenuItem
          icon={<ListPlus aria-hidden className={ICON} />}
          label={t("gallery.photos.actions.addTo")}
          sub
          disabled={!canPlace || busy !== null}
          hint={
            canPlace
              ? undefined
              : photo.publishedIn
                ? t("gallery.photos.actions.publishFirstIn", { album: photo.publishedIn })
                : t("gallery.photos.actions.publishFirst")
          }
          opens="places"
          onClick={() => setView("places")}
        />
        <MenuItem
          icon={<FolderInput aria-hidden className={ICON} />}
          label={t(isClient ? "gallery.photos.actions.publishTo" : "gallery.photos.actions.moveTo")}
          sub
          disabled={busy !== null}
          opens="move"
          onClick={() => setView("move")}
        />
        <MenuItem
          icon={<Pencil aria-hidden className={ICON} />}
          label={t("gallery.photos.actions.rename")}
          disabled={!detailsReady || busy !== null}
          hint={hiddenNote}
          opens="rename"
          onClick={() => setView("rename")}
        />
        {!photo.isCover && (
          <MenuItem
            icon={<ImageIcon aria-hidden className={ICON} />}
            label={t("gallery.photos.setCover")}
            working={busy === "cover"}
            disabled={busy !== null && busy !== "cover"}
            blocked={busy !== null}
            onClick={() =>
              run("cover", async () => {
                const error = await ops.setCover(photo.id);
                if (error) fail(error);
                else say(true, t("gallery.photos.actions.coverSet"));
              })
            }
          />
        )}
        <MenuItem
          icon={photo.hidden ? <Eye aria-hidden className={ICON} /> : <EyeOff aria-hidden className={ICON} />}
          label={t(photo.hidden ? "gallery.photos.actions.show" : "gallery.photos.actions.hide")}
          working={busy === "hide"}
          disabled={!detailsReady || (busy !== null && busy !== "hide")}
          blocked={busy !== null}
          hint={hiddenNote}
          onClick={() =>
            run("hide", async () => {
              const error = await ops.update(photo.id, { hidden: !photo.hidden });
              if (error) fail(error);
              else say(true, t(photo.hidden ? "gallery.photos.actions.shownNow" : "gallery.photos.actions.hiddenNow"));
            })
          }
        />
        <div role="separator" className="my-1 border-t border-border" />
        <MenuItem
          icon={<Share2 aria-hidden className={ICON} />}
          label={t("gallery.photos.actions.share")}
          working={busy === "share"}
          disabled={!link || (busy !== null && busy !== "share")}
          blocked={busy !== null}
          hint={link ? undefined : t("gallery.photos.actions.noLink")}
          onClick={() =>
            run("share", async () => {
              if (!link) return;
              const r = await shareLink(link, photo.name);
              if (r === "copied") say(true, t("gallery.photos.actions.linkCopied"));
              else if (r === "failed") fail("failed");
            })
          }
        />
        <MenuItem
          icon={<Link2 aria-hidden className={ICON} />}
          label={t("gallery.photos.actions.copyLink")}
          disabled={!link || busy !== null}
          onClick={() => link && copy("link", link, t("gallery.photos.actions.linkCopied"))}
        />
        <MenuItem
          icon={<Copy aria-hidden className={ICON} />}
          label={t("gallery.photos.actions.copyFilename")}
          disabled={busy !== null}
          onClick={() => copy("filename", photo.name, t("gallery.photos.actions.filenameCopied"))}
        />
        <MenuItem
          icon={<ClipboardList aria-hidden className={ICON} />}
          label={t("gallery.photos.actions.copyDetails")}
          disabled={busy !== null}
          onClick={() => copy("details-copy", details, t("gallery.photos.actions.detailsCopied"))}
        />
        <div role="separator" className="my-1 border-t border-border" />
        <MenuItem
          icon={<Trash2 aria-hidden className={`${ICON} text-destructive`} />}
          label={t("gallery.photos.actions.delete")}
          danger
          disabled={busy !== null}
          opens="delete"
          onClick={() => setView("delete")}
        />
        {statusLine}
      </>
    );
  } else if (view === "places") {
    content = (
      <>
        {back(t("gallery.photos.actions.addToTitle"))}
        {Array.isArray(placed) ? (
          <>
            {best && placeItem(best)}
            {services.length > 0 && (
              <>
                <p className="px-3 pb-0.5 pt-2 text-xs text-muted-foreground">{t("gallery.photos.actions.servicePages")}</p>
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
            className={`min-h-4 min-w-0 flex-1 text-xs leading-snug ${status && !status.ok ? "text-destructive" : "text-muted-foreground"}`}
          >
            {status?.text}
          </p>
          <button type="button" role="menuitem" onClick={() => close(true)} className={SMALL_QUIET}>
            {t("gallery.photos.actions.done")}
          </button>
        </div>
      </>
    );
  } else if (view === "move") {
    content = (
      <MoveView
        isClient={isClient}
        albums={albums}
        categories={categories}
        busy={busy}
        status={status}
        back={back(t(isClient ? "gallery.photos.actions.publishTo" : "gallery.photos.actions.moveTo"))}
        onMove={(target) =>
          run("move", async () => {
            const r = await ops.move(photo.id, target);
            if (r.error) fail(r.error);
            else if (isClient) say(true, t("gallery.photos.publishedOne", { album: r.album ?? "" }));
            else close(false);
          })
        }
      />
    );
  } else if (view === "rename") {
    content = (
      <RenameView
        photo={photo}
        busy={busy}
        status={status}
        back={back(t("gallery.photos.actions.rename"))}
        onSave={(name) =>
          run("rename", async () => {
            const error = await ops.update(photo.id, { name });
            if (error) fail(error);
            else {
              setView("main");
              say(true, t("gallery.photos.actions.renamed"));
            }
          })
        }
      />
    );
  } else {
    content = (
      <>
        {back(t("gallery.photos.actions.delete"))}
        <p className="px-3 py-1.5 text-sm leading-snug">{t("gallery.photos.actions.deleteAsk", { name: photo.name })}</p>
        <div className="flex flex-wrap gap-2 px-3 pb-1 pt-1.5">
          <button
            type="button"
            role="menuitem"
            disabled={busy !== null}
            onClick={() =>
              run("delete-yes", async () => {
                const error = await ops.remove(photo.id);
                if (error) fail(error);
                else close(false);
              })
            }
            className={SMALL_DANGER}
          >
            {busy === "delete-yes" && <LoaderCircle aria-hidden className="size-3.5 animate-spin" />}
            {t("gallery.photos.deleteConfirmOne")}
          </button>
          <button type="button" role="menuitem" disabled={busy !== null} onClick={() => setView("main")} className={SMALL_QUIET}>
            {t("common.cancel")}
          </button>
        </div>
        {statusLine}
      </>
    );
  }

  const menu = (
    <div
      ref={panel}
      role="menu"
      aria-label={t("gallery.photos.actions.open", { name: photo.name })}
      onKeyDown={onPanelKey}
      style={sheet ? undefined : { width: PANEL_WIDTH }}
      className={
        sheet
          ? "fixed inset-x-0 bottom-0 z-[70] max-h-[85dvh] overflow-y-auto rounded-t-2xl border-t border-border bg-popover p-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] text-popover-foreground shadow-2xl"
          : "fixed z-[70] max-h-[calc(100dvh-16px)] overflow-y-auto rounded-lg border border-border bg-popover p-1.5 text-popover-foreground shadow-2xl"
      }
    >
      {sheet && <div aria-hidden className="mx-auto mb-2 h-1 w-10 rounded-full bg-foreground/20" />}
      {content}
    </div>
  );

  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-label={t("gallery.photos.actions.open", { name: photo.name })}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          if (open) {
            close(false);
            return;
          }
          setSheet(window.innerWidth < SHEET_BELOW);
          setOpen(true);
        }}
        className="absolute right-1.5 top-1.5 z-10 grid size-7 place-items-center rounded-md bg-black/60 text-white transition hover:bg-black/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
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

function MoveView({
  isClient,
  albums,
  categories,
  busy,
  status,
  back,
  onMove,
}: {
  isClient: boolean;
  albums: AlbumTarget[];
  categories: string[];
  busy: string | null;
  status: { ok: boolean; text: string } | null;
  back: React.ReactNode;
  onMove: (target: { to: string; title?: string; category?: string }) => void;
}) {
  const { t } = useT();
  const [creating, setCreating] = useState(albums.length === 0);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState(categories[0] ?? "");

  return (
    <>
      {back}
      {albums.map((a) => (
        <button
          key={a.id}
          type="button"
          role="menuitem"
          aria-disabled={busy !== null ? true : undefined}
          onClick={() => !busy && onMove({ to: a.id })}
          className={ITEM}
        >
          <FolderInput aria-hidden className={ICON} />
          <span className="min-w-0 flex-1">
            <span className="block truncate">{a.title}</span>
            {a.category && <span className="block text-xs text-muted-foreground">{a.category}</span>}
          </span>
        </button>
      ))}
      {creating ? (
        <form
          className="mt-1 grid gap-2 border-t border-border px-3 pb-1 pt-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy) onMove({ to: "new", title: title.trim(), category: category.trim() });
          }}
        >
          <p className="text-xs font-semibold text-muted-foreground">{t("gallery.photos.newAlbum")}</p>
          <input
            data-menu-field
            required
            maxLength={200}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t("gallery.photos.albumTitle")}
            aria-label={t("gallery.photos.albumTitle")}
            className={FIELD}
          />
          <input
            required
            maxLength={40}
            list="photo-menu-categories"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder={t("gallery.photos.category")}
            aria-label={t("gallery.photos.category")}
            className={FIELD}
          />
          <datalist id="photo-menu-categories">
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
          <div className="flex gap-2">
            <button type="submit" disabled={busy !== null} className={SMALL_MAIN}>
              {busy === "move" && <LoaderCircle aria-hidden className="size-3.5 animate-spin" />}
              {t(isClient ? "gallery.photos.publishN" : "gallery.photos.moveN", { n: 1 })}
            </button>
            {albums.length > 0 && (
              <button type="button" onClick={() => setCreating(false)} className={SMALL_QUIET}>
                {t("common.cancel")}
              </button>
            )}
          </div>
        </form>
      ) : (
        <button type="button" role="menuitem" onClick={() => setCreating(true)} className={`${ITEM} mt-1 border-t border-border`}>
          <span aria-hidden className="grid size-4 shrink-0 place-items-center text-base leading-none text-muted-foreground">+</span>
          <span className="flex-1">{t("gallery.photos.newAlbum")}</span>
        </button>
      )}
      <p
        role="status"
        className={`min-h-4 px-3 pt-1 text-xs leading-snug ${status && !status.ok ? "text-destructive" : "text-muted-foreground"}`}
      >
        {busy === "move" ? t("gallery.photos.actions.working") : status?.text}
      </p>
    </>
  );
}

function RenameView({
  photo,
  busy,
  status,
  back,
  onSave,
}: {
  photo: StudioPhoto;
  busy: string | null;
  status: { ok: boolean; text: string } | null;
  back: React.ReactNode;
  onSave: (name: string | null) => void;
}) {
  const { t } = useT();
  const [name, setName] = useState(photo.name);
  return (
    <>
      {back}
      <form
        className="grid gap-2 px-3 pb-1 pt-1"
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy) onSave(name.trim() || null);
        }}
      >
        <input
          data-menu-field
          maxLength={200}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onFocus={(e) => {
            // The name without its extension selected, as a file manager does.
            const dot = e.target.value.lastIndexOf(".");
            e.target.setSelectionRange(0, dot > 0 ? dot : e.target.value.length);
          }}
          aria-label={t("gallery.photos.info.name")}
          className={FIELD}
        />
        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" disabled={busy !== null || !name.trim()} className={SMALL_MAIN}>
            {busy === "rename" && <LoaderCircle aria-hidden className="size-3.5 animate-spin" />}
            {t("gallery.photos.actions.save")}
          </button>
          {photo.name !== photo.fileName && (
            <button type="button" disabled={busy !== null} onClick={() => onSave(null)} className={SMALL_QUIET}>
              {t("gallery.photos.actions.useFileName")}
            </button>
          )}
        </div>
        <p className="text-xs leading-snug text-muted-foreground">{t("gallery.photos.actions.renameHint")}</p>
      </form>
      <p
        role="status"
        className={`min-h-4 px-3 pt-1 text-xs leading-snug ${status && !status.ok ? "text-destructive" : "text-muted-foreground"}`}
      >
        {status?.text}
      </p>
    </>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
  disabled,
  working,
  blocked,
  sub,
  danger,
  hint,
  opens,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  /** This one is running. */
  working?: boolean;
  /** Something is running: clicks wait. */
  blocked?: boolean;
  sub?: boolean;
  danger?: boolean;
  hint?: string;
  /** The view it opens, so Back can return the focus to it. */
  opens?: View;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      data-opens={opens}
      aria-haspopup={sub ? "menu" : undefined}
      aria-disabled={disabled ? true : undefined}
      aria-busy={working || undefined}
      onClick={() => !disabled && !blocked && onClick()}
      className={`${ITEM} ${danger ? "text-destructive" : ""}`}
    >
      {working ? <LoaderCircle aria-hidden className={`${ICON} animate-spin`} /> : icon}
      <span className="min-w-0 flex-1">
        <span className="block">{label}</span>
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </span>
      {sub && <ChevronRight aria-hidden className={ICON} />}
    </button>
  );
}
