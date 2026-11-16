"use client";

// The Photos tab's grid: the photographs, which one is the cover, and
// choosing some to delete, publish or move.
//
// Select switches the tiles into choosing: a click picks a photo, Shift-click
// picks everything between it and the last one picked. The bar above the
// grid stays in view while choosing, with the count, Select all, Publish
// (client galleries) or Move (albums), Delete (which asks once more) and
// Done. Esc leaves.
//
// Client galleries also show what the client chose for each photo, with
// chips to see only one kind: pick Publish, Select all, Publish to album.

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { Check, CircleAlert } from "lucide-react";
import PhotoFrame from "@/src/components/common/PhotoFrame";
import {
  deletePhotos,
  sendPhotos,
  setCover,
  type DeletePhotosState,
  type SendPhotosState,
} from "@/src/app/studio/gallery-actions";
import { useT } from "@/src/lib/i18n/LanguageProvider";
import type { GalleryKind } from "@/src/lib/ladder";
import type { AlbumTarget, ClientMark, StudioPhoto } from "@/src/lib/studio/gallery";
import { PendingButton } from "./FormFeedback";

type Filter = "all" | ClientMark | "none";
const FILTERS: Filter[] = ["all", "publish", "keep", "delete", "none"];

const MARK_DOT: Record<ClientMark, string> = {
  publish: "bg-emerald-400",
  keep: "bg-sky-300",
  delete: "bg-red-400",
};

function matches(photo: StudioPhoto, filter: Filter): boolean {
  if (filter === "all") return true;
  if (filter === "none") return !photo.mark;
  return photo.mark === filter;
}

const SMALL =
  "inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 text-[13px] font-semibold transition " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50";
const SMALL_QUIET = `${SMALL} bg-foreground/6 text-foreground hover:bg-foreground/12`;
const SMALL_DANGER = `${SMALL} border border-destructive text-destructive hover:ring-1 hover:ring-destructive`;
const SMALL_MAIN = `${SMALL} bg-primary text-primary-foreground hover:bg-primary-hover`;
const LINK = "whitespace-nowrap text-[13px] font-medium text-foreground underline-offset-4 hover:underline";
const FIELD =
  "h-9 min-w-0 rounded-md border border-input bg-card px-2 text-foreground placeholder:text-muted-foreground " +
  "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring";

interface Props {
  galleryId: string;
  galleryTitle: string;
  kind: GalleryKind;
  photos: StudioPhoto[];
  /** Where chosen photos can go. */
  albums: AlbumTarget[];
  categories: string[];
}

export default function StudioPhotoGrid({ galleryId, galleryTitle, kind, photos: all, albums, categories }: Props) {
  const { t } = useT();
  const [selecting, setSelecting] = useState(false);
  const [chosen, setChosen] = useState<Set<string>>(() => new Set());
  const [armed, setArmed] = useState(false);
  const [sending, setSending] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const lastPicked = useRef<number | null>(null);

  const isClient = kind === "client";
  const counts = Object.fromEntries(FILTERS.map((f) => [f, all.filter((p) => matches(p, f)).length])) as Record<
    Filter,
    number
  >;
  const anyMarks = isClient && counts.none < all.length;
  // A filter whose photos all went (deleted, published) falls back to All.
  const shown = anyMarks && counts[filter] > 0 ? filter : "all";
  const photos = all.filter((p) => matches(p, shown));

  const stop = () => {
    setSelecting(false);
    setChosen(new Set());
    setArmed(false);
    setSending(false);
    lastPicked.current = null;
  };

  // One message under the bar: whichever of the two was sent last.
  const [last, setLast] = useState<"delete" | "send" | null>(null);

  const [state, action, pending] = useActionState<DeletePhotosState, FormData>(async (prev, form) => {
    const result = await deletePhotos(prev, form);
    if (result.ok) {
      setSelecting(false);
      setChosen(new Set());
      lastPicked.current = null;
    }
    setArmed(false);
    setLast("delete");
    return result;
  }, {});

  const [sent, send, sendPending] = useActionState<SendPhotosState, FormData>(async (prev, form) => {
    const result = await sendPhotos(prev, form);
    if (result.ok) {
      setSelecting(false);
      setSending(false);
      setChosen(new Set());
      lastPicked.current = null;
    }
    setLast("send");
    return result;
  }, {});

  useEffect(() => {
    if (!selecting) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setSelecting(false);
      setChosen(new Set());
      setArmed(false);
      setSending(false);
      lastPicked.current = null;
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selecting]);

  // Photos that went away (deleted, or the page refreshed) or are filtered
  // out are not counted.
  const picked = photos.filter((p) => chosen.has(p.id));
  const n = picked.length;
  const busy = pending || sendPending;

  function pick(index: number, range: boolean) {
    const id = photos[index].id;
    setArmed(false);
    setChosen((prev) => {
      const next = new Set(prev);
      if (range && lastPicked.current !== null && lastPicked.current !== index) {
        const [a, b] = [lastPicked.current, index].sort((x, y) => x - y);
        for (let i = a; i <= b; i++) next.add(photos[i].id);
      } else if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
    lastPicked.current = index;
  }

  const done = last === "delete" && !pending && state.ok && state.deleted ? state.deleted : 0;
  const error = last === "send" ? (!sendPending ? sent.error : undefined) : !pending ? state.error : undefined;
  const moved = last === "send" && !sendPending && sent.ok ? sent : null;

  return (
    <>
      {anyMarks && (
        <div className="-mx-1 mb-3 flex gap-1.5 overflow-x-auto px-1 pb-1" role="group" aria-label={t("gallery.photos.marksLabel")}>
          {FILTERS.filter((f) => f === "all" || counts[f] > 0).map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={shown === f}
              onClick={() => {
                setFilter(f);
                lastPicked.current = null;
              }}
              className={`inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-[13px] font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${
                shown === f
                  ? "border-foreground bg-foreground text-background"
                  : "border-border text-foreground hover:border-foreground/40"
              }`}
            >
              {f !== "all" && f !== "none" && <span aria-hidden className={`size-2 rounded-full ${MARK_DOT[f]}`} />}
              {t(`gallery.photos.mark.${f}`)}
              <span className="tabular-nums opacity-70">{counts[f]}</span>
            </button>
          ))}
        </div>
      )}

      <div
        className={
          selecting
            ? "sticky top-12 z-20 -mx-4 border-b border-border bg-background/95 px-4 py-2 backdrop-blur sm:-mx-8 sm:px-8 lg:top-0 lg:-mx-10 lg:px-10"
            : ""
        }
      >
      <form
        action={action}
        className={
          selecting
            ? "flex min-h-8 flex-wrap items-center justify-between gap-x-4 gap-y-2"
            : "flex flex-wrap items-center justify-between gap-x-4 gap-y-2"
        }
      >
        <input type="hidden" name="galleryId" value={galleryId} />
        {picked.map((p) => (
          <input key={p.id} type="hidden" name="photo" value={p.id} />
        ))}

        {selecting ? (
          <>
            <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
              <span className="text-sm font-semibold tabular-nums" aria-live="polite">
                {t("gallery.photos.selected", { n })}
              </span>
              {n < photos.length ? (
                <button type="button" className={LINK} onClick={() => setChosen(new Set(photos.map((p) => p.id)))}>
                  {t("gallery.photos.selectAll")}
                </button>
              ) : (
                <button type="button" className={LINK} onClick={() => setChosen(new Set())}>
                  {t("gallery.photos.selectNone")}
                </button>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {/* Keyed: without it React would turn the Delete button into the
                  submit button during its own click, and the click would send
                  the form before the question was asked. */}
              {armed && n > 0 ? (
                <>
                  <button key="yes" type="submit" disabled={busy} className={SMALL_DANGER}>
                    {t(n === 1 ? "gallery.photos.deleteConfirmOne" : "gallery.photos.deleteConfirmMany", { n })}
                  </button>
                  <button key="no" type="button" disabled={busy} className={SMALL_QUIET} onClick={() => setArmed(false)}>
                    {t("common.cancel")}
                  </button>
                </>
              ) : (
                <>
                  <button
                    key="send"
                    type="button"
                    disabled={n === 0 || busy}
                    aria-expanded={sending}
                    className={sending ? SMALL_QUIET : SMALL_MAIN}
                    onClick={() => setSending((v) => !v)}
                  >
                    {t(isClient ? "gallery.photos.publish" : "gallery.photos.move")}
                  </button>
                  <button
                    key="delete"
                    type="button"
                    disabled={n === 0 || busy}
                    className={SMALL_DANGER}
                    onClick={() => {
                      setSending(false);
                      setArmed(true);
                    }}
                  >
                    {t("gallery.photos.delete")}
                  </button>
                  <button key="done" type="button" className={SMALL_QUIET} onClick={stop}>
                    {t("gallery.photos.done")}
                  </button>
                </>
              )}
            </div>
          </>
        ) : (
          <>
            <p className="min-w-0 text-sm text-muted-foreground">{t("gallery.photos.coverHint")}</p>
            <button type="button" className={SMALL_QUIET} onClick={() => setSelecting(true)}>
              {t("gallery.photos.select")}
            </button>
          </>
        )}
      </form>

      {selecting && sending && n > 0 && (
        <SendForm
          key={kind}
          action={send}
          pending={sendPending}
          galleryId={galleryId}
          galleryTitle={galleryTitle}
          isClient={isClient}
          picked={picked.map((p) => p.id)}
          albums={albums}
          categories={categories}
          onCancel={() => setSending(false)}
        />
      )}
      </div>

      <p role={error ? "alert" : "status"} className="mt-2 min-h-5 text-sm">
        {error && (
          <span className="flex items-start gap-2 text-destructive">
            <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
            <span>{t(`errors.${error}`)}</span>
          </span>
        )}
        {moved && !selecting && (
          <span className="flex flex-wrap items-start gap-x-1.5 text-muted-foreground">
            <Check aria-hidden className="mt-0.5 size-4 shrink-0" />
            <span>
              {[
                t(
                  isClient
                    ? moved.done === 1
                      ? "gallery.photos.publishedOne"
                      : "gallery.photos.publishedMany"
                    : moved.done === 1
                      ? "gallery.photos.movedOne"
                      : "gallery.photos.movedMany",
                  { n: moved.done ?? 0, album: moved.to?.title ?? "" },
                ),
                moved.skipped ? t("gallery.photos.alreadyThere", { n: moved.skipped }) : "",
              ]
                .filter(Boolean)
                .join(", ")}
            </span>
            {moved.to && (
              <Link href={moved.to.href} className="font-medium text-foreground underline underline-offset-4">
                {t("gallery.photos.openAlbum")}
              </Link>
            )}
          </span>
        )}
        {done > 0 && !selecting && (
          <span className="flex items-start gap-1.5 text-muted-foreground">
            <Check aria-hidden className="mt-0.5 size-4 shrink-0" />
            <span>{t(done === 1 ? "gallery.photos.deletedOne" : "gallery.photos.deletedMany", { n: done })}</span>
          </span>
        )}
        {selecting && n === 0 && !error && (
          <span className="text-muted-foreground">{t("gallery.photos.selectHint")}</span>
        )}
      </p>

      <ul className="mt-2 grid grid-cols-3 gap-x-2 gap-y-4 sm:grid-cols-4 sm:gap-x-3 lg:grid-cols-5 2xl:grid-cols-6">
        {photos.map((photo, index) => {
          const on = chosen.has(photo.id);
          const frame = (
            <div
              className={`relative overflow-hidden rounded-lg ring-1 ${on ? "ring-2 ring-accent-warm" : "ring-border"}`}
            >
              <PhotoFrame
                ladder={photo.ladder}
                thumbhash={photo.thumbhash}
                alt={photo.fileName}
                sizes="(min-width: 1536px) 14vw, (min-width: 1024px) 17vw, (min-width: 640px) 23vw, 31vw"
                className={`aspect-square w-full transition ${on ? "scale-[0.94] rounded-md" : ""}`}
              />
              {photo.isCover && (
                <span className="absolute left-1.5 top-1.5 rounded-md bg-black/70 px-1.5 py-1 text-[11px] font-medium leading-none text-white">
                  {t("gallery.photos.cover")}
                </span>
              )}
              {photo.mark && (
                <span className="absolute bottom-1.5 left-1.5 inline-flex items-center gap-1 whitespace-nowrap rounded-md bg-black/70 px-1.5 py-1 text-[11px] font-medium leading-none text-white">
                  <span aria-hidden className={`size-1.5 rounded-full ${MARK_DOT[photo.mark]}`} />
                  {t(`gallery.photos.mark.${photo.mark}`)}
                </span>
              )}
              {selecting && (
                <span
                  aria-hidden
                  className={`absolute right-1.5 top-1.5 grid size-5 place-items-center rounded-full border-2 ${
                    on ? "border-accent-warm bg-accent-warm text-white" : "border-white bg-black/30"
                  }`}
                >
                  {on && <Check className="size-3" strokeWidth={3} />}
                </span>
              )}
            </div>
          );
          return (
            <li key={photo.id} className="min-w-0">
              {selecting ? (
                <button
                  type="button"
                  aria-pressed={on}
                  aria-label={photo.fileName}
                  onClick={(e) => pick(index, e.shiftKey)}
                  className="block w-full rounded-lg text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  {frame}
                </button>
              ) : (
                frame
              )}
              <p className="mt-1.5 truncate text-xs text-muted-foreground" title={photo.fileName}>
                {photo.fileName}
              </p>
              {photo.publishedIn && (
                <p className="truncate text-xs text-foreground" title={photo.publishedIn}>
                  {t("gallery.photos.inAlbum", { album: photo.publishedIn })}
                </p>
              )}
              {!selecting && !photo.isCover && (
                <form action={setCover}>
                  <input type="hidden" name="galleryId" value={galleryId} />
                  <input type="hidden" name="photo" value={photo.id} />
                  <PendingButton className="text-left text-[13px] text-accent-warm underline-offset-4 hover:underline disabled:opacity-60">
                    {t("gallery.photos.setCover")}
                  </PendingButton>
                </form>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}

/**
 * Where the chosen photos go: a new album (title and category) or one that
 * exists. One line on a wide screen, like a "Move to" in a file manager.
 */
function SendForm({
  action,
  pending,
  galleryId,
  galleryTitle,
  isClient,
  picked,
  albums,
  categories,
  onCancel,
}: {
  action: (form: FormData) => void;
  pending: boolean;
  galleryId: string;
  galleryTitle: string;
  isClient: boolean;
  picked: string[];
  albums: AlbumTarget[];
  categories: string[];
  onCancel: () => void;
}) {
  const { t } = useT();
  const [to, setTo] = useState<string>(isClient || albums.length === 0 ? "new" : albums[0].id);
  const n = picked.length;

  return (
    <form action={action} className="mt-2 flex flex-wrap items-center gap-2 border-t border-border pt-2">
      <input type="hidden" name="galleryId" value={galleryId} />
      {picked.map((id) => (
        <input key={id} type="hidden" name="photo" value={id} />
      ))}
      <label className="flex min-w-0 items-center gap-2 text-[13px] text-muted-foreground">
        <span className="whitespace-nowrap">{t("gallery.photos.to")}</span>
        <select name="to" value={to} onChange={(e) => setTo(e.target.value)} className={`${FIELD} max-w-64`}>
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
      </label>
      {to === "new" && (
        <>
          <input
            name="title"
            required
            maxLength={200}
            defaultValue={isClient ? galleryTitle : ""}
            placeholder={t("gallery.photos.albumTitle")}
            aria-label={t("gallery.photos.albumTitle")}
            className={`${FIELD} w-48`}
          />
          <input
            name="category"
            required
            maxLength={40}
            list="studio-categories"
            defaultValue={categories[0] ?? ""}
            placeholder={t("gallery.photos.category")}
            aria-label={t("gallery.photos.category")}
            className={`${FIELD} w-36`}
          />
          <datalist id="studio-categories">
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </>
      )}
      <button type="submit" disabled={pending} className={SMALL_MAIN}>
        {t(isClient ? "gallery.photos.publishN" : "gallery.photos.moveN", { n })}
      </button>
      <button type="button" disabled={pending} className={SMALL_QUIET} onClick={onCancel}>
        {t("common.cancel")}
      </button>
      {isClient && <p className="basis-full text-xs text-muted-foreground">{t("gallery.photos.publishHint")}</p>}
    </form>
  );
}
