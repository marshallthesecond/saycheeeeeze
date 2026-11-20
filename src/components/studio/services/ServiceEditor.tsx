"use client";

// One service in the Studio's Services tab: its cover, texts and packages,
// edited as a draft in three languages and published when all three are
// written.
//
// Every change is saved to the draft by itself, a moment after typing stops.
// Nothing reaches the site until Publish, which is refused while anything is
// missing: the list of what is missing takes you to each field. The on/off
// switch and the photos on the page are not part of the draft; they are live
// at once.

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CircleAlert, ExternalLink, Eye } from "lucide-react";
import { useT } from "@/src/lib/i18n/LanguageProvider";
import {
  LANGS,
  LIMITS,
  SEARCH_DESCRIPTION,
  publishProblems,
  type Lang,
  type Problem,
  type ServiceContent,
  type Text,
} from "@/src/lib/service-content";
import { formatDuration } from "@/src/lib/service-format";
import { SITE_URL, titleInCity } from "@/src/lib/seo";
import { STUDIO_SERVICES } from "@/src/lib/studio/config";
import type { ServicePhoto } from "@/src/lib/studio/services";
import { discardServiceDraft, publishService, saveServiceDraft } from "@/src/app/studio/service-actions";
import { BUTTON_DANGER, BUTTON_PRIMARY, BUTTON_QUIET, Section } from "../fields";
import CoverEditor from "./CoverEditor";
import PackagesEditor from "./PackagesEditor";
import RailEditor from "./RailEditor";
import ServiceSwitch from "./ServiceSwitch";
import { AddButton, LangField, RowButtons, TextList, fieldId, move, setAt } from "./parts";

type SaveState = "saved" | "dirty" | "saving" | "error" | "conflict";

export interface ServiceEditorProps {
  slug: string;
  /** Graduation: packages in groups with a tab name and a text each. */
  grouped: boolean;
  content: ServiceContent;
  rev: number;
  /** There are unpublished changes in the database. */
  hasDraft: boolean;
  enabled: boolean;
  coverPhoto?: ServicePhoto;
  /** The page's photos, or "missing" before the placements migration. */
  rail: ServicePhoto[] | "missing";
  /** How many of them the page shows. */
  railShows: number;
  /** Package ids that were ever on the site. */
  liveIds: string[];
  /** The code's short note after a package's length, by id. */
  notes: Record<string, Text>;
}

const SAVE_AFTER_MS = 800;

export default function ServiceEditor(props: ServiceEditorProps) {
  const { slug, grouped } = props;
  const { t, locale } = useT();
  const ui: Lang = (LANGS as readonly string[]).includes(locale) ? (locale as Lang) : "en";

  const [content, setContent] = useState(props.content);
  const [hasDraft, setHasDraft] = useState(props.hasDraft);
  const [enabled, setEnabled] = useState(props.enabled);
  const [save, setSave] = useState<SaveState>("saved");
  const [lang, setLang] = useState<Lang>(ui);
  const [busy, setBusy] = useState<null | "publish" | "discard">(null);
  const [armed, setArmed] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [showProblems, setShowProblems] = useState(false);
  const [serverProblems, setServerProblems] = useState<Problem[]>([]);
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());

  // The saving machinery lives in refs: it runs from timers and clicks, never
  // during render.
  const latest = useRef(props.content);
  const saved = useRef(JSON.stringify(props.content));
  const rev = useRef(props.rev);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const chain = useRef<Promise<boolean>>(Promise.resolve(true));
  const blocked = useRef(false);
  const pending = useRef(false);

  /** Saves the latest content if it differs from what was saved. One save at a time. */
  const saveNow = (): Promise<boolean> => {
    clearTimeout(timer.current);
    const run = chain.current.then(async () => {
      if (blocked.current) return false;
      const snapshot = latest.current;
      const json = JSON.stringify(snapshot);
      if (json === saved.current) return true;
      setSave("saving");
      try {
        const res = await saveServiceDraft(slug, rev.current, snapshot);
        if (res.ok) {
          rev.current = res.rev;
          saved.current = json;
          setHasDraft(true);
          const caughtUp = JSON.stringify(latest.current) === json;
          pending.current = !caughtUp;
          setSave(caughtUp ? "saved" : "dirty");
          return true;
        }
        if (res.error === "conflict") blocked.current = true;
        setSave(res.error === "conflict" ? "conflict" : "error");
        setNotice({ ok: false, text: t(`services.errors.${res.error}`) });
        return false;
      } catch {
        setSave("error");
        return false;
      }
    });
    chain.current = run.catch(() => false);
    return run;
  };

  const change = (next: ServiceContent) => {
    latest.current = next;
    pending.current = true;
    setContent(next);
    setNotice(null);
    setServerProblems([]);
    if (blocked.current) return;
    setSave("dirty");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void saveNow(), SAVE_AFTER_MS);
  };
  const edit = (path: string, value: unknown) => change(setAt(latest.current, path, value));

  // Leaving with a change not saved yet asks first.
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (pending.current && !blocked.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);

  const problems = useMemo(
    () => [...publishProblems(content, grouped), ...serverProblems],
    [content, grouped, serverProblems],
  );
  const missingIn = (l: Lang) => problems.filter((p) => p.lang === l).length;
  const unpublished = hasDraft || save !== "saved";

  // ---------------------------------------------------------------- actions

  const publish = async () => {
    setBusy("publish");
    setNotice(null);
    const ok = await saveNow();
    if (!ok) {
      setBusy(null);
      return;
    }
    const res = await publishService(slug, rev.current).catch(() => ({ error: "failed" }) as const);
    setBusy(null);
    if ("ok" in res && res.ok) {
      rev.current = res.rev;
      setHasDraft(false);
      setShowProblems(false);
      setNotice({ ok: true, text: t("services.actions.published") });
      return;
    }
    const error = "error" in res ? res.error : "failed";
    if (error === "conflict") {
      blocked.current = true;
      setSave("conflict");
    }
    if ("problems" in res && res.problems) {
      setServerProblems(res.problems.filter((p) => p.code === "cover"));
      setShowProblems(true);
    }
    setNotice({ ok: false, text: t(`services.errors.${error}`) });
  };

  const discard = async () => {
    setBusy("discard");
    clearTimeout(timer.current);
    await chain.current;
    const res = await discardServiceDraft(slug, rev.current).catch(() => ({ error: "failed" }) as const);
    setBusy(null);
    setArmed(false);
    if ("ok" in res && res.ok) {
      rev.current = res.rev;
      latest.current = res.content;
      saved.current = JSON.stringify(res.content);
      pending.current = false;
      setContent(res.content);
      setHasDraft(false);
      setSave("saved");
      setServerProblems([]);
      setNotice({ ok: true, text: t("services.actions.discarded") });
      return;
    }
    const error = "error" in res ? res.error : "failed";
    if (error === "conflict") {
      blocked.current = true;
      setSave("conflict");
    }
    setNotice({ ok: false, text: t(`services.errors.${error}`) });
  };

  const preview = async () => {
    // Opened now, while this is still the click: a window opened after the
    // save would be stopped as a pop-up.
    const win = window.open("", "_blank");
    await saveNow();
    const url = `/api/studio/preview?slug=${encodeURIComponent(slug)}`;
    if (win) win.location.href = url;
    else window.location.href = url;
  };

  // ---------------------------------------------------------------- problems

  const labelOf = (where: string): string => {
    const [head, a, b, c, d, e] = where.split(".");
    const n = (x: string | undefined) => Number(x) + 1;
    switch (head) {
      case "cover":
        return t("services.cover.title");
      case "title":
        return t("services.texts.name");
      case "tagline":
        return t("services.texts.tagline");
      case "description":
        return t("services.texts.description");
      case "includes":
        return a === undefined ? t("services.includes.title") : t("services.includes.item", { n: n(a) });
      case "prepare":
        return a === undefined ? t("services.prepare.title") : t("services.prepare.item", { n: n(a) });
      case "faqs":
        return t(b === "q" ? "services.faqs.question" : "services.faqs.answer", { n: n(a) });
      case "groups": {
        if (b === "title") return t("services.packages.groupTitle");
        if (b === "blurb") return t("services.packages.groupBlurb");
        const p = c === undefined ? undefined : content.groups[Number(a)]?.packages[Number(c)];
        if (!p) return t("services.packages.title");
        const name = p.name[ui].trim() || p.name.en.trim() || (p.minutes ? formatDuration(p.minutes, ui) : t("services.packages.untitled"));
        const field = d === "perks" ? t("services.packages.perk", { n: n(e) }) : t(`services.packages.${d}`);
        return `${name}: ${field}`;
      }
      default:
        return where;
    }
  };

  const problemText = (p: Problem): string => {
    const field = labelOf(p.where);
    switch (p.code) {
      case "missing":
        return t("services.problems.missing", { field, lang: (p.lang ?? "").toUpperCase() });
      case "empty":
        return t("services.problems.empty", { field });
      case "noPackages":
        return t("services.problems.noPackages");
      case "invalid":
        return t("services.problems.invalid", { field });
      case "cover":
        return t("services.problems.cover");
    }
  };

  const jump = (p: Problem) => {
    if (p.lang) setLang(p.lang);
    const m = /^groups\.(\d+)\.packages\.(\d+)/.exec(p.where);
    const id = m ? content.groups[Number(m[1])]?.packages[Number(m[2])]?.id : undefined;
    if (id) setOpen((o) => new Set(o).add(id));
    // After the language and the package have rendered.
    setTimeout(() => {
      const el = document.getElementById(fieldId(p.where));
      el?.scrollIntoView({ block: "center", behavior: "smooth" });
      el?.focus({ preventScroll: true });
    }, 60);
  };

  // ---------------------------------------------------------------- render

  const name = content.title[ui].trim() || content.title.en.trim() || slug;
  const searchTitle = `${titleInCity(content.title[lang].trim() || content.title.en, lang)} · saycheeeeeze`;
  const searchText = content.description[lang].trim() || content.description.en;
  const host = SITE_URL.replace(/^https?:\/\//, "").replace(/\/$/, "");

  const statusText =
    save === "conflict"
      ? t("services.status.conflict")
      : save === "error"
        ? t("services.status.error")
        : save === "saving" || save === "dirty"
          ? t("services.status.saving")
          : hasDraft
            ? t("services.status.saved")
            : t("services.status.upToDate");

  return (
    // min-w-0 on every grid's children: one long unbroken line (the Google
    // preview, a URL) must not widen the column past a phone's screen.
    <div className="mx-auto max-w-3xl [&_.grid>*]:min-w-0">
      <Link
        href={STUDIO_SERVICES}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        <ArrowLeft aria-hidden className="size-4" />
        {t("services.back")}
      </Link>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <h1 className="min-w-0 text-2xl font-semibold leading-tight">{name}</h1>
        {enabled && (
          <a
            href={`/${ui}/services/${slug}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 whitespace-nowrap text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            {t("services.openPage")}
            <ExternalLink aria-hidden className="size-3.5" />
          </a>
        )}
      </div>

      <div className="mt-4">
        <ServiceSwitch slug={slug} name={name} initial={props.enabled} withLabel onChanged={setEnabled} />
      </div>

      {/* The language being edited. Numbers, switches and photos are the same in all three. */}
      <div className="sticky top-12 z-20 -mx-4 mt-5 border-b border-border bg-background/95 px-4 py-2 backdrop-blur sm:-mx-8 sm:px-8 lg:top-0 lg:mx-0 lg:px-0">
        <div role="group" aria-label={t("services.lang.label")} className="flex items-center gap-1.5">
          {LANGS.map((l) => {
            const missing = missingIn(l);
            return (
              <button
                key={l}
                type="button"
                aria-pressed={lang === l}
                onClick={() => setLang(l)}
                className={`inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-[13px] font-semibold transition ${
                  lang === l ? "bg-foreground text-background" : "bg-foreground/6 text-foreground hover:bg-foreground/12"
                }`}
              >
                {l.toUpperCase()}
                {missing > 0 && (
                  <span
                    className={`rounded-full px-1.5 text-[11px] tabular-nums ${lang === l ? "bg-background/20" : "bg-amber-500/20 text-amber-300"}`}
                    title={t("services.lang.missing", { n: missing })}
                  >
                    {missing}
                    <span className="sr-only"> {t("services.lang.missing", { n: missing })}</span>
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-5 grid gap-5">
        <Section title={t("services.cover.title")}>
          <CoverEditor cover={content.cover} photo={props.coverPhoto} onChange={(cover) => edit("cover", cover)} />
        </Section>

        <Section title={t("services.texts.title")}>
          <div className="grid gap-4">
            <LangField where="title" label={t("services.texts.name")} text={content.title} lang={lang} max={LIMITS.title} onChange={(v) => edit("title", v)} />
            <LangField
              where="tagline"
              label={t("services.texts.tagline")}
              hint={t("services.texts.taglineHint")}
              text={content.tagline}
              lang={lang}
              max={LIMITS.tagline}
              onChange={(v) => edit("tagline", v)}
            />
            <LangField
              where="description"
              label={t("services.texts.description")}
              hint={t("services.texts.descriptionHint", { n: SEARCH_DESCRIPTION })}
              text={content.description}
              lang={lang}
              max={LIMITS.description}
              guide={SEARCH_DESCRIPTION}
              multiline
              rows={4}
              onChange={(v) => edit("description", v)}
            />
            <div>
              <p className="text-sm font-medium">{t("services.texts.google")}</p>
              <div className="mt-1.5 rounded-lg border border-border bg-background px-3.5 py-3">
                <p className="truncate text-xs text-muted-foreground">
                  {host} › {lang} › services › {slug}
                </p>
                <p className="mt-0.5 truncate text-[17px] leading-snug text-[#99c3ff]">{searchTitle}</p>
                <p className="mt-0.5 line-clamp-2 text-[13px] leading-snug text-foreground/75">
                  {searchText.length > SEARCH_DESCRIPTION ? `${searchText.slice(0, SEARCH_DESCRIPTION).trimEnd()}…` : searchText}
                </p>
              </div>
            </div>
          </div>
        </Section>

        <Section title={t("services.includes.title")}>
          <TextList
            where="includes"
            items={content.includes}
            lang={lang}
            max={LIMITS.item}
            limit={LIMITS.includes}
            itemLabel={(n) => t("services.includes.item", { n })}
            addLabel={t("services.includes.add")}
            onChange={(v) => edit("includes", v)}
          />
        </Section>

        <Section title={t("services.prepare.title")}>
          <TextList
            where="prepare"
            items={content.prepare}
            lang={lang}
            max={LIMITS.item}
            limit={LIMITS.prepare}
            itemLabel={(n) => t("services.prepare.item", { n })}
            addLabel={t("services.prepare.add")}
            onChange={(v) => edit("prepare", v)}
          />
        </Section>

        <Section title={t("services.packages.title")} blurb={t("services.packages.blurb")}>
          <PackagesEditor
            slug={slug}
            groups={content.groups}
            grouped={grouped}
            lang={lang}
            liveIds={new Set(props.liveIds)}
            notes={props.notes}
            open={open}
            onToggle={(id, on) =>
              setOpen((o) => {
                const next = new Set(o);
                if (on) next.add(id);
                else next.delete(id);
                return next;
              })
            }
            onChange={(groups) => edit("groups", groups)}
          />
        </Section>

        <Section title={t("services.faqs.title")}>
          <ul className="grid gap-4">
            {content.faqs.map((f, i) => (
              <li key={i} className="grid gap-2 rounded-lg border border-border p-3">
                <div className="flex items-start gap-1">
                  <div className="min-w-0 flex-1">
                    <LangField
                      where={`faqs.${i}.q`}
                      label={t("services.faqs.question", { n: i + 1 })}
                      text={f.q}
                      lang={lang}
                      max={LIMITS.question}
                      onChange={(v) => edit(`faqs.${i}.q`, v)}
                    />
                  </div>
                  <div className="pt-6">
                    <RowButtons
                      index={i}
                      count={content.faqs.length}
                      what={t("services.faqs.question", { n: i + 1 })}
                      onMove={(to) => edit("faqs", move(content.faqs, i, to))}
                      onRemove={() => edit("faqs", content.faqs.filter((_, k) => k !== i))}
                    />
                  </div>
                </div>
                <LangField
                  where={`faqs.${i}.a`}
                  label={t("services.faqs.answer", { n: i + 1 })}
                  text={f.a}
                  lang={lang}
                  max={LIMITS.answer}
                  multiline
                  rows={3}
                  onChange={(v) => edit(`faqs.${i}.a`, v)}
                />
              </li>
            ))}
          </ul>
          <div className="mt-2">
            <AddButton
              label={t("services.faqs.add")}
              disabled={content.faqs.length >= LIMITS.faqs}
              onClick={() =>
                edit("faqs", [...content.faqs, { q: { en: "", ru: "", uz: "" }, a: { en: "", ru: "", uz: "" } }])
              }
            />
          </div>
        </Section>

        <Section title={t("services.rail.title")} blurb={t("services.rail.hint")}>
          {props.rail === "missing" ? (
            <p className="text-sm text-muted-foreground">{t("services.rail.notSetUp")}</p>
          ) : (
            <RailEditor slug={slug} initial={props.rail} shows={props.railShows} />
          )}
        </Section>
      </div>

      {/* Publishing: always in reach at the bottom of the screen. */}
      <div className="sticky bottom-0 z-20 -mx-4 mt-6 border-t border-border bg-background/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur sm:-mx-8 sm:px-8 lg:mx-0 lg:px-0">
        {showProblems && problems.length > 0 && (
          <ul className="mb-3 grid max-h-48 gap-0.5 overflow-y-auto">
            {problems.map((p, i) => (
              <li key={`${p.where}-${p.lang ?? ""}-${i}`}>
                <button
                  type="button"
                  onClick={() => jump(p)}
                  className="w-full truncate rounded-md px-2 py-1 text-left text-[13px] text-foreground/85 underline-offset-4 hover:bg-foreground/6 hover:underline"
                >
                  {problemText(p)}
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="min-w-0 flex-1 basis-56" aria-live="polite">
            <p className={`text-[13px] ${notice ? (notice.ok ? "text-emerald-400" : "text-destructive") : "text-muted-foreground"}`}>
              {notice ? notice.text : statusText}
              {save === "conflict" && (
                <button type="button" onClick={() => window.location.reload()} className="ml-2 whitespace-nowrap font-medium text-foreground underline underline-offset-4">
                  {t("services.actions.reload")}
                </button>
              )}
            </p>
            {problems.length > 0 && (
              <button
                type="button"
                aria-expanded={showProblems}
                onClick={() => setShowProblems((s) => !s)}
                className="mt-0.5 inline-flex items-center gap-1 whitespace-nowrap text-[13px] font-medium text-amber-300 underline-offset-4 hover:underline"
              >
                <CircleAlert aria-hidden className="size-3.5" />
                {problems.length === 1 ? t("services.toFinishOne") : t("services.toFinish", { n: problems.length })}
              </button>
            )}
          </div>

          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
            <button type="button" onClick={preview} className={BUTTON_QUIET} aria-label={t("services.actions.preview")} title={t("services.actions.preview")}>
              <Eye aria-hidden className="size-4" />
              <span className="hidden sm:inline">{t("services.actions.preview")}</span>
            </button>
            {unpublished &&
              (armed ? (
                <>
                  <button type="button" disabled={busy !== null} onClick={discard} className={BUTTON_DANGER}>
                    {t("services.actions.discardConfirm")}
                  </button>
                  <button type="button" disabled={busy !== null} onClick={() => setArmed(false)} className={BUTTON_QUIET}>
                    {t("common.cancel")}
                  </button>
                </>
              ) : (
                <button type="button" disabled={busy !== null || save === "conflict"} onClick={() => setArmed(true)} className={BUTTON_QUIET}>
                  {t("services.actions.discard")}
                </button>
              ))}
            <button
              type="button"
              disabled={busy !== null || !unpublished || save === "conflict" || problems.length > 0}
              onClick={publish}
              className={BUTTON_PRIMARY}
            >
              {busy === "publish" ? t("services.actions.publishing") : t("services.actions.publish")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
