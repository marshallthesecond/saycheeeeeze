"use client";

// The forms on a gallery's Settings tab. Each block saves on its own, so a
// mistake in one does not hold back the others.

import { useActionState } from "react";
import { useT } from "@/src/lib/i18n/LanguageProvider";
import {
  deleteGallery,
  saveDetails,
  saveDownloads,
  savePublishing,
  type FormState,
} from "@/src/app/studio/gallery-actions";
import type { StudioGalleryDetail } from "@/src/lib/studio/gallery";
import ConfirmButton from "./ConfirmButton";
import { FormMessage, SaveRow } from "./FormFeedback";
import { BUTTON_DANGER, Check, FIELD, Field, Section, TEXTAREA } from "./fields";

export function DetailsForm({ gallery }: { gallery: StudioGalleryDetail }) {
  const { t } = useT();
  const [state, action, pending] = useActionState<FormState, FormData>(saveDetails, {});
  // After a refusal the form shows what was typed; otherwise what is saved.
  const v = (name: string, saved: string) => state.values?.[name] ?? saved;
  const client = gallery.kind === "client";

  return (
    <Section title={t("settings.details")}>
      <form action={action}>
        <input type="hidden" name="galleryId" value={gallery.id} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("settings.title")} className="sm:col-span-2">
            <input name="title" required maxLength={200} defaultValue={v("title", gallery.title)} className={FIELD} />
          </Field>
          <Field label={t("settings.dateLabel")} hint={t("settings.dateLabelHint")}>
            <input name="dateLabel" maxLength={120} defaultValue={v("dateLabel", gallery.dateLabel)} className={FIELD} />
          </Field>
          <Field label={t("settings.location")}>
            <input name="location" maxLength={120} defaultValue={v("location", gallery.location)} className={FIELD} />
          </Field>
          <Field label={t("settings.year")}>
            <input name="year" maxLength={20} inputMode="numeric" defaultValue={v("year", gallery.year)} className={FIELD} />
          </Field>
          <Field label={t("settings.accent")} hint={t("settings.accentHint")}>
            <input
              name="accent"
              type="color"
              defaultValue={v("accent", gallery.accent)}
              className="mt-1.5 block h-11 w-20 cursor-pointer rounded-lg border border-input bg-card p-1"
            />
          </Field>
          <Field label={t("settings.description")} className="sm:col-span-2">
            <textarea
              name="description"
              maxLength={4000}
              rows={3}
              defaultValue={v("description", gallery.description)}
              className={TEXTAREA}
            />
          </Field>

          {client && (
            <>
              <Field label={t("settings.clientNote")} hint={t("settings.clientNoteHint")} className="sm:col-span-2">
                <textarea
                  name="clientNote"
                  maxLength={4000}
                  rows={3}
                  defaultValue={v("clientNote", gallery.clientNote)}
                  className={TEXTAREA}
                />
              </Field>
              <Field label={t("settings.listLabel")} hint={t("settings.listLabelHint")}>
                <input name="listLabel" maxLength={120} defaultValue={v("listLabel", gallery.listLabel)} className={FIELD} />
              </Field>
              <Field label={t("settings.closesOn")} hint={t("settings.closesOnHint")}>
                <input name="closesOn" type="date" defaultValue={v("closesOn", gallery.closesOn)} className={FIELD} />
              </Field>
            </>
          )}
        </div>
        <SaveRow state={state} pending={pending} />
      </form>
    </Section>
  );
}

export function PublishingForm({ gallery }: { gallery: StudioGalleryDetail }) {
  const { t } = useT();
  const [state, action, pending] = useActionState<FormState, FormData>(savePublishing, {});

  return (
    <Section title={t("settings.publishing")}>
      {/* key: the header's Publish button changes the same value, and a
          checkbox only reads defaultChecked when it is first drawn. */}
      <form action={action} key={`${gallery.isPublished}-${gallery.isListed}`}>
        <input type="hidden" name="galleryId" value={gallery.id} />
        <div className="grid gap-4">
          <Check
            name="published"
            label={t("settings.published")}
            hint={t("settings.publishedHint")}
            defaultChecked={gallery.isPublished}
          />
          {gallery.kind === "client" && (
            <Check
              name="listed"
              label={t("settings.listed")}
              hint={t("settings.listedHint")}
              defaultChecked={gallery.isListed}
            />
          )}
        </div>
        <SaveRow state={state} pending={pending} />
      </form>
    </Section>
  );
}

export function DownloadsForm({ gallery }: { gallery: StudioGalleryDetail }) {
  const { t } = useT();
  const [state, action, pending] = useActionState<FormState, FormData>(saveDownloads, {});
  const has = (tier: "share" | "full" | "original") => gallery.downloadTiers.includes(tier);

  return (
    <Section title={t("settings.downloads")}>
      <form action={action} key={`${gallery.downloadEnabled}-${gallery.downloadTiers.join()}`}>
        <input type="hidden" name="galleryId" value={gallery.id} />
        <Check name="enabled" label={t("settings.downloadsEnabled")} defaultChecked={gallery.downloadEnabled} />
        <fieldset className="mt-5">
          <legend className="text-sm font-medium">{t("settings.sizes")}</legend>
          <div className="mt-3 grid gap-3">
            <Check name="tier-share" label={t("settings.tierShare")} hint={t("settings.tierShareHint")} defaultChecked={has("share")} />
            <Check name="tier-full" label={t("settings.tierFull")} hint={t("settings.tierFullHint")} defaultChecked={has("full")} />
            <Check
              name="tier-original"
              label={t("settings.tierOriginal")}
              hint={t("settings.tierOriginalHint")}
              defaultChecked={has("original")}
            />
          </div>
        </fieldset>
        <SaveRow state={state} pending={pending} />
      </form>
    </Section>
  );
}

export function DeleteForm({ gallery }: { gallery: StudioGalleryDetail }) {
  const { t } = useT();
  const [state, action, pending] = useActionState<FormState, FormData>(deleteGallery, {});

  if (gallery.photoCount > 0) {
    return (
      <Section title={t("settings.delete")}>
        <p className="max-w-prose text-sm text-muted-foreground">{t("settings.deleteBlocked")}</p>
      </Section>
    );
  }

  return (
    <Section title={t("settings.delete")} blurb={t("settings.deleteBlurb")}>
      <form action={action} className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <input type="hidden" name="galleryId" value={gallery.id} />
        <ConfirmButton label={t("settings.delete")} confirmLabel={t("settings.deleteConfirm")} className={BUTTON_DANGER} />
        <FormMessage state={{ error: state.error }} pending={pending} />
      </form>
    </Section>
  );
}
