"use client";

// Uploading on a gallery's Photos tab: the drop zone, the worker's state, the
// drop's progress and one row per file.
//
// The work itself is done by the gallery's upload controller
// (src/lib/studio/upload-client.ts), which outlives this component, so
// moving to Settings and back does not stop anything. This only draws it.

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import {
  Ban,
  Check,
  CircleAlert,
  Clock,
  Copy,
  FileQuestion,
  ImagePlus,
  LoaderCircle,
  Pause,
  RotateCw,
  Upload,
  X,
} from "lucide-react";
import { useT } from "@/src/lib/i18n/LanguageProvider";
import { formatBytes } from "@/src/lib/studio/format";
import {
  EMPTY_SNAPSHOT,
  anySending,
  uploadsFor,
  type ItemState,
  type ServerBatch,
  type UploadItem,
  type WorkerState,
} from "@/src/lib/studio/upload-client";
import { BUTTON_PRIMARY, BUTTON_QUIET } from "./fields";
import type { GallerySet } from "@/src/lib/gallery-sets";
import { useActiveSet } from "./active-set";

const ACCEPT = ".jpg,.jpeg,.png,image/jpeg,image/png";

const LINK =
  "inline-flex items-center gap-1 whitespace-nowrap text-[13px] font-medium text-foreground underline-offset-4 hover:underline disabled:opacity-60";

const STATE_ICON: Record<ItemState, React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>> = {
  refused: Ban,
  waiting: Clock,
  uploading: LoaderCircle,
  queued: LoaderCircle,
  processing: LoaderCircle,
  ready: Check,
  failed: CircleAlert,
  skipped: Copy,
  cancelled: X,
  needs_file: FileQuestion,
  paused: Pause,
};

const SPINS: ItemState[] = ["uploading", "queued", "processing"];

export default function UploadPanel({
  galleryId,
  canUpload,
  hasPhotos,
  pending,
  worker,
  sets = [],
}: {
  galleryId: string;
  /** The gallery has a storage folder of its own. */
  canUpload: boolean;
  hasPhotos: boolean;
  /** Unfinished drops from earlier, as the server sees them. */
  pending: ServerBatch[];
  /** null when it could not be read. */
  worker: WorkerState | null;
  /** The gallery's sets: files land in the one open below. */
  sets?: GallerySet[];
}) {
  const { t, locale } = useT();
  const router = useRouter();
  const [uploads] = useState(() => uploadsFor(galleryId));
  const snap = useSyncExternalStore(uploads.subscribe, uploads.getSnapshot, () => EMPTY_SNAPSHOT);
  const pick = useRef<HTMLInputElement>(null);
  const pickAgain = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [activeSetId] = useActiveSet(sets);
  const activeSet = sets.find((s) => s.id === activeSetId) ?? null;

  // New drops are for the set open below.
  useEffect(() => {
    uploads.setTargetSet(activeSetId);
  }, [uploads, activeSetId]);

  // What the server knew when the page was drawn.
  useEffect(() => {
    uploads.hydrate(pending);
  }, [uploads, pending]);
  useEffect(() => {
    if (worker) uploads.setWorker(worker);
  }, [uploads, worker]);

  // New photos ready: draw the gallery again under the panel.
  useEffect(() => {
    uploads.setOnReady(() => router.refresh());
    return () => uploads.setOnReady(null);
  }, [uploads, router]);

  // Leaving the page while files are still being sent loses them.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (anySending()) e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  // The whole page takes a drop of files.
  useEffect(() => {
    if (!canUpload) return;
    let depth = 0;
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      setDragging(true);
    };
    const onOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length) void uploads.add(files);
    };
    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragover", onOver);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [canUpload, uploads]);

  const items = snap.items;
  const count = (states: ItemState[]) => items.filter((i) => states.includes(i.state)).length;
  const ready = count(["ready"]);
  const failed = count(["failed"]);
  const skipped = count(["skipped"]);
  const refused = count(["refused"]);
  const cancelled = count(["cancelled"]);
  const needsFile = count(["needs_file"]);
  const total = items.length - refused - cancelled;
  // A file being built cannot be taken back; everything before that can.
  const cancellable = count(["waiting", "uploading", "queued", "paused", "needs_file"]);
  const finished = ready + skipped + refused + cancelled;

  const sendingItems = items.filter((i) => i.state === "waiting" || i.state === "uploading");
  const sendBytes = sendingItems.reduce((n, i) => n + i.size, 0);
  const sentBytes = sendingItems.reduce((n, i) => n + i.sent, 0);

  // The live answer once the controller has one; the page's until then.
  const workerNow = snap.worker ?? worker;
  const workerOff = workerNow !== null && !workerNow.online;
  const bytes = (n: number) => formatBytes(n, locale, t);

  const summary = [
    total > 0 ? t("upload.summary.ready", { n: ready, total }) : null,
    sendingItems.length ? t("upload.summary.sending", { n: sendingItems.length }) : null,
    failed ? t("upload.summary.failed", { n: failed }) : null,
    skipped ? t("upload.summary.skipped", { n: skipped }) : null,
    refused ? t("upload.summary.refused", { n: refused }) : null,
    cancelled ? t("upload.summary.cancelled", { n: cancelled }) : null,
  ]
    .filter(Boolean)
    .join(", ");

  function onPick(e: React.ChangeEvent<HTMLInputElement>, again: boolean) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!files.length) return;
    if (again) void uploads.resume(files);
    else void uploads.add(files);
  }

  const chooser = (
    <>
      <input ref={pick} type="file" multiple accept={ACCEPT} hidden onChange={(e) => onPick(e, false)} />
      <input ref={pickAgain} type="file" multiple accept={ACCEPT} hidden onChange={(e) => onPick(e, true)} />
    </>
  );

  const workerLine = workerNow && (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[13px] text-muted-foreground">
      <span
        aria-hidden
        className={`size-2 shrink-0 rounded-full ${workerNow.online ? "bg-emerald-500" : "bg-foreground/30"}`}
      />
      {workerNow.online ? t("upload.workerOn") : t("upload.workerOff")}
    </span>
  );

  if (!canUpload) {
    return hasPhotos ? null : (
      <div className="max-w-prose">
        <h2 className="text-base font-semibold">{t("gallery.photos.empty")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("upload.errors.no_folder")}</p>
      </div>
    );
  }

  const emptyGallery = !hasPhotos && items.length === 0;

  return (
    <section aria-label={t("upload.title")} className={emptyGallery ? "" : "mb-6"}>
      {chooser}

      {emptyGallery ? (
        <div className="flex flex-col items-center rounded-xl border border-dashed border-border px-6 py-12 text-center">
          <ImagePlus aria-hidden className="size-6 text-muted-foreground" />
          <h2 className="mt-3 text-base font-semibold">{t("upload.dropTitle")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("upload.rules")}</p>
          <button
            type="button"
            onClick={() => pick.current?.click()}
            disabled={snap.starting}
            className={`${BUTTON_PRIMARY} mt-4`}
          >
            <Upload aria-hidden className="size-4" />
            {t("upload.choose")}
          </button>
          <div className="mt-4">{workerLine}</div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => pick.current?.click()}
              disabled={snap.starting}
              className={BUTTON_QUIET}
            >
              <Upload aria-hidden className="size-4" />
              {t("upload.add")}
            </button>
            {workerLine}
          </div>
          {!hasPhotos || items.length > 0 ? (
            activeSet && <p className="text-[13px] text-muted-foreground">{t("gallery.sets.uploadInto", { name: activeSet.label })}</p>
          ) : (
            <p className="text-[13px] text-muted-foreground">
              {activeSet ? t("gallery.sets.dropInto", { name: activeSet.label }) : t("upload.dropAnywhere")}
            </p>
          )}
        </div>
      )}

      {workerOff && (
        <p className="mt-3 max-w-prose text-sm text-muted-foreground">
          {t("upload.workerOffHint")}{" "}
          <code className="whitespace-nowrap rounded bg-foreground/6 px-1.5 py-0.5 text-[13px]">pnpm worker</code>
        </p>
      )}

      {snap.starting && (
        <p role="status" className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
          <LoaderCircle aria-hidden className="size-4 animate-spin" />
          {t("upload.starting")}
        </p>
      )}

      {snap.notice && (
        <div role="alert" className="mt-3 flex max-w-prose items-start gap-2 text-sm text-destructive">
          <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span className="min-w-0">
            {t(`upload.errors.${snap.notice}`) === `upload.errors.${snap.notice}`
              ? t("upload.errors.failed")
              : t(`upload.errors.${snap.notice}`)}
            {(snap.notice === "door_unreachable" || snap.notice === "door_local_only") && (
              <>
                {" "}
                <button type="button" onClick={() => uploads.tryAgain()} className="font-medium underline underline-offset-4">
                  {t("upload.tryAgain")}
                </button>
              </>
            )}
          </span>
          <button
            type="button"
            onClick={() => uploads.dismissNotice()}
            aria-label={t("common.close")}
            className="ml-auto inline-flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground"
          >
            <X aria-hidden className="size-3.5" />
          </button>
        </div>
      )}

      {needsFile > 0 && (
        <div className="mt-4 max-w-prose rounded-lg border border-border p-4">
          <p className="text-sm font-medium">{t("upload.resumeTitle")}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t("upload.resumeBlurb", { n: needsFile })}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => pickAgain.current?.click()} className={BUTTON_QUIET}>
              {t("upload.resumeChoose")}
            </button>
            <button
              type="button"
              onClick={() => {
                for (const i of items.filter((x) => x.state === "needs_file")) void uploads.cancel(i.key);
              }}
              className={BUTTON_QUIET}
            >
              {t("upload.resumeCancel")}
            </button>
          </div>
        </div>
      )}

      {items.length > 0 && (
        <div className="mt-4">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
            <p role="status" aria-live="polite" className="text-sm">
              {summary}
            </p>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              {failed > 0 && (
                <button type="button" onClick={() => void uploads.retryFailed()} className={LINK}>
                  <RotateCw aria-hidden className="size-3.5" />
                  {t("upload.retryFailed")}
                </button>
              )}
              {cancellable > 0 && (
                <button type="button" onClick={() => void uploads.cancel()} className={LINK}>
                  {t("upload.cancelRest")}
                </button>
              )}
              {finished > 0 && (
                <button type="button" onClick={() => uploads.clearFinished()} className={LINK}>
                  {t("upload.clear")}
                </button>
              )}
            </div>
          </div>

          {sendBytes > 0 && (
            <div
              role="progressbar"
              aria-label={t("upload.sendingBar")}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round((sentBytes / sendBytes) * 100)}
              className="mt-2 h-1 overflow-hidden rounded-full bg-foreground/8"
            >
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-200"
                style={{ width: `${(sentBytes / sendBytes) * 100}%` }}
              />
            </div>
          )}

          <ul className="mt-3 max-h-80 divide-y divide-border overflow-y-auto rounded-lg border border-border">
            {items.map((item) => (
              <FileRow
                key={item.key}
                item={item}
                bytes={bytes}
                onRetry={() => void uploads.retry(item.key)}
                onCancel={() => void uploads.cancel(item.key)}
              />
            ))}
          </ul>
        </div>
      )}

      {dragging && (
        <div
          aria-hidden
          className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-6 backdrop-blur-sm"
        >
          <div className="flex items-center gap-2 rounded-xl border-2 border-dashed border-foreground/40 px-8 py-6 text-base font-semibold">
            <ImagePlus aria-hidden className="size-5" />
            {t("upload.dropHere")}
          </div>
        </div>
      )}
    </section>
  );
}

function FileRow({
  item,
  bytes,
  onRetry,
  onCancel,
}: {
  item: UploadItem;
  bytes: (n: number) => string;
  onRetry: () => void;
  onCancel: () => void;
}) {
  const { t } = useT();
  const Icon = STATE_ICON[item.state];
  const pct = item.size ? Math.floor((item.sent / item.size) * 100) : 0;

  const status =
    item.state === "refused"
      ? t(`upload.problem.${item.problem ?? "type"}`)
      : item.state === "uploading"
        ? t("upload.state.uploading", { n: pct })
        : item.state === "failed"
          ? reason(t, item.error)
          : t(`upload.state.${item.state}`);

  const tone =
    item.state === "failed" || item.state === "refused"
      ? "text-destructive"
      : item.state === "ready"
        ? "text-foreground"
        : "text-muted-foreground";

  const canRetry = item.state === "failed" && !["not_an_image", "type_mismatch", "too_large"].includes(item.error ?? "");
  const canCancel = ["waiting", "uploading", "queued", "paused", "needs_file", "failed"].includes(item.state);

  return (
    <li className="relative flex min-h-10 items-center gap-2.5 px-3 py-2 text-sm">
      <Icon aria-hidden className={`size-4 shrink-0 ${tone} ${SPINS.includes(item.state) ? "animate-spin" : ""}`} />
      <span className="min-w-0 flex-1 truncate" title={item.name}>
        {item.name}
      </span>
      <span className="hidden shrink-0 tabular-nums text-[13px] text-muted-foreground sm:inline">{bytes(item.size)}</span>
      <span className={`max-w-[45%] shrink-0 truncate text-right text-[13px] sm:max-w-[16rem] ${tone}`} title={status}>
        {status}
      </span>
      {canRetry && (
        <button
          type="button"
          onClick={onRetry}
          aria-label={`${t("upload.retry")}: ${item.name}`}
          title={t("upload.retry")}
          className="inline-flex size-7 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-foreground/8 hover:text-foreground"
        >
          <RotateCw aria-hidden className="size-3.5" />
        </button>
      )}
      {canCancel && (
        <button
          type="button"
          onClick={onCancel}
          aria-label={`${t("upload.cancel")}: ${item.name}`}
          title={t("upload.cancel")}
          className="inline-flex size-7 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-foreground/8 hover:text-foreground"
        >
          <X aria-hidden className="size-3.5" />
        </button>
      )}
      {item.state === "uploading" && (
        <span
          aria-hidden
          className="absolute bottom-0 left-0 h-0.5 bg-primary transition-[width] duration-200"
          style={{ width: `${pct}%` }}
        />
      )}
    </li>
  );
}

/** The sentence for a failed file's reason. */
function reason(t: (key: string) => string, error: string | null): string {
  const key = `upload.fileError.${error ?? "internal"}`;
  const text = t(key);
  return text === key ? t("upload.fileError.internal") : text;
}
