"use client";

// What a Studio form says back: the button while it works, and one line for
// "Saved" or for what went wrong.

import { useFormStatus } from "react-dom";
import { Check, CircleAlert } from "lucide-react";
import { useT } from "@/src/lib/i18n/LanguageProvider";
import type { FormState } from "@/src/app/studio/gallery-actions";
import { BUTTON_PRIMARY } from "./fields";

/**
 * Always in the tree, so a screen reader announces the text when it appears.
 * An icon as well as a colour, as everywhere else on the site.
 */
export function FormMessage({ state, pending }: { state: FormState; pending: boolean }) {
  const { t } = useT();
  return (
    <p role={state.error ? "alert" : "status"} className="min-h-5 text-sm">
      {!pending && state.error && (
        <span className="flex items-start gap-2 text-destructive">
          <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span>{t(`errors.${state.error}`)}</span>
        </span>
      )}
      {!pending && state.ok && !state.error && (
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <Check aria-hidden className="size-4 shrink-0" />
          {t("common.saved")}
        </span>
      )}
    </p>
  );
}

/** Save button and message on one line, for forms driven by useActionState. */
export function SaveRow({
  state,
  pending,
  label,
  pendingLabel,
}: {
  state: FormState;
  pending: boolean;
  label?: string;
  pendingLabel?: string;
}) {
  const { t } = useT();
  return (
    <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2">
      <button type="submit" disabled={pending} className={BUTTON_PRIMARY}>
        {pending ? (pendingLabel ?? t("common.saving")) : (label ?? t("common.save"))}
      </button>
      <FormMessage state={state} pending={pending} />
    </div>
  );
}

/**
 * A submit button for a plain <form action={...}>, greyed out while the
 * action runs so a second click cannot send it twice.
 */
export function PendingButton({
  children,
  className,
  name,
  value,
}: {
  children: React.ReactNode;
  className: string;
  name?: string;
  value?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" name={name} value={value} disabled={pending} className={className}>
      {children}
    </button>
  );
}
