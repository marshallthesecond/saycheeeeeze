"use client";

// The two forms on a client gallery's Passkeys tab: who can open it at all,
// and making a new passkey.

import { useActionState } from "react";
import { KeyRound, LockOpen } from "lucide-react";
import { useT } from "@/src/lib/i18n/LanguageProvider";
import { addPasskey, setAccess, type FormState, type PasskeyState } from "@/src/app/studio/gallery-actions";
import type { StudioGalleryDetail } from "@/src/lib/studio/gallery";
import ConfirmButton from "./ConfirmButton";
import { FormMessage } from "./FormFeedback";
import { Secret } from "./NewGalleryForm";
import { BUTTON_PRIMARY, BUTTON_QUIET, FIELD, Field, Section } from "./fields";

export function AccessModeForm({ gallery }: { gallery: StudioGalleryDetail }) {
  const { t } = useT();
  const [state, action, pending] = useActionState<FormState, FormData>(setAccess, {});
  const Icon = gallery.isPrivate ? KeyRound : LockOpen;

  return (
    <Section title={t("access.mode")}>
      <div className="flex items-start gap-3">
        <Icon aria-hidden className={`mt-0.5 size-5 shrink-0 ${gallery.isPrivate ? "" : "text-destructive"}`} />
        <div className="min-w-0">
          <p className="text-[15px] font-semibold">{gallery.isPrivate ? t("access.private") : t("access.public")}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {gallery.isPrivate ? t("access.privateHint") : t("access.publicHint")}
          </p>
        </div>
      </div>

      {/* key: once the mode has changed, the confirm step starts over. */}
      <form action={action} key={String(gallery.isPrivate)} className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <input type="hidden" name="galleryId" value={gallery.id} />
        <input type="hidden" name="to" value={gallery.isPrivate ? "public" : "private"} />
        {gallery.isPrivate ? (
          <ConfirmButton label={t("access.makePublic")} confirmLabel={t("access.makePublicConfirm")} />
        ) : (
          <button type="submit" disabled={pending} className={BUTTON_PRIMARY}>
            {t("access.makePrivate")}
          </button>
        )}
        <FormMessage state={{ error: state.error }} pending={pending} />
      </form>
    </Section>
  );
}

export function NewPasskeyForm({ gallery, url }: { gallery: StudioGalleryDetail; url: string }) {
  const { t } = useT();
  const [state, action, pending] = useActionState<PasskeyState, FormData>(addPasskey, {});
  const v = (name: string) => state.values?.[name] ?? "";

  return (
    <div>
      <h3 className="text-sm font-semibold">{t("access.add")}</h3>
      <form action={action} className="mt-3 grid gap-4 sm:grid-cols-2">
        <input type="hidden" name="galleryId" value={gallery.id} />
        <Field label={t("access.label")}>
          <input
            name="label"
            maxLength={80}
            autoComplete="off"
            defaultValue={v("label")}
            placeholder={t("access.labelPlaceholder")}
            className={FIELD}
          />
        </Field>
        <Field label={t("access.code")} hint={t("access.codeHint")}>
          <input
            name="code"
            maxLength={64}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            placeholder={t("access.codePlaceholder")}
            className={`${FIELD} font-mono placeholder:font-sans`}
          />
        </Field>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 sm:col-span-2">
          <button type="submit" disabled={pending} className={BUTTON_QUIET}>
            {pending ? t("access.creating") : t("access.create")}
          </button>
          <FormMessage state={{ error: state.error }} pending={pending} />
        </div>
      </form>

      {state.created && !pending && (
        <div role="status" className="mt-5 rounded-xl border border-foreground/25 bg-foreground/4 p-4 sm:p-5">
          <p className="text-[15px] font-semibold">{t("access.createdTitle")}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {state.created.label}. {t("access.createdBlurb")}
          </p>
          <Secret code={state.created.code} url={url} />
        </div>
      )}
    </div>
  );
}
