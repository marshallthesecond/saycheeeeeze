"use client";

// Small pieces the Services editor is built from: reading and writing a field
// by its path, a text in the language being edited, a list of texts, and the
// buttons that move a row.

import { useId } from "react";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import { useT } from "@/src/lib/i18n/LanguageProvider";
import type { Lang, Text } from "@/src/lib/service-content";
import { FIELD, TEXTAREA } from "../fields";

// ---------------------------------------------------------------------------
// Paths: "groups.0.packages.1.name" into the content and back
// ---------------------------------------------------------------------------

export function getAt(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const key of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

/** A copy of obj with the value at path replaced. Only the objects on the path are copied. */
export function setAt<T>(obj: T, path: string, value: unknown): T {
  const [head, ...rest] = path.split(".");
  const isArray = Array.isArray(obj);
  const copy = (isArray ? [...(obj as unknown[])] : { ...(obj as Record<string, unknown>) }) as Record<string, unknown>;
  copy[head] = rest.length === 0 ? value : setAt(copy[head], rest.join("."), value);
  return copy as T;
}

/** The id of a field's input, so a problem in the list can take you to it. */
export function fieldId(where: string): string {
  return `f-${where.replace(/\./g, "-")}`;
}

export function move<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

// ---------------------------------------------------------------------------
// A text in the language being edited
// ---------------------------------------------------------------------------

export function LangField({
  where,
  label,
  hint,
  text,
  lang,
  max,
  multiline = false,
  rows = 3,
  placeholder,
  guide,
  onChange,
}: {
  /** Its path in the content; also its id. */
  where: string;
  label: string;
  hint?: string;
  text: Text;
  lang: Lang;
  max: number;
  multiline?: boolean;
  rows?: number;
  /** Shown while this language is empty. Defaults to the English. */
  placeholder?: string;
  /** A length to count against, shown as "120 / 160". */
  guide?: number;
  onChange: (text: Text) => void;
}) {
  const hintId = useId();
  const value = text[lang];
  const shown = placeholder ?? (lang !== "en" ? text.en : undefined);
  const count = guide ?? (value.length > max * 0.8 ? max : undefined);
  const props = {
    id: fieldId(where),
    value,
    maxLength: max,
    placeholder: shown,
    lang,
    "aria-describedby": hint ? hintId : undefined,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange({ ...text, [lang]: e.target.value }),
  };

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={props.id} className="text-sm font-medium">
          {label}
        </label>
        {count !== undefined && (
          <span className={`text-xs tabular-nums ${value.length > count ? "text-amber-500" : "text-muted-foreground"}`}>
            {value.length} / {count}
          </span>
        )}
      </div>
      {multiline ? <textarea {...props} rows={rows} className={TEXTAREA} /> : <input {...props} className={FIELD} />}
      {hint && (
        <p id={hintId} className="mt-1.5 text-[13px] text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Row buttons
// ---------------------------------------------------------------------------

const ICON_BUTTON =
  "inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-foreground/8 hover:text-foreground disabled:pointer-events-none disabled:opacity-30";

export function RowButtons({
  index,
  count,
  onMove,
  onRemove,
  what,
}: {
  index: number;
  count: number;
  onMove: (to: number) => void;
  onRemove?: () => void;
  /** "Line 3": said with each button. */
  what: string;
}) {
  const { t } = useT();
  return (
    <span className="flex shrink-0 items-center">
      <button type="button" className={ICON_BUTTON} disabled={index === 0} onClick={() => onMove(index - 1)} aria-label={`${t("services.list.up")}: ${what}`} title={t("services.list.up")}>
        <ArrowUp aria-hidden className="size-4" />
      </button>
      <button type="button" className={ICON_BUTTON} disabled={index === count - 1} onClick={() => onMove(index + 1)} aria-label={`${t("services.list.down")}: ${what}`} title={t("services.list.down")}>
        <ArrowDown aria-hidden className="size-4" />
      </button>
      {onRemove && (
        <button type="button" className={ICON_BUTTON} onClick={onRemove} aria-label={`${t("services.list.remove")}: ${what}`} title={t("services.list.remove")}>
          <X aria-hidden className="size-4" />
        </button>
      )}
    </span>
  );
}

export function AddButton({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 text-sm font-medium text-foreground transition hover:bg-foreground/8 disabled:opacity-40"
    >
      <Plus aria-hidden className="size-4" />
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// A list of texts: what's included, how to prepare, a package's features
// ---------------------------------------------------------------------------

export function TextList({
  where,
  items,
  lang,
  max,
  limit,
  itemLabel,
  addLabel,
  onChange,
}: {
  where: string;
  items: Text[];
  lang: Lang;
  max: number;
  /** The most rows. */
  limit: number;
  /** "Line {n}". */
  itemLabel: (n: number) => string;
  addLabel: string;
  onChange: (items: Text[]) => void;
}) {
  return (
    <div id={fieldId(where)} tabIndex={-1} className="outline-none">
      <ul className="grid gap-1.5">
        {items.map((item, i) => (
          <li key={i} className="flex items-center gap-1">
            <input
              id={fieldId(`${where}.${i}`)}
              value={item[lang]}
              maxLength={max}
              lang={lang}
              placeholder={lang !== "en" ? item.en : undefined}
              aria-label={itemLabel(i + 1)}
              onChange={(e) => onChange(items.map((x, k) => (k === i ? { ...x, [lang]: e.target.value } : x)))}
              className={`${FIELD} mt-0 min-w-0 flex-1`}
            />
            <RowButtons
              index={i}
              count={items.length}
              what={itemLabel(i + 1)}
              onMove={(to) => onChange(move(items, i, to))}
              onRemove={() => onChange(items.filter((_, k) => k !== i))}
            />
          </li>
        ))}
      </ul>
      <div className="mt-1.5">
        <AddButton
          label={addLabel}
          disabled={items.length >= limit}
          onClick={() => onChange([...items, { en: "", ru: "", uz: "" }])}
        />
      </div>
    </div>
  );
}

/** A number field whose empty state is 0 (or null, where "none" means something). */
export function NumberField({
  where,
  label,
  hint,
  value,
  max,
  allowEmpty = false,
  onChange,
}: {
  where: string;
  label: string;
  hint?: string;
  value: number | null;
  max: number;
  /** Empty means null, not 0. */
  allowEmpty?: boolean;
  onChange: (value: number | null) => void;
}) {
  const hintId = useId();
  const id = fieldId(where);
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="block whitespace-nowrap text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        inputMode="numeric"
        autoComplete="off"
        value={value === null || value === 0 ? "" : String(value)}
        aria-describedby={hint ? hintId : undefined}
        onChange={(e) => {
          const digits = e.target.value.replace(/\D/g, "").slice(0, String(max).length);
          if (digits === "") onChange(allowEmpty ? null : 0);
          else onChange(Math.min(max, Number(digits)));
        }}
        className={`${FIELD} tabular-nums`}
      />
      {hint && (
        <p id={hintId} className="mt-1 truncate text-xs text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  );
}
