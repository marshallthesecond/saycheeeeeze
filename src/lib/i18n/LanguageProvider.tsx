"use client";

//
// Makes the active locale and its dictionary available to client components.
// The dictionary is loaded on the SERVER and passed down as a prop, so there's
// no loading flash and no extra client fetch.

import { createContext, useContext } from "react";
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
  return (
    <LanguageContext.Provider value={{ locale, dict }}>
      {children}
    </LanguageContext.Provider>
  );
}

type Vars = Record<string, string | number>;

/** Walks "book.step1" through the nested dictionary. */
function lookup(dict: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object" && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, dict);
}

/**
 *   const { t, locale } = useT();
 *   t("book.confirm")                    -> "Confirm booking"
 *   t("book.stepOf", { n: 2, total: 4 }) -> "Step 2 of 4"
 *   tArray("calendar.months")            -> lists
 *
 * A missing key returns the key itself rather than throwing.
 */
export function useT() {
  const ctx = useContext(LanguageContext);

  if (!ctx) {
    // Rendered outside a provider (e.g. an isolated test): degrade to keys
    // instead of blowing up the whole tree.
    return {
      locale: defaultLocale,
      t: (key: string) => key,
      tArray: (_key: string) => [] as string[],
    };
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
}