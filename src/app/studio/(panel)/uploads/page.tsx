// /studio/uploads: the worker, the storage used, the last database copy,
// files of deleted photos still to be removed, and every recent drop of
// files with its failed files and a Retry for each.

import type { Metadata } from "next";
import Link from "next/link";
import { CircleAlert } from "lucide-react";
import { PendingButton } from "@/src/components/studio/FormFeedback";
import RetryUpload from "@/src/components/studio/RetryUpload";
import { retryCleanup } from "@/src/app/studio/gallery-actions";
import { studioGalleryPath } from "@/src/lib/studio/config";
import { formatBytes, formatWhen } from "@/src/lib/studio/format";
import { getStudioDictionary, translator } from "@/src/lib/studio/i18n";
import { getStudioLocale } from "@/src/lib/studio/locale";
import { requireStudio } from "@/src/lib/studio/session";
import {
  getBackupStatus,
  getStorageCleanup,
  getWorkerStatus,
  listFailedUploads,
  listUploadBatches,
  type BackupStatus,
  type FailedUpload,
  type StorageCleanup,
  type UploadBatchView,
  type WorkerStatus,
} from "@/src/lib/studio/uploads";

export async function generateMetadata(): Promise<Metadata> {
  const t = translator(await getStudioDictionary(await getStudioLocale()));
  return { title: t("uploads.title") };
}

const BADGE = "inline-flex items-center rounded-md bg-foreground/8 px-2 py-1 text-xs font-medium leading-none";

export default async function UploadsPage() {
  const session = await requireStudio();
  const locale = await getStudioLocale();
  const t = translator(await getStudioDictionary(locale));

  let batches: UploadBatchView[] = [];
  let failed: FailedUpload[] = [];
  let worker: WorkerStatus | null = null;
  let backup: BackupStatus | null = null;
  let cleanup: StorageCleanup | null = null;
  let unavailable = false;
  try {
    // The copy and the clean-up are null on a database without step 6.
    [batches, worker, backup, cleanup] = await Promise.all([
      listUploadBatches(session, { limit: 30 }),
      getWorkerStatus(),
      getBackupStatus(),
      getStorageCleanup(),
    ]);
    failed = await listFailedUploads(
      session,
      batches.filter((b) => b.failed > 0).map((b) => b.id),
    );
  } catch {
    // The uploads migration is not in the database yet.
    unavailable = true;
  }

  const bytes = (n: number) => formatBytes(n, locale, t);
  const reason = (code: string | null) => {
    const key = `upload.fileError.${code ?? "internal"}`;
    const text = t(key);
    return text === key ? t("upload.fileError.internal") : text;
  };

  return (
    <>
      <h1 className="text-2xl font-semibold leading-tight">{t("uploads.title")}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t("uploads.blurb")}</p>

      {unavailable ? (
        <p role="alert" className="mt-6 flex max-w-prose items-start gap-2 text-sm text-destructive">
          <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          {t("uploads.unavailable")}
        </p>
      ) : (
        <>
          <dl className="mt-6 grid max-w-xl grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2 text-sm">
            <dt className="text-muted-foreground">{t("uploads.worker")}</dt>
            <dd className="min-w-0">
              <span className="inline-flex items-center gap-1.5">
                <span
                  aria-hidden
                  className={`size-2 shrink-0 rounded-full ${worker?.online ? "bg-emerald-500" : "bg-foreground/30"}`}
                />
                {worker?.online
                  ? t("uploads.workerOn", { name: worker.name ?? "" })
                  : [
                      t("uploads.workerOff"),
                      worker?.lastSeenAt
                        ? t("uploads.lastSeen", { when: formatWhen(worker.lastSeenAt, locale) })
                        : t("uploads.never"),
                    ].join(", ")}
              </span>
              {!worker?.online && (
                <span className="mt-1 block text-[13px] text-muted-foreground">
                  {t("uploads.hint")}{" "}
                  <code className="whitespace-nowrap rounded bg-foreground/6 px-1.5 py-0.5">pnpm worker</code>
                </span>
              )}
            </dd>
            <dt className="text-muted-foreground">{t("uploads.storage")}</dt>
            <dd className="tabular-nums">{bytes(session.account.storageUsedBytes)}</dd>
            {cleanup && (cleanup.waiting > 0 || cleanup.failed > 0) && (
              <>
                <dt className="text-muted-foreground">{t("uploads.cleanup")}</dt>
                <dd className="min-w-0">
                  {cleanup.waiting > 0 && (
                    <span className="block">
                      {t(cleanup.waiting === 1 ? "uploads.cleanupWaitingOne" : "uploads.cleanupWaitingMany", {
                        n: cleanup.waiting,
                      })}
                    </span>
                  )}
                  {cleanup.failed > 0 && (
                    <form action={retryCleanup} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                      <span className="text-destructive" title={cleanup.error ?? undefined}>
                        {t(cleanup.failed === 1 ? "uploads.cleanupFailedOne" : "uploads.cleanupFailedMany", {
                          n: cleanup.failed,
                        })}
                      </span>
                      <PendingButton className="whitespace-nowrap text-[13px] font-medium text-foreground underline-offset-4 hover:underline disabled:opacity-60">
                        {t("uploads.cleanupRetry")}
                      </PendingButton>
                    </form>
                  )}
                </dd>
              </>
            )}
            {backup && (
              <>
                <dt className="text-muted-foreground">{t("uploads.copy")}</dt>
                <dd className="min-w-0">
                  <span className="block tabular-nums">
                    {backup.at
                      ? t("uploads.copyAt", { when: formatWhen(backup.at, locale), size: bytes(backup.bytes ?? 0) })
                      : t("uploads.copyNone")}
                  </span>
                  {backup.error && (
                    <span className="mt-0.5 block break-words text-[13px] text-destructive">
                      {t("uploads.copyFailed", { error: backup.error })}
                    </span>
                  )}
                </dd>
              </>
            )}
          </dl>

          {batches.length === 0 ? (
            <p className="mt-10 text-sm text-muted-foreground">{t("uploads.empty")}</p>
          ) : (
            <ul className="mt-8 divide-y divide-border rounded-xl border border-border bg-card">
              {batches.map((b) => {
                const meta = [
                  formatWhen(b.createdAt, locale),
                  t(b.fileCount === 1 ? "uploads.filesOne" : "uploads.filesMany", { n: b.fileCount }),
                  bytes(b.totalBytes),
                  b.ready ? t("uploads.ready", { n: b.ready }) : null,
                  b.failed ? t("uploads.failed", { n: b.failed }) : null,
                  b.skipped ? t("uploads.skipped", { n: b.skipped }) : null,
                  b.cancelled ? t("uploads.cancelled", { n: b.cancelled }) : null,
                ]
                  .filter(Boolean)
                  .join(", ");
                const mine = failed.filter((f) => f.batchId === b.id);
                return (
                  <li key={b.id} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        {b.gallery ? (
                          <Link
                            href={studioGalleryPath(b.gallery.slug)}
                            className="break-words text-sm font-semibold underline-offset-4 hover:underline"
                          >
                            {b.gallery.title}
                          </Link>
                        ) : (
                          <span className="text-sm font-semibold">…</span>
                        )}
                        <p className="mt-0.5 text-[13px] text-muted-foreground">{meta}</p>
                      </div>
                      <span className={`${BADGE} shrink-0`}>{t(`uploads.status.${b.status}`)}</span>
                    </div>

                    {mine.length > 0 && (
                      <div className="mt-2">
                        <p className="text-[13px] font-medium">{t("uploads.failedFiles")}</p>
                        <ul className="mt-1 grid gap-1">
                          {mine.map((f) => (
                            <li key={f.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-sm">
                              <span className="min-w-0 max-w-full truncate" title={f.name}>
                                {f.name}
                              </span>
                              <span className="text-[13px] text-destructive" title={f.errorDetail ?? undefined}>
                                {reason(f.error)}
                              </span>
                              {!["not_an_image", "type_mismatch", "too_large"].includes(f.error ?? "") && (
                                <RetryUpload batchId={b.id} uploadId={f.id} />
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </>
  );
}
