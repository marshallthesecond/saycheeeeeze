// EN / RU / UZ for the Studio.
//
// A form with three submit buttons and a Server Action rather than the site's
// LanguageSwitcher: that one rewrites the /[locale]/ part of the address, and
// the Studio's address has none. No "use client", so it also works in the
// sign-in page before any JavaScript loads.

import { locales, localeNames, localeShort, type Locale } from "@/src/lib/i18n/config";
import { setStudioLocale } from "@/src/app/studio/actions";

export default function LocaleSwitch({ active, label }: { active: Locale; label: string }) {
  return (
    <form action={setStudioLocale} role="group" aria-label={label} className="inline-flex items-center gap-0.5">
      {locales.map((loc) => (
        <button
          key={loc}
          type="submit"
          name="locale"
          value={loc}
          title={localeNames[loc]}
          aria-current={loc === active ? "true" : undefined}
          className={`h-8 min-w-9 rounded-md px-2 text-xs font-semibold transition ${
            loc === active
              ? "bg-foreground text-background"
              : "text-muted-foreground hover:bg-foreground/8 hover:text-foreground"
          }`}
        >
          {localeShort[loc]}
        </button>
      ))}
    </form>
  );
}
