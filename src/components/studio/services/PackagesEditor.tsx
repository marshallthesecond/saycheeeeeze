"use client";

// The packages of a service: their names, numbers, features and order, which
// one is the most popular, and which are shown. A package that was ever on the
// site is not removed when deleted, only marked: bookings made with it keep
// its name and price (see `retired` on ServicePackage).

import { ChevronDown, Copy, Eye, EyeOff, RotateCcw, Star, Trash2 } from "lucide-react";
import { useT } from "@/src/lib/i18n/LanguageProvider";
import { formatSom } from "@/src/lib/packages";
import {
  LIMITS,
  newPackageId,
  type ContentGroup,
  type ContentPackage,
  type Lang,
  type Text,
} from "@/src/lib/service-content";
import { formatDelivery, formatDuration, formatPhotoCountShort } from "@/src/lib/service-format";
import { AddButton, LangField, NumberField, RowButtons, TextList, fieldId } from "./parts";

const EMPTY: Text = { en: "", ru: "", uz: "" };

export default function PackagesEditor({
  slug,
  groups,
  grouped,
  lang,
  liveIds,
  notes,
  open,
  onToggle,
  onChange,
}: {
  slug: string;
  groups: ContentGroup[];
  /** Graduation: its groups have a tab name and a text of their own. */
  grouped: boolean;
  lang: Lang;
  /** Ids that were ever on the site: deleting one keeps it, marked. */
  liveIds: ReadonlySet<string>;
  /** The code's short note after the length ("group"), by package id. */
  notes: Record<string, Text>;
  /** Package ids whose fields are open. */
  open: ReadonlySet<string>;
  onToggle: (id: string, open: boolean) => void;
  onChange: (groups: ContentGroup[]) => void;
}) {
  const { t } = useT();
  const taken = new Set(groups.flatMap((g) => g.packages.map((p) => p.id)));

  const setGroup = (gi: number, group: ContentGroup) => onChange(groups.map((g, i) => (i === gi ? group : g)));

  return (
    <div className="grid gap-6">
      {groups.map((group, gi) => {
        const setPackages = (packages: ContentPackage[]) => setGroup(gi, { ...group, packages });
        const shown = group.packages.map((p, pi) => ({ p, pi })).filter(({ p }) => !p.deleted);
        const deleted = group.packages.map((p, pi) => ({ p, pi })).filter(({ p }) => p.deleted);

        const autoTitle = (p: ContentPackage) => {
          const length = p.minutes ? formatDuration(p.minutes, lang) : "";
          const note = notes[p.id]?.[lang];
          return note ? `${length} · ${note}` : length;
        };
        const titleOf = (p: ContentPackage) => p.name[lang].trim() || p.name.en.trim() || autoTitle(p) || t("services.packages.untitled");

        const update = (pi: number, patch: Partial<ContentPackage>) =>
          setPackages(group.packages.map((p, i) => (i === pi ? { ...p, ...patch } : p)));

        /** Swap with the next shown package up or down, past any deleted ones. */
        const moveShown = (k: number, to: number) => {
          if (to < 0 || to >= shown.length) return;
          const a = shown[k].pi;
          const b = shown[to].pi;
          const next = [...group.packages];
          [next[a], next[b]] = [next[b], next[a]];
          setPackages(next);
        };

        const add = () => {
          const last = shown.at(-1)?.p;
          const id = newPackageId(slug, taken);
          setPackages([
            ...group.packages,
            {
              id,
              name: { ...EMPTY },
              description: { ...EMPTY },
              minutes: last?.minutes ?? 60,
              photosMin: last?.photosMin ?? 20,
              photosMax: last?.photosMax ?? null,
              days: last?.days ?? 2,
              price: 0,
              perks: [],
              popular: false,
              hidden: false,
              deleted: false,
            },
          ]);
          onToggle(id, true);
        };

        const duplicate = (pi: number) => {
          const src = group.packages[pi];
          const id = newPackageId(slug, taken);
          const next = [...group.packages];
          next.splice(pi + 1, 0, { ...src, id, popular: false, perks: src.perks.map((x) => ({ ...x })) });
          setPackages(next);
          onToggle(id, true);
        };

        const remove = (pi: number) => {
          const p = group.packages[pi];
          if (liveIds.has(p.id)) update(pi, { deleted: true, popular: false });
          else setPackages(group.packages.filter((_, i) => i !== pi));
        };

        return (
          <div key={group.key} id={fieldId(`groups.${gi}.packages`)} tabIndex={-1} className="grid gap-3 outline-none">
            {grouped && (
              <div className="grid gap-3 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
                <LangField
                  where={`groups.${gi}.title`}
                  label={t("services.packages.groupTitle")}
                  text={group.title}
                  lang={lang}
                  max={LIMITS.groupTitle}
                  onChange={(title) => setGroup(gi, { ...group, title })}
                />
                <LangField
                  where={`groups.${gi}.blurb`}
                  label={t("services.packages.groupBlurb")}
                  text={group.blurb}
                  lang={lang}
                  max={LIMITS.groupBlurb}
                  onChange={(blurb) => setGroup(gi, { ...group, blurb })}
                />
              </div>
            )}

            <ul className="grid gap-2">
              {shown.map(({ p, pi }, k) => {
                const isOpen = open.has(p.id);
                const at = `groups.${gi}.packages.${pi}`;
                const title = titleOf(p);
                return (
                  <li key={p.id} className={`rounded-xl border bg-card ${p.hidden ? "border-dashed border-border" : "border-border"}`}>
                    <div className="flex items-center gap-1 pr-1">
                      <button
                        type="button"
                        aria-expanded={isOpen}
                        aria-controls={`${fieldId(at)}-body`}
                        onClick={() => onToggle(p.id, !isOpen)}
                        className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-3.5 py-2.5 text-left"
                      >
                        <span className="min-w-0 flex-1">
                          <span className={`flex items-center gap-2 ${p.hidden ? "text-muted-foreground" : ""}`}>
                            <span className="truncate text-sm font-semibold">{title}</span>
                            {p.popular && (
                              <Star aria-label={t("services.packages.popular")} className="size-3.5 shrink-0 fill-amber-400 text-amber-400" />
                            )}
                            {p.hidden && (
                              <span className="whitespace-nowrap rounded-md bg-foreground/8 px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                                {t("services.packages.hidden")}
                              </span>
                            )}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {[
                              p.name[lang].trim() || p.name.en.trim() ? formatDuration(p.minutes || 0, lang) : null,
                              p.photosMin ? formatPhotoCountShort({ min: p.photosMin, ...(p.photosMax !== null ? { max: p.photosMax } : {}) }, lang) : null,
                            ]
                              .filter(Boolean)
                              .join(", ")}
                          </span>
                        </span>
                        <span className="shrink-0 whitespace-nowrap text-sm font-semibold tabular-nums">
                          {p.price ? formatSom(p.price, lang) : "—"}
                        </span>
                        <ChevronDown aria-hidden className={`size-4 shrink-0 text-muted-foreground transition ${isOpen ? "rotate-180" : ""}`} />
                      </button>
                      <RowButtons index={k} count={shown.length} what={title} onMove={(to) => moveShown(k, to)} />
                    </div>

                    {isOpen && (
                      <div id={`${fieldId(at)}-body`} className="grid gap-4 border-t border-border px-3.5 pb-4 pt-3.5">
                        <div className="grid gap-4 sm:grid-cols-2">
                          <LangField
                            where={`${at}.name`}
                            label={t("services.packages.name")}
                            text={p.name}
                            lang={lang}
                            max={LIMITS.name}
                            placeholder={p.name.en && lang !== "en" ? p.name.en : autoTitle(p)}
                            hint={t("services.packages.nameHint")}
                            onChange={(name) => update(pi, { name })}
                          />
                          <NumberField
                            where={`${at}.price`}
                            label={t("services.packages.price")}
                            hint={p.price ? formatSom(p.price, lang) : undefined}
                            value={p.price}
                            max={LIMITS.price.max}
                            onChange={(v) => update(pi, { price: v ?? 0 })}
                          />
                        </div>

                        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                          <NumberField
                            where={`${at}.minutes`}
                            label={t("services.packages.minutes")}
                            hint={p.minutes ? formatDuration(p.minutes, lang) : undefined}
                            value={p.minutes}
                            max={LIMITS.minutes.max}
                            onChange={(v) => update(pi, { minutes: v ?? 0 })}
                          />
                          <NumberField
                            where={`${at}.days`}
                            label={t("services.packages.days")}
                            hint={p.days ? formatDelivery({ days: p.days }, lang) : undefined}
                            value={p.days}
                            max={LIMITS.days.max}
                            onChange={(v) => update(pi, { days: v ?? 0 })}
                          />
                          <NumberField
                            where={`${at}.photosMin`}
                            label={t("services.packages.photosMin")}
                            value={p.photosMin}
                            max={LIMITS.photos.max}
                            onChange={(v) => update(pi, { photosMin: v ?? 0 })}
                          />
                          <NumberField
                            where={`${at}.photosMax`}
                            label={t("services.packages.photosMax")}
                            hint={t("services.packages.photosMaxHint")}
                            value={p.photosMax}
                            max={LIMITS.photos.max}
                            allowEmpty
                            onChange={(v) => update(pi, { photosMax: v })}
                          />
                        </div>

                        <LangField
                          where={`${at}.description`}
                          label={t("services.packages.description")}
                          hint={t("services.packages.descriptionHint")}
                          text={p.description}
                          lang={lang}
                          max={LIMITS.packageDescription}
                          multiline
                          rows={2}
                          onChange={(description) => update(pi, { description })}
                        />

                        <div>
                          <p className="mb-1.5 text-sm font-medium">{t("services.packages.perks")}</p>
                          <TextList
                            where={`${at}.perks`}
                            items={p.perks}
                            lang={lang}
                            max={LIMITS.perk}
                            limit={LIMITS.perks}
                            itemLabel={(n) => t("services.packages.perk", { n })}
                            addLabel={t("services.packages.perksAdd")}
                            onChange={(perks) => update(pi, { perks })}
                          />
                        </div>

                        <div className="flex flex-wrap items-center gap-x-1 gap-y-2 border-t border-border pt-3">
                          <Toggle
                            on={p.popular}
                            label={t("services.packages.popular")}
                            icon={<Star aria-hidden className={`size-4 ${p.popular ? "fill-amber-400 text-amber-400" : ""}`} />}
                            onChange={(on) =>
                              setPackages(group.packages.map((x, i) => (i === pi ? { ...x, popular: on } : on ? { ...x, popular: false } : x)))
                            }
                          />
                          <Toggle
                            on={!p.hidden}
                            label={t("services.packages.shown")}
                            icon={p.hidden ? <EyeOff aria-hidden className="size-4" /> : <Eye aria-hidden className="size-4" />}
                            onChange={(on) => update(pi, { hidden: !on })}
                          />
                          <span className="grow" />
                          <button
                            type="button"
                            disabled={shown.length >= LIMITS.packages}
                            onClick={() => duplicate(pi)}
                            className="inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 text-sm font-medium transition hover:bg-foreground/8 disabled:opacity-40"
                          >
                            <Copy aria-hidden className="size-4" />
                            {t("services.packages.duplicate")}
                          </button>
                          <button
                            type="button"
                            onClick={() => remove(pi)}
                            className="inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 text-sm font-medium text-destructive transition hover:bg-destructive/10"
                          >
                            <Trash2 aria-hidden className="size-4" />
                            {t("services.packages.delete")}
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>

            <div className="flex flex-wrap items-center gap-3">
              <AddButton label={t("services.packages.add")} onClick={add} disabled={shown.length >= LIMITS.packages} />
              {shown.length >= LIMITS.packages && (
                <span className="text-xs text-muted-foreground">{t("services.packages.full", { n: LIMITS.packages })}</span>
              )}
            </div>

            {deleted.length > 0 && (
              <details className="rounded-xl border border-dashed border-border px-3.5 py-2.5">
                <summary className="cursor-pointer text-sm font-medium text-muted-foreground">
                  {t("services.packages.deleted", { n: deleted.length })}
                </summary>
                <p className="mt-1.5 text-[13px] text-muted-foreground">{t("services.packages.deletedHint")}</p>
                <ul className="mt-2 grid gap-1">
                  {deleted.map(({ p, pi }) => (
                    <li key={p.id} className="flex items-center justify-between gap-3">
                      <span className="min-w-0 truncate text-sm">
                        {titleOf(p)}
                        <span className="ml-2 text-muted-foreground tabular-nums">{p.price ? formatSom(p.price, lang) : ""}</span>
                      </span>
                      <button
                        type="button"
                        disabled={shown.length >= LIMITS.packages}
                        onClick={() => update(pi, { deleted: false, hidden: true })}
                        className="inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 text-sm font-medium transition hover:bg-foreground/8 disabled:opacity-40"
                      >
                        <RotateCcw aria-hidden className="size-3.5" />
                        {t("services.packages.restore")}
                      </button>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Toggle({
  on,
  label,
  icon,
  onChange,
}: {
  on: boolean;
  label: string;
  icon: React.ReactNode;
  onChange: (on: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={`inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 text-sm font-medium transition ${
        on ? "bg-foreground/8 text-foreground" : "text-muted-foreground hover:bg-foreground/6"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
