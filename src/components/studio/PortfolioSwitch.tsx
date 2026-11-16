"use client";

// The gallery header's switch between a client gallery and a Portfolio album.
//
// A client gallery: "Make public" asks for the category it goes under, then
// it is an album on the Portfolio at once. Nothing is copied: the photos stay
// where they are in storage. The client's old link opens the album.
//
// An album that was a client gallery: "Make private again" (asks once) puts
// it back, with the passkeys it had.

import { useActionState, useState } from "react";
import { CircleAlert } from "lucide-react";
import { setGalleryPublic, type FormState } from "@/src/app/studio/gallery-actions";
import { useT } from "@/src/lib/i18n/LanguageProvider";
import { BUTTON_DANGER, BUTTON_PRIMARY, BUTTON_QUIET } from "./fields";

const FIELD =
  "h-10 w-44 min-w-0 rounded-lg border border-input bg-card px-3 text-sm text-foreground placeholder:text-muted-foreground " +
  "outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40";

export default function PortfolioSwitch({
  galleryId,
  to,
  categories,
}: {
  galleryId: string;
  /** What the button does: "public" for a client gallery, "private" for an album that was one. */
  to: "public" | "private";
  categories: string[];
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<FormState, FormData>(async (prev, form) => {
    const result = await setGalleryPublic(prev, form);
    if (result.ok) setOpen(false);
    return result;
  }, {});

  if (!open) {
    return (
      <>
        <button type="button" className={BUTTON_QUIET} onClick={() => setOpen(true)}>
          {t(to === "public" ? "gallery.makePublic" : "gallery.makePrivate")}
        </button>
        {!pending && state.error && <Problem text={t(`errors.${state.error}`)} />}
      </>
    );
  }

  return (
    <form action={action} className="order-last flex basis-full flex-wrap items-center justify-end gap-2">
      <input type="hidden" name="galleryId" value={galleryId} />
      <input type="hidden" name="to" value={to} />
      {to === "public" && (
        <>
          <input
            name="category"
            required
            maxLength={40}
            list="portfolio-categories"
            defaultValue={categories[0] ?? ""}
            placeholder={t("gallery.photos.category")}
            aria-label={t("gallery.photos.category")}
            className={FIELD}
          />
          <datalist id="portfolio-categories">
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </>
      )}
      <button type="submit" disabled={pending} className={to === "public" ? BUTTON_PRIMARY : BUTTON_DANGER}>
        {t(to === "public" ? "gallery.makePublicConfirm" : "gallery.makePrivateConfirm")}
      </button>
      <button type="button" disabled={pending} className={BUTTON_QUIET} onClick={() => setOpen(false)}>
        {t("common.cancel")}
      </button>
      <p className="basis-full text-right text-xs text-muted-foreground">
        {t(to === "public" ? "gallery.makePublicHint" : "gallery.makePrivateHint")}
      </p>
      {!pending && state.error && <Problem text={t(`errors.${state.error}`)} />}
    </form>
  );
}

function Problem({ text }: { text: string }) {
  return (
    <p role="alert" className="flex basis-full items-start justify-end gap-2 text-sm text-destructive">
      <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span>{text}</span>
    </p>
  );
}
