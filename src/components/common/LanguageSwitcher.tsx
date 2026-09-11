"use client";

// src/components/common/LanguageSwitcher.tsx
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
      className={`inline-flex items-center gap-0.5 rounded-full bg-white/8 p-0.5 ${className}`}
    >
      {locales.map((loc) => (
        <button
          key={loc}
          onClick={() => switchTo(loc)}
          aria-current={loc === active ? "true" : undefined}
          // 36px min touch target — small enough for a header, big enough to hit.
          className={`min-w-6 min-h-6 px-1 rounded-sm text-[9px] font-bold transition active:scale-95
            ${loc === active
              ? "bg-white text-black"
              : "text-white/60 hover:text-white hover:bg-white/10"}`}
        >
          {localeShort[loc]}
        </button>
      ))}
    </div>
  );
}