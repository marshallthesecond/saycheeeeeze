"use client";

// Shown when a Studio page fails to load. In production Next hides the real
// message from the browser (it can contain internals) and logs it on the
// server, so this says only what the photographer can act on.

import { startTransition } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/src/lib/i18n/LanguageProvider";

export default function StudioError({
  reset,
  retry,
  unstable_retry,
}: {
  error: Error;
  reset: () => void;
  // Next 16.3 hands the error screen `retry`, 16.2 the same thing under
  // `unstable_retry`, and earlier versions neither. package.json allows all
  // three, so take whichever arrived.
  retry?: () => void;
  unstable_retry?: () => void;
}) {
  const { t } = useT();
  const router = useRouter();

  /**
   * Fetch the page again from the server, THEN clear the error.
   *
   * reset() alone is not enough here. Studio pages fail on the server (the
   * database did not answer), and reset() only re-renders what the browser
   * already holds, which is the failure. It would flash and come straight
   * back.
   */
  const again =
    retry ??
    unstable_retry ??
    (() =>
      startTransition(() => {
        router.refresh();
        reset();
      }));

  return (
    <main className="grid min-h-dvh place-items-center bg-background px-6 text-foreground">
      <div className="max-w-sm text-center">
        <h1 className="text-xl font-semibold">{t("error.title")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("error.blurb")}</p>
        <button
          type="button"
          onClick={() => again()}
          className="mt-6 inline-flex h-10 items-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition hover:bg-primary-hover"
        >
          {t("error.retry")}
        </button>
      </div>
    </main>
  );
}
