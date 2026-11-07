"use client";

//
// Compact three-way toggle. Navigating rewrites the locale segment of the
// current path, so switching language keeps you on the same page.

import { usePathname, useRouter } from "next/navigation";
import { locales, localeShort, pathWithLocale, type Locale } from "@/src/lib/i18n/config";
import { useT } from "@/src/lib/i18n/LanguageProvider";
import { rememberLocale } from "@/src/lib/i18n/rememberLocale";

export default function LanguageSwitcher({ className = "" }: { className?: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const { locale: active } = useT();

  const switchTo = (next: Locale) => {
    if (next === active) return;
    // Remember the choice so middleware can honour it on a bare "/" visit.
    rememberLocale(next);
    router.push(pathWithLocale(pathname, next));
  };

  return (
    <div
      role="group"
      aria-label="Language"
      // Its own frosted ground rather than a tint of whatever is behind it:
      // the switcher sits in StickyHeader, which is transparent over a hero
      // photograph until you scroll, so it has to read on a photo in either
      // theme as well as on the page.
      className={`inline-flex items-center gap-0.5 rounded-full bg-[color-mix(in_oklab,var(--background)_90%,transparent)] backdrop-blur-md p-0.5 ${className}`}
    >
      {locales.map((loc) => (
        <button
          key={loc}
          onClick={() => switchTo(loc)}
          aria-current={loc === active ? "true" : undefined}
          // 36px min touch target — small enough for a header, big enough to hit.
          className={`min-w-6 min-h-6 px-1 rounded-sm text-[9px] font-bold transition active:scale-95
            ${loc === active
              ? "bg-foreground text-background"
              : "text-foreground/75 hover:text-foreground hover:bg-foreground/10"}`}
        >
          {localeShort[loc]}
        </button>
      ))}
    </div>
  );
}