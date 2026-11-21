"use client";

// The sets of a gallery, above its photos on the Photos tab (Marshall,
// 2026-11-21): a gallery can be divided into up to 10 sets, which are tabs on
// its page on the site.
//
// No sets: "Divide into sets", which asks for the first names; every photo
// starts in the first set. With sets: one tab per set with its count, the
// grid below shows the open one. "+ Set" adds one; "..." beside the tabs
// renames, moves, deletes the open set or removes them all. A photo dragged
// onto a tab moves into that set (the photos chosen with it go too).

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { ChevronLeft, ChevronRight, CircleAlert, Layers, LoaderCircle, MoreHorizontal, Pencil, Plus, Trash2, X } from "lucide-react";
import { useT } from "@/src/lib/i18n/LanguageProvider";
import type { GallerySet } from "@/src/lib/gallery-sets";

/** Each resolves to an error key under `errors`, or nothing when it worked. */
export interface SetOps {
  create: (labels: string[]) => Promise<string | undefined>;
  rename: (setId: string, label: string) => Promise<string | undefined>;
  move: (setId: string, position: number) => Promise<string | undefined>;
  remove: (setId: string, moveTo: string | null) => Promise<string | undefined>;
  removeAll: () => Promise<string | undefined>;
}

export const MAX_SETS = 10;
const LABEL_MAX = 40;

const SMALL =
  "inline-flex h-8 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 text-[13px] font-semibold transition " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50";
const SMALL_QUIET = `${SMALL} bg-foreground/6 text-foreground hover:bg-foreground/12`;
const SMALL_MAIN = `${SMALL} bg-primary text-primary-foreground hover:bg-primary-hover`;
const SMALL_DANGER = `${SMALL} border border-destructive text-destructive hover:ring-1 hover:ring-destructive`;
const FIELD =
  "h-8 w-full min-w-0 rounded-md border border-input bg-card px-2.5 text-sm text-foreground placeholder:text-muted-foreground " +
  "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring";
const ITEM =
  "flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm text-foreground outline-none transition " +
  "hover:bg-foreground/6 focus-visible:bg-foreground/10 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent";
const ICON = "size-4 shrink-0 text-muted-foreground";

interface Props {
  sets: GallerySet[];
  /** Photos per set id, hidden ones too. */
  counts: Record<string, number>;
  activeId: string | null;
  onChoose: (setId: string) => void;
  /** The database has sets (20261122120000_gallery_sets.sql). */
  ready: boolean;
  /** Photos are being dragged: the other tabs take them. */
  dragging: boolean;
  onDropPhotos: (setId: string) => void;
  ops: SetOps;
}

export default function SetBar({ sets, counts, activeId, onChoose, ready, dragging, onDropPhotos, ops }: Props) {
  const { t } = useT();
  const [dividing, setDividing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [over, setOver] = useState<string | null>(null);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);

  if (sets.length === 0) {
    return (
      <div className="mb-3">
        {dividing ? (
          <DivideForm onCancel={() => setDividing(false)} onCreate={ops.create} />
        ) : (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <button type="button" disabled={!ready} className={SMALL_QUIET} onClick={() => setDividing(true)}>
              <Layers aria-hidden className="size-3.5" />
              {t("gallery.sets.divide")}
            </button>
            {!ready && <span className="text-xs text-muted-foreground">{t("errors.setsNotSetUp")}</span>}
          </div>
        )}
      </div>
    );
  }

  const activeIndex = Math.max(0, sets.findIndex((s) => s.id === activeId));
  const active = sets[activeIndex];

  const onTabKey = (e: ReactKeyboardEvent) => {
    const last = sets.length - 1;
    const next =
      e.key === "ArrowRight" ? (activeIndex === last ? 0 : activeIndex + 1)
      : e.key === "ArrowLeft" ? (activeIndex === 0 ? last : activeIndex - 1)
      : e.key === "Home" ? 0
      : e.key === "End" ? last
      : null;
    if (next === null) return;
    e.preventDefault();
    onChoose(sets[next].id);
    tabs.current[next]?.focus();
  };

  return (
    <div className="mb-3 flex flex-wrap items-center gap-1.5">
      <div role="tablist" aria-label={t("gallery.sets.tabs")} className="flex flex-wrap gap-1.5" onKeyDown={onTabKey}>
        {sets.map((s, i) => {
          const on = s.id === active.id;
          const target = dragging && !on;
          return (
            <button
              key={s.id}
              ref={(el) => {
                tabs.current[i] = el;
              }}
              type="button"
              role="tab"
              aria-selected={on}
              tabIndex={on ? 0 : -1}
              aria-label={t("gallery.sets.tab", { name: s.label, n: counts[s.id] ?? 0 })}
              data-set-tab={s.id}
              onClick={() => onChoose(s.id)}
              onDragOver={(e) => {
                if (!target) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                if (over !== s.id) setOver(s.id);
              }}
              onDragLeave={() => setOver((o) => (o === s.id ? null : o))}
              onDrop={(e) => {
                if (!target) return;
                e.preventDefault();
                setOver(null);
                onDropPhotos(s.id);
              }}
              className={`inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-md border px-3 text-[13px] font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${
                on
                  ? "border-foreground bg-foreground text-background"
                  : over === s.id
                    ? "border-accent-warm bg-accent-warm/15 text-foreground"
                    : target
                      ? "border-dashed border-foreground/50 text-foreground"
                      : "border-border text-foreground hover:border-foreground/40"
              }`}
            >
              {s.label}
              <span className={`tabular-nums ${on ? "opacity-70" : "text-muted-foreground"}`}>{counts[s.id] ?? 0}</span>
            </button>
          );
        })}
      </div>

      {adding ? (
        <AddForm
          onCancel={() => setAdding(false)}
          onAdd={async (label) => {
            const error = await ops.create([label]);
            if (!error) setAdding(false);
            return error;
          }}
        />
      ) : (
        sets.length < MAX_SETS && (
          <button type="button" className={`${SMALL} border border-dashed border-border text-foreground hover:border-foreground/40`} onClick={() => setAdding(true)}>
            <Plus aria-hidden className="size-3.5" />
            {t("gallery.sets.add")}
          </button>
        )
      )}

      <SetMenu
        key={active.id}
        open={menuOpen}
        onOpenChange={setMenuOpen}
        sets={sets}
        index={activeIndex}
        count={counts[active.id] ?? 0}
        ops={ops}
      />
    </div>
  );
}

/** The first names, when a gallery is divided into sets: two to start, up to ten. */
function DivideForm({ onCancel, onCreate }: { onCancel: () => void; onCreate: (labels: string[]) => Promise<string | undefined> }) {
  const { t } = useT();
  const [labels, setLabels] = useState(["", ""]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => first.current?.focus(), []);

  const names = labels.map((l) => l.trim()).filter(Boolean);
  return (
    <form
      className="grid max-w-md gap-2 rounded-lg border border-border p-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        if (names.length < 2) {
          setError("setsTwo");
          return;
        }
        setBusy(true);
        setError(null);
        const problem = await onCreate(names);
        setBusy(false);
        if (problem) setError(problem);
      }}
    >
      <p className="text-sm font-semibold">{t("gallery.sets.divide")}</p>
      <p className="text-xs leading-relaxed text-muted-foreground">{t("gallery.sets.divideHint")}</p>
      {labels.map((value, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            ref={i === 0 ? first : undefined}
            value={value}
            maxLength={LABEL_MAX}
            onChange={(e) => setLabels((l) => l.map((x, j) => (j === i ? e.target.value : x)))}
            placeholder={i < 2 ? t(i === 0 ? "gallery.sets.example1" : "gallery.sets.example2") : t("gallery.sets.nameN", { n: i + 1 })}
            aria-label={t("gallery.sets.nameN", { n: i + 1 })}
            className={FIELD}
          />
          {i >= 2 && (
            <button
              type="button"
              aria-label={t("gallery.sets.dropName", { n: i + 1 })}
              onClick={() => setLabels((l) => l.filter((_, j) => j !== i))}
              className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-foreground/6 hover:text-foreground"
            >
              <X aria-hidden className="size-4" />
            </button>
          )}
        </div>
      ))}
      {labels.length < MAX_SETS && (
        <button
          type="button"
          onClick={() => setLabels((l) => [...l, ""])}
          className="inline-flex w-fit items-center gap-1.5 text-[13px] font-medium text-foreground underline-offset-4 hover:underline"
        >
          <Plus aria-hidden className="size-3.5" />
          {t("gallery.sets.another")}
        </button>
      )}
      {error && <Problem error={error} />}
      <div className="flex flex-wrap gap-2 pt-1">
        <button type="submit" disabled={busy} className={SMALL_MAIN}>
          {busy && <LoaderCircle aria-hidden className="size-3.5 animate-spin" />}
          {t("gallery.sets.create")}
        </button>
        <button type="button" disabled={busy} onClick={onCancel} className={SMALL_QUIET}>
          {t("common.cancel")}
        </button>
      </div>
    </form>
  );
}

/** One more set, named in place of the "+ Set" button. */
function AddForm({ onCancel, onAdd }: { onCancel: () => void; onAdd: (label: string) => Promise<string | undefined> }) {
  const { t } = useT();
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => field.current?.focus(), []);
  return (
    <form
      className="flex flex-wrap items-center gap-1.5"
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy || !label.trim()) return;
        setBusy(true);
        setError(null);
        const problem = await onAdd(label.trim());
        setBusy(false);
        if (problem) setError(problem);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") onCancel();
      }}
    >
      <input
        ref={field}
        value={label}
        maxLength={LABEL_MAX}
        onChange={(e) => setLabel(e.target.value)}
        placeholder={t("gallery.sets.newSet")}
        aria-label={t("gallery.sets.newSet")}
        className={`${FIELD} w-40`}
      />
      <button type="submit" disabled={busy || !label.trim()} className={SMALL_MAIN}>
        {busy && <LoaderCircle aria-hidden className="size-3.5 animate-spin" />}
        {t("gallery.sets.addButton")}
      </button>
      <button type="button" disabled={busy} onClick={onCancel} aria-label={t("common.cancel")} className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-foreground/6 hover:text-foreground">
        <X aria-hidden className="size-4" />
      </button>
      {error && (
        <span className="basis-full">
          <Problem error={error} />
        </span>
      )}
    </form>
  );
}

type MenuView = "main" | "rename" | "delete" | "removeAll";

/** "..." beside the tabs: the open set's rename, order, delete, and removing every set. */
function SetMenu({
  open,
  onOpenChange,
  sets,
  index,
  count,
  ops,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sets: GallerySet[];
  index: number;
  count: number;
  ops: SetOps;
}) {
  const { t } = useT();
  const set = sets[index];
  const [view, setView] = useState<MenuView>("main");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [label, setLabel] = useState(set.label);
  const others = sets.filter((s) => s.id !== set.id);
  const [moveTo, setMoveTo] = useState(others[0]?.id ?? "");
  const box = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  const close = (focusBack: boolean) => {
    onOpenChange(false);
    setView("main");
    setError(null);
    if (focusBack) trigger.current?.focus();
  };

  // Inside the window: moved left when it would run off the right edge.
  useLayoutEffect(() => {
    const el = panel.current;
    if (!open || !el) return;
    el.style.transform = "";
    const r = el.getBoundingClientRect();
    const over = r.right - (window.innerWidth - 8);
    if (over > 0) el.style.transform = `translateX(${-Math.min(over, r.left - 8)}px)`;
    (el.querySelector<HTMLElement>("[data-menu-field]") ?? el.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)'))?.focus({
      preventScroll: true,
    });
  }, [open, view]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) {
        onOpenChange(false);
        setView("main");
        setError(null);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onOpenChange(false);
        setView("main");
        setError(null);
        trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open, onOpenChange]);

  const run = async (fn: () => Promise<string | undefined>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const problem = await fn().catch(() => "failed");
    setBusy(false);
    if (problem) setError(problem);
    else close(true);
  };

  const onMenuKey = (e: ReactKeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    e.preventDefault();
    const items = [...(panel.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    items[(at + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
  };

  const back = (title: string) => (
    <div className="mb-1 flex items-center gap-1 border-b border-border pb-1.5">
      <button
        type="button"
        aria-label={t("gallery.photos.actions.back")}
        onClick={() => {
          setView("main");
          setError(null);
        }}
        className="grid size-8 shrink-0 place-items-center rounded-md text-foreground outline-none hover:bg-foreground/6 focus-visible:bg-foreground/10"
      >
        <ChevronLeft aria-hidden className="size-4" />
      </button>
      <p className="min-w-0 break-words text-sm font-semibold">{title}</p>
    </div>
  );

  let content: React.ReactNode;
  if (view === "main") {
    content = (
      <>
        <p className="mb-1 break-words border-b border-border px-3 pb-2 pt-1 text-sm font-semibold">{set.label}</p>
        <button
          type="button"
          role="menuitem"
          className={ITEM}
          onClick={() => {
            setLabel(set.label);
            setView("rename");
          }}
        >
          <Pencil aria-hidden className={ICON} />
          {t("gallery.sets.rename")}
        </button>
        <button type="button" role="menuitem" disabled={busy || index === 0} className={ITEM} onClick={() => run(() => ops.move(set.id, index - 1))}>
          <ChevronLeft aria-hidden className={ICON} />
          {t("gallery.sets.moveLeft")}
        </button>
        <button
          type="button"
          role="menuitem"
          disabled={busy || index === sets.length - 1}
          className={ITEM}
          onClick={() => run(() => ops.move(set.id, index + 1))}
        >
          <ChevronRight aria-hidden className={ICON} />
          {t("gallery.sets.moveRight")}
        </button>
        <div role="separator" className="my-1 border-t border-border" />
        <button type="button" role="menuitem" className={ITEM} onClick={() => setView("delete")}>
          <Trash2 aria-hidden className={`${ICON} text-destructive`} />
          {t("gallery.sets.delete")}
        </button>
        <button type="button" role="menuitem" className={ITEM} onClick={() => setView("removeAll")}>
          <Layers aria-hidden className={ICON} />
          {t("gallery.sets.removeAll")}
        </button>
        {error && <Problem error={error} />}
      </>
    );
  } else if (view === "rename") {
    content = (
      <>
        {back(t("gallery.sets.rename"))}
        <form
          className="grid gap-2 px-2 pb-1 pt-1"
          onSubmit={(e) => {
            e.preventDefault();
            const next = label.trim();
            if (!next || next === set.label) return close(true);
            void run(() => ops.rename(set.id, next));
          }}
        >
          <input
            data-menu-field
            value={label}
            maxLength={LABEL_MAX}
            onChange={(e) => setLabel(e.target.value)}
            aria-label={t("gallery.sets.name")}
            className={FIELD}
          />
          {error && <Problem error={error} />}
          <div className="flex gap-2">
            <button type="submit" disabled={busy} className={SMALL_MAIN}>
              {busy && <LoaderCircle aria-hidden className="size-3.5 animate-spin" />}
              {t("common.save")}
            </button>
          </div>
        </form>
      </>
    );
  } else if (view === "delete") {
    content = (
      <>
        {back(t("gallery.sets.delete"))}
        <div className="grid gap-2 px-3 pb-1 pt-1">
          <p className="text-sm leading-snug">
            {others.length === 0
              ? t("gallery.sets.deleteLast", { name: set.label })
              : count === 0
                ? t("gallery.sets.deleteEmpty", { name: set.label })
                : t(count === 1 ? "gallery.sets.deleteAskOne" : "gallery.sets.deleteAsk", { name: set.label, n: count })}
          </p>
          {others.length > 0 && count > 0 && (
            <select
              data-menu-field
              value={moveTo}
              onChange={(e) => setMoveTo(e.target.value)}
              aria-label={t("gallery.sets.moveTo")}
              className={FIELD}
            >
              {others.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          )}
          {error && <Problem error={error} />}
          <div className="flex flex-wrap gap-2 pt-0.5">
            <button
              type="button"
              role="menuitem"
              disabled={busy}
              className={SMALL_DANGER}
              onClick={() => run(() => ops.remove(set.id, others.length > 0 ? moveTo || others[0].id : null))}
            >
              {busy && <LoaderCircle aria-hidden className="size-3.5 animate-spin" />}
              {t("gallery.sets.deleteYes")}
            </button>
            <button type="button" role="menuitem" disabled={busy} className={SMALL_QUIET} onClick={() => setView("main")}>
              {t("common.cancel")}
            </button>
          </div>
        </div>
      </>
    );
  } else {
    content = (
      <>
        {back(t("gallery.sets.removeAll"))}
        <div className="grid gap-2 px-3 pb-1 pt-1">
          <p className="text-sm leading-snug">{t("gallery.sets.removeAsk")}</p>
          {error && <Problem error={error} />}
          <div className="flex flex-wrap gap-2 pt-0.5">
            <button type="button" role="menuitem" disabled={busy} className={SMALL_DANGER} onClick={() => run(ops.removeAll)}>
              {busy && <LoaderCircle aria-hidden className="size-3.5 animate-spin" />}
              {t("gallery.sets.removeYes")}
            </button>
            <button type="button" role="menuitem" disabled={busy} className={SMALL_QUIET} onClick={() => setView("main")}>
              {t("common.cancel")}
            </button>
          </div>
        </div>
      </>
    );
  }

  return (
    <div ref={box} className="relative">
      <button
        ref={trigger}
        type="button"
        aria-label={t("gallery.sets.options", { name: set.label })}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => (open ? close(false) : onOpenChange(true))}
        className="grid size-8 place-items-center rounded-md text-foreground transition hover:bg-foreground/6 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <MoreHorizontal aria-hidden className="size-4" />
      </button>
      {open && (
        <div
          ref={panel}
          role="menu"
          aria-label={t("gallery.sets.options", { name: set.label })}
          onKeyDown={onMenuKey}
          className="absolute left-0 top-full z-40 mt-1 w-64 max-w-[calc(100vw-16px)] rounded-lg border border-border bg-popover p-1.5 text-popover-foreground shadow-2xl"
        >
          {content}
        </div>
      )}
    </div>
  );
}

function Problem({ error }: { error: string }) {
  const { t } = useT();
  return (
    <p role="alert" className="flex items-start gap-2 text-xs leading-relaxed text-destructive">
      <CircleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
      <span>{t(`errors.${error}`)}</span>
    </p>
  );
}
