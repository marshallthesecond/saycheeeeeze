"use client";

// Retry for one failed file on the Uploads screen. The file is built again
// from the worker's copy when it still has one; otherwise it has to be added
// again on the gallery's page, which this says.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RotateCw } from "lucide-react";
import { useT } from "@/src/lib/i18n/LanguageProvider";

type Outcome = "idle" | "busy" | "queued" | "resend" | "error";

export default function RetryUpload({ batchId, uploadId }: { batchId: string; uploadId: string }) {
  const { t } = useT();
  const router = useRouter();
  const [outcome, setOutcome] = useState<Outcome>("idle");
  const [error, setError] = useState<string | null>(null);

  async function retry() {
    setOutcome("busy");
    try {
      const res = await fetch(`/api/studio/uploads/${batchId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "retry", uploadId }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(typeof body?.error === "string" ? body.error : "failed");
        setOutcome("error");
        return;
      }
      setOutcome(body?.status === "waiting" ? "resend" : "queued");
      router.refresh();
    } catch {
      setError("network");
      setOutcome("error");
    }
  }

  if (outcome === "queued") return <span className="text-[13px] text-muted-foreground">{t("uploads.retried")}</span>;
  if (outcome === "resend") return <span className="text-[13px] text-muted-foreground">{t("uploads.resend")}</span>;

  const message = error ? t(`upload.errors.${error}`) : null;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
      <button
        type="button"
        onClick={retry}
        disabled={outcome === "busy"}
        className="inline-flex items-center gap-1 whitespace-nowrap text-[13px] font-medium text-foreground underline-offset-4 hover:underline disabled:opacity-60"
      >
        <RotateCw aria-hidden className={`size-3.5 ${outcome === "busy" ? "animate-spin" : ""}`} />
        {t("uploads.retry")}
      </button>
      {message && (
        <span role="alert" className="text-[13px] text-destructive">
          {message === `upload.errors.${error}` ? t("upload.errors.failed") : message}
        </span>
      )}
    </span>
  );
}
