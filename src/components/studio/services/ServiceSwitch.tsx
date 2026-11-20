"use client";

// A service on or off the site. Not part of the draft: it takes effect at once.
// Off: its page answers Not found, it is gone from Home, About and the
// sitemap, and it cannot be booked.

import { useState } from "react";
import { useT } from "@/src/lib/i18n/LanguageProvider";
import { setServiceEnabled } from "@/src/app/studio/service-actions";

export default function ServiceSwitch({
  slug,
  name,
  initial,
  withLabel = false,
  onChanged,
}: {
  slug: string;
  /** The service's name, said with the switch. */
  name: string;
  initial: boolean;
  /** "On the site" beside it, and what off means under it. */
  withLabel?: boolean;
  onChanged?: (on: boolean) => void;
}) {
  const { t } = useT();
  const [on, setOn] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const flip = async () => {
    const next = !on;
    setOn(next);
    setBusy(true);
    setError(null);
    const res = await setServiceEnabled(slug, next);
    setBusy(false);
    if ("error" in res) {
      setOn(!next);
      setError(t(`services.errors.${res.error}`));
      return;
    }
    onChanged?.(next);
  };

  const control = (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={withLabel ? undefined : `${t("services.switch.label")}: ${name}`}
      aria-labelledby={withLabel ? `switch-${slug}` : undefined}
      disabled={busy}
      onClick={flip}
      className={`relative inline-flex h-6 w-10 shrink-0 items-center rounded-full transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-60 ${
        on ? "bg-emerald-500" : "bg-foreground/20"
      }`}
    >
      <span
        aria-hidden
        className={`inline-block size-5 rounded-full bg-white shadow transition-transform ${on ? "translate-x-[18px]" : "translate-x-0.5"}`}
      />
    </button>
  );

  if (!withLabel) {
    return (
      <span className="inline-flex flex-col items-end">
        {control}
        {error && (
          <span role="alert" className="mt-1 text-xs text-destructive">
            {error}
          </span>
        )}
      </span>
    );
  }

  return (
    <div className="flex items-start gap-3">
      {control}
      <div className="min-w-0">
        <p id={`switch-${slug}`} className="text-sm font-medium leading-6">
          {t("services.switch.label")}
        </p>
        <p className="text-[13px] text-muted-foreground">{on ? t("services.switch.onHint") : t("services.switch.offHint")}</p>
        {error && (
          <p role="alert" className="mt-1 text-[13px] text-destructive">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
