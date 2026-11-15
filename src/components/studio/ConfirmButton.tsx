"use client";

// A button that asks once before it submits its form. The first click only
// swaps it for "Yes, ..." and "Cancel"; nothing is sent until the second.
// For the things that cannot be taken back: turning a passkey off, opening a
// private gallery, deleting.

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { useT } from "@/src/lib/i18n/LanguageProvider";
import { BUTTON_DANGER, BUTTON_QUIET } from "./fields";

export default function ConfirmButton({
  label,
  confirmLabel,
  className = BUTTON_QUIET,
}: {
  label: string;
  confirmLabel: string;
  /** Classes for the first, unarmed button. */
  className?: string;
}) {
  const { t } = useT();
  const { pending } = useFormStatus();
  const [armed, setArmed] = useState(false);

  if (!armed) {
    return (
      <button type="button" onClick={() => setArmed(true)} className={className}>
        {label}
      </button>
    );
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button type="submit" disabled={pending} className={BUTTON_DANGER}>
        {confirmLabel}
      </button>
      <button type="button" disabled={pending} onClick={() => setArmed(false)} className={BUTTON_QUIET}>
        {t("common.cancel")}
      </button>
    </span>
  );
}
