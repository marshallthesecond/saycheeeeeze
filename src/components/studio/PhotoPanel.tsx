"use client";

// One photo, open beside the grid (Marshall, 2026-11-21): 2/5 of the screen
// on the right on a computer, a sheet from the bottom on a phone.
//
// Everything about the photo in one place: its name, a description for the
// gallery viewer, category tags for the Portfolio, shown or hidden, the cover,
// Best picks and the service pages, moving or publishing it, the client's
// choice, the file's details, and copying, sharing, downloading or deleting.
// Each change is saved as it is made. The arrows (and ← →) go to the
// neighbouring photos without closing it; Esc closes it.

import { useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Copy,
  Download,
  EyeOff,
  Link2,
  LoaderCircle,
  Plus,
  Share2,
  Trash2,
  X,
} from "lucide-react";
import PhotoFrame from "@/src/components/common/PhotoFrame";
import { useT } from "@/src/lib/i18n/LanguageProvider";
import { BEST_PICKS_PLACE } from "@/src/lib/placements";
import type { AlbumTarget, StudioPhoto } from "@/src/lib/studio/gallery";
import type { GallerySet } from "@/src/lib/gallery-sets";
import type { PlaceOption, Placed } from "./PhotoActions";
import { copyText, detailsText, shareLink, type DetailRow } from "./photo-info";
import type { PhotoOps } from "./photo-ops";

const FIELD =
  "mt-1.5 w-full min-w-0 rounded-md border border-input bg-card px-2.5 text-sm text-foreground placeholder:text-muted-foreground " +
  "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring disabled:opacity-60";
const SMALL =
  "inline-flex h-8 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 text-[13px] font-semibold transition " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50";
const SMALL_QUIET = `${SMALL} bg-foreground/6 text-foreground hover:bg-foreground/12`;
const SMALL_MAIN = `${SMALL} bg-primary text-primary-foreground hover:bg-primary-hover`;
const SMALL_DANGER = `${SMALL} border border-destructive text-destructive hover:ring-1 hover:ring-destructive`;
const ICON_BUTTON =
  "grid size-9 shrink-0 place-items-center rounded-md text-foreground transition hover:bg-foreground/8 " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-30";
const HEADING = "text-[13px] font-semibold";

const MARK_DOT: Record<string, string> = { publish: "bg-emerald-400", keep: "bg-sky-300", delete: "bg-red-400" };

export interface PhotoPanelProps {
  photo: StudioPhoto;
  index: number;
  total: number;
  galleryTitle: string;
  isClient: boolean;
  detailsReady: boolean;
  link: string | null;
  rows: DetailRow[];
  /** Categories to offer as tags: the Portfolio's, and every tag in use here. */
  tagOptions: string[];
  albums: AlbumTarget[];
  categories: string[];
  places: PlaceOption[];
  placed: Placed;
  counts: Record<string, number>;
  onToggle: (place: string, on: boolean) => Promise<string | undefined>;
  ops: PhotoOps;
  /** The gallery's sets, when it is divided into sets, and the one the photo is in. */
  sets: GallerySet[];
  setId: string | null;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
}

export default function PhotoPanel(props: PhotoPanelProps) {
  const { photo, index, total, onPrev, onNext, onClose } = props;
  const { t } = useT();
  const heading = useRef<HTMLHeadingElement>(null);

  // The focus moves into the panel when it opens.
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, []);

  // Esc closes; ← → go through the photos unless a field is being typed in.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const typing =
        e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement;
      if (e.key === "Escape") {
        if (typing) (e.target as HTMLElement).blur();
        else onClose();
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "ArrowLeft") onPrev();
      if (e.key === "ArrowRight") onNext();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onPrev, onNext]);

  return (
    <>
      <div aria-hidden onClick={onClose} className="fixed inset-0 z-40 bg-black/50 lg:hidden" />
      <aside
        role="dialog"
        aria-modal="false"
        aria-labelledby="photo-panel-title"
        className="fixed inset-x-0 bottom-0 z-50 flex max-h-[85dvh] flex-col rounded-t-2xl border-t border-border bg-background shadow-2xl lg:inset-y-0 lg:left-auto lg:right-0 lg:max-h-none lg:w-[40vw] lg:rounded-none lg:border-l lg:border-t-0"
      >
        <div aria-hidden className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-foreground/20 lg:hidden" />
        <div className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-2 sm:px-3">
          <button type="button" onClick={onClose} aria-label={t("gallery.photos.panel.close")} className={ICON_BUTTON}>
            <X aria-hidden className="size-4" />
          </button>
          <h2
            id="photo-panel-title"
            ref={heading}
            tabIndex={-1}
            className="min-w-0 flex-1 truncate px-1 text-sm font-semibold outline-none"
            title={photo.name}
          >
            {photo.name}
          </h2>
          <span className="whitespace-nowrap px-1 text-xs tabular-nums text-muted-foreground">
            {t("gallery.photos.panel.position", { n: index + 1, total })}
          </span>
          <button type="button" onClick={onPrev} disabled={index === 0} aria-label={t("gallery.photos.panel.previous")} className={ICON_BUTTON}>
            <ChevronLeft aria-hidden className="size-4" />
          </button>
          <button type="button" onClick={onNext} disabled={index === total - 1} aria-label={t("gallery.photos.panel.next")} className={ICON_BUTTON}>
            <ChevronRight aria-hidden className="size-4" />
          </button>
        </div>

        {/* Keyed: every field starts from the photo it is showing. */}
        <PanelBody key={photo.id} {...props} />
      </aside>
    </>
  );
}

function PanelBody({
  photo,
  isClient,
  detailsReady,
  link,
  rows,
  tagOptions,
  albums,
  categories,
  places,
  placed,
  counts,
  onToggle,
  ops,
  sets,
  setId,
}: PhotoPanelProps) {
  const { t } = useT();
  const [name, setName] = useState(photo.name);
  const [description, setDescription] = useState(photo.description);
  const [newTag, setNewTag] = useState("");
  // The tags as they are being edited: shown at once, saved one after another.
  const [tags, setTagList] = useState(photo.tags);
  const [busy, setBusy] = useState<string | null>(null);
  // Saves run one after another, never two at once and never dropped: a
  // change made while another is saving waits for it.
  const queue = useRef<Promise<void>>(Promise.resolve());
  // One message per part of the panel: "name", "description", "tags", ...
  const [notes, setNotes] = useState<Record<string, { ok: boolean; text: string }>>({});
  const [confirmDelete, setConfirmDelete] = useState(false);

  const note = (part: string, ok: boolean, text: string) => setNotes((n) => ({ ...n, [part]: { ok, text } }));
  const clear = (part: string) =>
    setNotes((n) => {
      const next = { ...n };
      delete next[part];
      return next;
    });

  const run = (part: string, fn: () => Promise<string | undefined | void>, done?: string): Promise<void> => {
    const job = queue.current.then(async () => {
      setBusy(part);
      clear(part);
      let error: string | undefined | void;
      try {
        error = await fn();
      } catch {
        error = "failed";
      }
      setBusy(null);
      if (error) note(part, false, t(`errors.${error}`));
      else if (done) note(part, true, done);
    });
    queue.current = job;
    return job;
  };

  const noteLine = (part: string) =>
    notes[part] ? (
      <p role={notes[part].ok ? "status" : "alert"} className={`mt-1 text-xs ${notes[part].ok ? "text-muted-foreground" : "text-destructive"}`}>
        {notes[part].text}
      </p>
    ) : null;

  const saveName = () => {
    const next = name.trim();
    if (next === photo.name || !detailsReady) return;
    void run("name", () => ops.update(photo.id, { name: next || null }), t("gallery.photos.panel.saved"));
  };
  const saveDescription = () => {
    if (description.trim() === photo.description || !detailsReady) return;
    void run("description", () => ops.update(photo.id, { description: description.trim() || null }), t("gallery.photos.panel.saved"));
  };
  const setTags = (next: string[]) => {
    setTagList(next);
    void run("tags", async () => {
      const error = await ops.update(photo.id, { tags: next });
      // Refused: back to what is saved.
      if (error) setTagList(photo.tags);
      return error;
    });
  };

  const has = (tag: string) => tags.some((x) => x.toLowerCase() === tag.toLowerCase());
  const suggestions = tagOptions.filter((o) => !has(o));
  const addTag = () => {
    const tag = newTag.trim().slice(0, 40);
    if (!tag || has(tag) || tags.length >= 10) return;
    setNewTag("");
    setTags([...tags, tag]);
  };

  const ratio = photo.width && photo.height ? `${photo.width} / ${photo.height}` : "3 / 2";
  const isPlaced = (id: string) => Array.isArray(placed) && placed.includes(id);
  const placeLabel = (p: PlaceOption) => (p.id === BEST_PICKS_PLACE ? t("gallery.photos.actions.bestPicks") : (p.title ?? p.id));
  const notReady = !detailsReady ? <p className="mt-1 text-xs text-muted-foreground">{t("errors.detailsNotSetUp")}</p> : null;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-4 sm:px-5">
      {/* The photo, whole. */}
      <div className="mx-auto flex max-h-[30dvh] justify-center lg:max-h-[42dvh]" style={{ aspectRatio: ratio }}>
        <div className="relative h-full max-w-full" style={{ aspectRatio: ratio }}>
          <PhotoFrame
            ladder={photo.ladder}
            thumbhash={photo.thumbhash}
            alt={photo.description || photo.name}
            sizes="(min-width: 1024px) 38vw, 92vw"
            className={`h-full w-full rounded-md ${photo.hidden ? "opacity-50" : ""}`}
          />
          {photo.hidden && (
            <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-md bg-black/70 px-1.5 py-1 text-[11px] font-medium leading-none text-white">
              <EyeOff aria-hidden className="size-3" />
              {t("gallery.photos.hidden")}
            </span>
          )}
        </div>
      </div>

      <div className="mt-5 grid gap-5">
        {/* Name */}
        <div>
          <label htmlFor="panel-name" className={HEADING}>
            {t("gallery.photos.info.name")}
          </label>
          <input
            id="panel-name"
            value={name}
            maxLength={200}
            disabled={!detailsReady}
            onChange={(e) => setName(e.target.value)}
            onBlur={saveName}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                (e.target as HTMLInputElement).blur();
              }
            }}
            className={`${FIELD} h-9`}
          />
          {photo.name !== photo.fileName && detailsReady && (
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => {
                setName(photo.fileName);
                void run("name", () => ops.update(photo.id, { name: null }), t("gallery.photos.panel.saved"));
              }}
              className="mt-1 text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
            >
              {t("gallery.photos.actions.useFileName")}
            </button>
          )}
          {noteLine("name")}
          {notReady}
        </div>

        {/* Description */}
        <div>
          <div className="flex items-baseline justify-between gap-3">
            <label htmlFor="panel-description" className={HEADING}>
              {t("gallery.photos.info.description")}
            </label>
            {description.length > 800 && <span className="text-xs tabular-nums text-muted-foreground">{description.length} / 1000</span>}
          </div>
          <textarea
            id="panel-description"
            value={description}
            maxLength={1000}
            rows={3}
            disabled={!detailsReady}
            placeholder={t("gallery.photos.panel.descriptionPlaceholder")}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={saveDescription}
            className={`${FIELD} resize-y py-2 leading-relaxed`}
          />
          <p className="mt-1 text-xs text-muted-foreground">{t("gallery.photos.panel.descriptionHint")}</p>
          {noteLine("description")}
        </div>

        {/* Tags */}
        <div>
          <p className={HEADING}>{t("gallery.photos.info.tags")}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{t("gallery.photos.panel.tagsHint")}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {tags.map((tag) => (
              <button
                key={tag}
                type="button"
                disabled={!detailsReady}
                onClick={() => setTags(tags.filter((x) => x !== tag))}
                aria-label={t("gallery.photos.panel.removeTag", { tag })}
                className="inline-flex h-7 items-center gap-1 whitespace-nowrap rounded-full bg-foreground px-2.5 text-xs font-medium text-background disabled:opacity-60"
              >
                {tag}
                <X aria-hidden className="size-3" />
              </button>
            ))}
            {suggestions.map((tag) => (
              <button
                key={tag}
                type="button"
                disabled={!detailsReady || tags.length >= 10}
                onClick={() => setTags([...tags, tag])}
                className="inline-flex h-7 items-center gap-1 whitespace-nowrap rounded-full border border-border px-2.5 text-xs font-medium text-foreground hover:border-foreground/40 disabled:opacity-50"
              >
                <Plus aria-hidden className="size-3" />
                {tag}
              </button>
            ))}
          </div>
          <form
            className="mt-2 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              addTag();
            }}
          >
            <input
              value={newTag}
              maxLength={40}
              disabled={!detailsReady || tags.length >= 10}
              onChange={(e) => setNewTag(e.target.value)}
              placeholder={t("gallery.photos.panel.newTag")}
              aria-label={t("gallery.photos.panel.newTag")}
              className={`${FIELD} mt-0 h-8`}
            />
            <button type="submit" disabled={!newTag.trim()} className={SMALL_QUIET}>
              {t("gallery.photos.panel.addTag")}
            </button>
          </form>
          {noteLine("tags")}
        </div>

        {/* Shown or hidden, and the cover */}
        <div className="grid gap-3 border-t border-border pt-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p id="panel-shown" className={HEADING}>
                {t("gallery.photos.panel.shown")}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t(photo.hidden ? "gallery.photos.panel.hiddenHint" : "gallery.photos.panel.shownHint")}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={!photo.hidden}
              aria-labelledby="panel-shown"
              disabled={!detailsReady || busy !== null}
              onClick={() => run("hidden", () => ops.update(photo.id, { hidden: !photo.hidden }))}
              className={`relative mt-0.5 inline-flex h-6 w-10 shrink-0 items-center rounded-full transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50 ${
                photo.hidden ? "bg-foreground/20" : "bg-emerald-500"
              }`}
            >
              <span
                aria-hidden
                className={`inline-block size-5 rounded-full bg-white shadow transition-transform ${photo.hidden ? "translate-x-0.5" : "translate-x-[18px]"}`}
              />
            </button>
          </div>
          {noteLine("hidden")}
          <div className="flex items-center justify-between gap-4">
            <p className={HEADING}>{t("gallery.photos.cover")}</p>
            {photo.isCover ? (
              <span className="inline-flex items-center gap-1 whitespace-nowrap text-xs text-muted-foreground">
                <Check aria-hidden className="size-3.5" />
                {t("gallery.photos.panel.isCover")}
              </span>
            ) : (
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => run("cover", () => ops.setCover(photo.id))}
                className={SMALL_QUIET}
              >
                {busy === "cover" && <LoaderCircle aria-hidden className="size-3.5 animate-spin" />}
                {t("gallery.photos.setCover")}
              </button>
            )}
          </div>
          {noteLine("cover")}
        </div>

        {/* The set it is in: another one moves it there */}
        {sets.length > 1 && (
          <div className="border-t border-border pt-4">
            <p className={HEADING}>{t("gallery.photos.panel.set")}</p>
            <div role="radiogroup" aria-label={t("gallery.photos.panel.set")} className="mt-2 flex flex-wrap gap-1.5">
              {sets.map((s) => {
                const here = s.id === setId;
                return (
                  <button
                    key={s.id}
                    type="button"
                    role="radio"
                    aria-checked={here}
                    disabled={busy !== null}
                    onClick={() => !here && run("set", () => ops.toSet([photo.id], s.id))}
                    className={`inline-flex h-7 items-center gap-1 whitespace-nowrap rounded-md border px-2.5 text-xs font-medium transition disabled:opacity-60 ${
                      here ? "border-foreground bg-foreground text-background" : "border-border text-foreground hover:border-foreground/40"
                    }`}
                  >
                    {here && <Check aria-hidden className="size-3" strokeWidth={3} />}
                    {s.label}
                  </button>
                );
              })}
            </div>
            {noteLine("set")}
          </div>
        )}

        {/* Best picks and the service pages */}
        {!isClient && (
          <div className="border-t border-border pt-4">
            <p className={HEADING}>{t("gallery.photos.actions.addToTitle")}</p>
            {Array.isArray(placed) ? (
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {places.map((p) => {
                  const on = isPlaced(p.id);
                  return (
                    <li key={p.id}>
                      <button
                        type="button"
                        aria-pressed={on}
                        disabled={busy !== null}
                        onClick={() =>
                          run(`place:${p.id}`, () => onToggle(p.id, !on), t(on ? "gallery.photos.actions.removed" : "gallery.photos.actions.added", { place: placeLabel(p) }))
                        }
                        className={`inline-flex h-7 items-center gap-1 whitespace-nowrap rounded-full border px-2.5 text-xs font-medium transition disabled:opacity-60 ${
                          on ? "border-accent-warm bg-accent-warm text-white" : "border-border text-foreground hover:border-foreground/40"
                        }`}
                      >
                        {busy === `place:${p.id}` ? (
                          <LoaderCircle aria-hidden className="size-3 animate-spin" />
                        ) : on ? (
                          <Check aria-hidden className="size-3" strokeWidth={3} />
                        ) : (
                          <Plus aria-hidden className="size-3" />
                        )}
                        {placeLabel(p)}
                        <span className="tabular-nums opacity-70">{counts[p.id] ?? 0}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="mt-1 text-xs text-destructive">{t(placed === "missing" ? "errors.placesNotSetUp" : "errors.failed")}</p>
            )}
            {Object.entries(notes)
              .filter(([k]) => k.startsWith("place:"))
              .slice(-1)
              .map(([k]) => (
                <div key={k}>{noteLine(k)}</div>
              ))}
          </div>
        )}

        {/* Moving or publishing */}
        <MovePart photo={photo} isClient={isClient} albums={albums} categories={categories} ops={ops} />

        {/* The client's choice */}
        {photo.mark && (
          <div className="flex items-center justify-between gap-4 border-t border-border pt-4">
            <p className={HEADING}>{t("gallery.photos.panel.clientChose")}</p>
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-sm">
              <span aria-hidden className={`size-2 rounded-full ${MARK_DOT[photo.mark]}`} />
              {t(`gallery.photos.mark.${photo.mark}`)}
            </span>
          </div>
        )}

        {/* The file */}
        <div className="border-t border-border pt-4">
          <p className={HEADING}>{t("gallery.photos.panel.details")}</p>
          <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-[13px]">
            {rows.map((r) => (
              <div key={r.label} className="contents">
                <dt className="whitespace-nowrap text-muted-foreground">{r.label}</dt>
                <dd className="min-w-0 break-words">{r.value}</dd>
              </div>
            ))}
          </dl>
        </div>

        {/* Copying, sharing, downloading, deleting */}
        <div className="border-t border-border pt-4">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!link || busy !== null}
              title={link ? undefined : t("gallery.photos.actions.noLink")}
              onClick={() =>
                link && run("copy", async () => ((await copyText(link)) ? undefined : "failed"), t("gallery.photos.actions.linkCopied"))
              }
              className={SMALL_QUIET}
            >
              <Link2 aria-hidden className="size-3.5" />
              {t("gallery.photos.actions.copyLink")}
            </button>
            <button
              type="button"
              disabled={!link || busy !== null}
              onClick={() =>
                link &&
                run("copy", async () => {
                  const r = await shareLink(link, photo.name);
                  if (r === "copied") note("copy", true, t("gallery.photos.actions.linkCopied"));
                  return r === "failed" ? "failed" : undefined;
                })
              }
              className={SMALL_QUIET}
            >
              <Share2 aria-hidden className="size-3.5" />
              {t("gallery.photos.actions.share")}
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => run("copy", async () => ((await copyText(photo.name)) ? undefined : "failed"), t("gallery.photos.actions.filenameCopied"))}
              className={SMALL_QUIET}
            >
              <Copy aria-hidden className="size-3.5" />
              {t("gallery.photos.actions.copyFilename")}
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() =>
                run("copy", async () => ((await copyText(detailsText(rows))) ? undefined : "failed"), t("gallery.photos.actions.detailsCopied"))
              }
              className={SMALL_QUIET}
            >
              <ClipboardList aria-hidden className="size-3.5" />
              {t("gallery.photos.actions.copyDetails")}
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => {
                // Opened now, while this is still the click: a window opened
                // after the address arrives would be stopped as a pop-up.
                const win = window.open("", "_blank");
                void run("copy", async () => {
                  const r = await ops.original(photo.id);
                  if (r.url && win) win.location.href = r.url;
                  else win?.close();
                  return r.error;
                });
              }}
              className={SMALL_QUIET}
            >
              <Download aria-hidden className="size-3.5" />
              {t("gallery.photos.panel.original")}
            </button>
          </div>
          {noteLine("copy")}

          <div className="mt-4">
            {confirmDelete ? (
              <div className="flex flex-wrap items-center gap-2">
                <p className="basis-full text-[13px]">{t("gallery.photos.actions.deleteAsk", { name: photo.name })}</p>
                <button type="button" disabled={busy !== null} onClick={() => run("delete", () => ops.remove(photo.id))} className={SMALL_DANGER}>
                  {busy === "delete" && <LoaderCircle aria-hidden className="size-3.5 animate-spin" />}
                  {t("gallery.photos.deleteConfirmOne")}
                </button>
                <button type="button" disabled={busy !== null} onClick={() => setConfirmDelete(false)} className={SMALL_QUIET}>
                  {t("common.cancel")}
                </button>
              </div>
            ) : (
              <button type="button" onClick={() => setConfirmDelete(true)} className={`${SMALL} px-0 text-destructive hover:underline`}>
                <Trash2 aria-hidden className="size-3.5" />
                {t("gallery.photos.actions.delete")}
              </button>
            )}
            {noteLine("delete")}
          </div>
        </div>
      </div>
    </div>
  );
}

function MovePart({
  photo,
  isClient,
  albums,
  categories,
  ops,
}: {
  photo: StudioPhoto;
  isClient: boolean;
  albums: AlbumTarget[];
  categories: string[];
  ops: PhotoOps;
}) {
  const { t } = useT();
  const [to, setTo] = useState<string>(albums[0]?.id ?? "new");
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState(categories[0] ?? "");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  return (
    <div className="border-t border-border pt-4">
      <p className={HEADING}>{t(isClient ? "gallery.photos.actions.publishTo" : "gallery.photos.actions.moveTo")}</p>
      {photo.publishedIn && (
        <p className="mt-0.5 text-xs text-muted-foreground">{t("gallery.photos.inAlbum", { album: photo.publishedIn })}</p>
      )}
      <form
        className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]"
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          setBusy(true);
          setResult(null);
          const r = await ops.move(photo.id, to === "new" ? { to, title: title.trim(), category: category.trim() } : { to });
          setBusy(false);
          setResult(
            r.error
              ? { ok: false, text: t(`errors.${r.error}`) }
              : { ok: true, text: t(isClient ? "gallery.photos.publishedOne" : "gallery.photos.movedOne", { album: r.album ?? "" }) },
          );
        }}
      >
        <select value={to} onChange={(e) => setTo(e.target.value)} aria-label={t("gallery.photos.to")} className={`${FIELD} mt-0 h-9`}>
          <option value="new">{t("gallery.photos.newAlbum")}</option>
          {albums.length > 0 && (
            <optgroup label={t("gallery.photos.albums")}>
              {albums.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.category ? `${a.title} (${a.category})` : a.title}
                </option>
              ))}
            </optgroup>
          )}
        </select>
        <button type="submit" disabled={busy || (to === "new" && (!title.trim() || !category.trim()))} className={SMALL_MAIN}>
          {busy && <LoaderCircle aria-hidden className="size-3.5 animate-spin" />}
          {t(isClient ? "gallery.photos.publishN" : "gallery.photos.moveN", { n: 1 })}
        </button>
        {to === "new" && (
          <div className="grid gap-2 sm:col-span-2 sm:grid-cols-2">
            <input
              required
              maxLength={200}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("gallery.photos.albumTitle")}
              aria-label={t("gallery.photos.albumTitle")}
              className={`${FIELD} mt-0 h-9`}
            />
            <input
              required
              maxLength={40}
              list="panel-categories"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder={t("gallery.photos.category")}
              aria-label={t("gallery.photos.category")}
              className={`${FIELD} mt-0 h-9`}
            />
            <datalist id="panel-categories">
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>
        )}
      </form>
      {result && (
        <p role={result.ok ? "status" : "alert"} className={`mt-1 text-xs ${result.ok ? "text-muted-foreground" : "text-destructive"}`}>
          {result.text}
        </p>
      )}
    </div>
  );
}
