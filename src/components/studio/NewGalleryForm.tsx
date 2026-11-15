"use client";

// The New gallery form, and what it turns into once a client gallery has been
// created: the one screen where its passkey can be read.

import { startTransition, useActionState, useState, type FormEvent } from "react";
import Link from "next/link";
import { Images, KeyRound } from "lucide-react";
import { useT } from "@/src/lib/i18n/LanguageProvider";
import { createGallery, type CreateState } from "@/src/app/studio/gallery-actions";
import { studioGalleryPath } from "@/src/lib/studio/config";
import { isValidSlug, slugify } from "@/src/lib/studio/slug";
import CopyButton from "./CopyButton";
import { FormMessage } from "./FormFeedback";
import { BUTTON_PRIMARY, FIELD, Field } from "./fields";

type Kind = "album" | "client";

const NEW_CATEGORY = "$new";

export default function NewGalleryForm({
  categories,
  defaultLocation,
  suggestedCode,
  initialKind,
}: {
  categories: string[];
  defaultLocation: string;
  /** Made on the server for this visit to the page. */
  suggestedCode: string;
  initialKind: Kind;
}) {
  const { t } = useT();
  const [state, dispatch, pending] = useActionState<CreateState, FormData>(createGallery, {});

  const [kind, setKind] = useState<Kind>(initialKind);
  const [title, setTitle] = useState("");
  // The address follows the title until it is edited by hand.
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [category, setCategory] = useState(categories[0] ?? NEW_CATEGORY);

  if (state.created) return <Created created={state.created} />;

  const shownSlug = slugTouched ? slug : slugify(title);
  const slugBad = shownSlug.length > 0 && !isValidSlug(shownSlug);

  /**
   * Sent by hand, not through <form action>.
   *
   * React empties a form once its action has run. For this form that is
   * dangerous rather than untidy: a reset puts the radio buttons and the
   * category list back to how they were first drawn, while the state above
   * still says what was chosen. After one refused attempt the screen could
   * show "Client gallery" selected and the next attempt would send "album".
   * Sending the form ourselves means nothing is ever reset, so what is on
   * screen is what is sent.
   */
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => dispatch(data));
  }

  return (
    <form onSubmit={submit} className="grid max-w-2xl gap-6">
      <fieldset>
        <legend className="text-sm font-medium">{t("newGallery.type")}</legend>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          {(
            [
              { id: "album", Icon: Images, label: t("newGallery.album"), hint: t("newGallery.albumHint") },
              { id: "client", Icon: KeyRound, label: t("newGallery.client"), hint: t("newGallery.clientHint") },
            ] as const
          ).map(({ id, Icon, label, hint }) => (
            <label
              key={id}
              className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition ${
                kind === id ? "border-foreground bg-foreground/4" : "border-border hover:border-foreground/40"
              }`}
            >
              <input
                type="radio"
                name="kind"
                value={id}
                checked={kind === id}
                onChange={() => setKind(id)}
                className="mt-1 size-4 shrink-0 accent-[var(--primary)]"
              />
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 text-[15px] font-semibold">
                  <Icon aria-hidden className="size-4 shrink-0" />
                  {label}
                </span>
                <span className="mt-1 block text-[13px] text-muted-foreground">{hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <Field label={t("newGallery.name")}>
        <input
          name="title"
          required
          maxLength={200}
          autoComplete="off"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t("newGallery.namePlaceholder")}
          className={FIELD}
        />
      </Field>

      {/* Not <Field hint>: the input sits inside a wrapper, so the help is
          tied to it by hand. */}
      <div>
        <label className="block text-sm font-medium">
          {t("newGallery.address")}
          <span
            className={`mt-1.5 flex h-11 items-center rounded-lg border bg-card text-[15px] font-normal transition focus-within:ring-3 focus-within:ring-ring/40 ${
              slugBad ? "border-destructive" : "border-input focus-within:border-ring"
            }`}
          >
            <span aria-hidden className="shrink-0 pl-3 text-muted-foreground">
              {kind === "client" ? "/galleries/" : "/albums/"}
            </span>
            <input
              name="slug"
              required
              maxLength={60}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              value={shownSlug}
              onChange={(e) => {
                setSlugTouched(true);
                setSlug(e.target.value.toLowerCase().replace(/\s+/g, "-"));
              }}
              aria-invalid={slugBad || undefined}
              aria-describedby="new-gallery-address-hint"
              className="h-full min-w-0 flex-1 bg-transparent pr-3 text-foreground outline-none"
            />
          </span>
        </label>
        <p id="new-gallery-address-hint" className="mt-1.5 text-[13px] text-muted-foreground">
          {t("newGallery.addressHint")}
        </p>
      </div>

      {kind === "album" && (
        <div className="grid gap-4 sm:grid-cols-2">
          {/* No categories yet: there is nothing to choose from, only a name to give. */}
          {categories.length === 0 && <input type="hidden" name="category" value={NEW_CATEGORY} />}
          {categories.length > 0 && (
            <Field label={t("newGallery.category")} hint={t("newGallery.categoryHint")}>
              <select
                name="category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className={FIELD}
              >
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
                <option value={NEW_CATEGORY}>{t("newGallery.categoryNew")}</option>
              </select>
            </Field>
          )}
          {category === NEW_CATEGORY && (
            <Field
              label={categories.length > 0 ? t("newGallery.categoryName") : t("newGallery.category")}
              hint={
                categories.length > 0
                  ? t("newGallery.categoryNameHint")
                  : `${t("newGallery.categoryHint")} ${t("newGallery.categoryNameHint")}`
              }
            >
              <input
                name="newCategory"
                required
                maxLength={40}
                autoComplete="off"
                placeholder="Portraits"
                className={FIELD}
              />
            </Field>
          )}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("newGallery.dateLabel")}>
          <input
            name="dateLabel"
            maxLength={120}
            autoComplete="off"
            placeholder={t("newGallery.dateLabelPlaceholder")}
            className={FIELD}
          />
        </Field>
        <Field label={t("newGallery.location")}>
          <input
            name="location"
            maxLength={120}
            autoComplete="off"
            defaultValue={defaultLocation}
            className={FIELD}
          />
        </Field>
      </div>

      {kind === "client" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("newGallery.code")} hint={t("newGallery.codeHint")} className="sm:col-span-2">
            <input
              name="code"
              maxLength={64}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              defaultValue={suggestedCode}
              className={`${FIELD} font-mono tracking-wider sm:max-w-xs`}
            />
          </Field>
          <Field label={t("newGallery.codeLabel")}>
            <input
              name="codeLabel"
              maxLength={80}
              autoComplete="off"
              placeholder={t("newGallery.codeLabelPlaceholder")}
              className={FIELD}
            />
          </Field>
        </div>
      )}

      <div>
        <p className="text-sm text-muted-foreground">{t("newGallery.note")}</p>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <button type="submit" disabled={pending} className={BUTTON_PRIMARY}>
            {pending ? t("newGallery.creating") : t("newGallery.create")}
          </button>
          <FormMessage state={{ error: state.error }} pending={pending} />
        </div>
      </div>
    </form>
  );
}

function Created({ created }: { created: NonNullable<CreateState["created"]> }) {
  const { t } = useT();
  return (
    <div className="max-w-2xl rounded-xl border border-border bg-card p-5 sm:p-6">
      <h2 className="text-lg font-semibold leading-snug">{t("newGallery.createdTitle")}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{created.title}</p>
      <p className="mt-4 max-w-prose text-sm">{t("newGallery.createdBlurb")}</p>

      <Secret code={created.code} url={created.url} />

      <p className="mt-4 text-sm text-muted-foreground">{t("newGallery.createdPublish")}</p>
      <Link href={studioGalleryPath(created.slug)} className={`${BUTTON_PRIMARY} mt-4`}>
        {t("newGallery.createdOpen")}
      </Link>
    </div>
  );
}

/** A passkey and the link it opens, each with its own Copy, and one for both. */
export function Secret({ code, url }: { code: string; url: string }) {
  const { t } = useT();
  return (
    <dl className="mt-4 grid gap-3">
      <div>
        <dt className="text-[13px] text-muted-foreground">{t("newGallery.code")}</dt>
        <dd className="mt-1 flex flex-wrap items-center gap-3">
          <code data-passkey className="rounded-lg bg-foreground/6 px-3 py-2 font-mono text-lg tracking-widest">
            {code}
          </code>
          <CopyButton text={code} />
        </dd>
      </div>
      <div>
        <dt className="text-[13px] text-muted-foreground">{t("access.link")}</dt>
        <dd className="mt-1 flex flex-wrap items-center gap-3">
          <span className="min-w-0 break-all text-[15px]">{url}</span>
          <CopyButton text={url} />
        </dd>
      </div>
      <div>
        <CopyButton text={`${url}\n${code}`} label={t("access.copyBoth")} />
      </div>
    </dl>
  );
}
