"use client";

//
// Makes the active locale and its dictionary available to client components.
// The dictionary is loaded on the SERVER and passed down as a prop, so there's
// no loading flash and no extra client fetch.

import { createContext, useContext, useMemo } from "react";
import type { Locale } from "./config";
import { defaultLocale } from "./config";
import type { Dictionary } from "./dictionaries";

interface LanguageContextValue {
  locale: Locale;
  dict: Dictionary;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({
  locale,
  dict,
  children,
}: {
  locale: Locale;
  dict: Dictionary;
  children: React.ReactNode;
}) {
  // A fresh object literal here would be a new context value on every render
  // of the provider, which re-renders every consumer in the tree for nothing.
  const value = useMemo(() => ({ locale, dict }), [locale, dict]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

type Vars = Record<string, string | number>;

/**
 * Resolved paths, per dictionary.
 *
 * The dictionary is loaded on the server and handed down frozen, so a path
 * resolves to the same value for the life of the page — but `lookup` was
 * splitting the key and walking the object on EVERY call, and `t()` is called
 * 60-odd times per render of the booking form. Typing a name into step 4 ran
 * several thousand of those walks for a form whose text had not changed.
 *
 * A WeakMap so a dictionary swapped out on a locale change takes its cache
 * with it rather than pinning three languages in memory for ever.
 */
const pathCache = new WeakMap<object, Map<string, unknown>>();

/** Walks "book.step1" through the nested dictionary. Cached per dictionary. */
function lookup(dict: unknown, path: string): unknown {
  if (!dict || typeof dict !== "object") return undefined;

  let cache = pathCache.get(dict as object);
  if (!cache) {
    cache = new Map();
    pathCache.set(dict as object, cache);
  }
  // `has`, not a truthiness check: a missing key resolves to `undefined` and
  // that answer is worth caching too — a mistyped key is looked up just as
  // often as a correct one, and it is the slowest path (a full walk to
  // nothing).
  if (cache.has(path)) return cache.get(path);

  const value = path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object" && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, dict);

  cache.set(path, value);
  return value;
}

/**
 * Spelt out rather than inferred. Inferred, useT()'s return type was a UNION
 * of the fallback shape and the real one, and TypeScript resolves a call on a
 * union of signatures against the INTERSECTION of their parameters — so
 * `t(key, vars)` was quietly unavailable to every caller. It only went
 * unnoticed because nothing had used the two-argument form yet.
 */
export interface Translator {
  locale: Locale;
  t: (key: string, vars?: Vars) => string;
  tArray: (key: string) => string[];
}

/**
 * The no-provider fallback, hoisted.
 *
 * Built fresh inside useT() it was a new `t` identity on every render of every
 * consumer, which is the one thing a hook returning functions must not do.
 */
const FALLBACK: Translator = {
  locale: defaultLocale,
  t: (key: string) => key,
  tArray: () => [],
};

/**
 *   const { t, locale } = useT();
 *   t("book.confirm")                    -> "Confirm booking"
 *   t("book.stepOf", { n: 2, total: 4 }) -> "Step 2 of 4"
 *   tArray("calendar.months")            -> lists
 *
 * A missing key returns the key itself rather than throwing.
 */
export function useT(): Translator {
  const ctx = useContext(LanguageContext);

  // MEMOISED on the context, and this is load-bearing rather than tidy. `t`
  // and `tArray` are passed as props and used as effect/useMemo dependencies;
  // a fresh identity each render meant every `useMemo([..., t])` in the tree
  // recomputed on every render and every `React.memo` around a component
  // taking `t` never held. The context value changes only on a locale change,
  // so these are stable for the life of the page.
  return useMemo(() => {
    if (!ctx) {
      // Rendered outside a provider (e.g. an isolated test): degrade to keys
      // instead of blowing up the whole tree.
      return FALLBACK;
    }

    const t = (key: string, vars?: Vars): string => {
      const value = lookup(ctx.dict, key);
      if (typeof value !== "string") return key;
      if (!vars) return value;
      return Object.entries(vars).reduce(
        (out, [k, v]) => out.replaceAll(`{${k}}`, String(v)),
        value
      );
    };

    const tArray = (key: string): string[] => {
      const value = lookup(ctx.dict, key);
      return Array.isArray(value) ? (value as string[]) : [];
    };

    return { locale: ctx.locale, t, tArray };
  }, [ctx]);
}