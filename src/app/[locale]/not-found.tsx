"use client";

// 404 for any unmatched route. A client component so it can read the active
// dictionary — a Russian visitor who mistypes a URL gets a Russian 404.

import Link from "next/link";
import { Camera } from "lucide-react";
import { useT } from "@/src/lib/i18n/LanguageProvider";

export default function NotFound() {
  const { t, locale } = useT();

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col items-center justify-center px-6 text-center gap-5">
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-80 pointer-events-none"
        style={{
          background:
            "linear-gradient(to bottom, color-mix(in oklab, var(--secondary) 28%, transparent) 0%, transparent 100%)",
        }}
      />
      <div className="relative z-10 flex flex-col items-center gap-5">
        <div className="w-16 h-16 rounded-full bg-foreground/10 flex items-center justify-center">
          <Camera className="w-7 h-7 text-accent-warm" />
        </div>
        <div>
          <p className="text-5xl font-serif tracking-tight">404</p>
          <h1 className="text-xl font-bold tracking-tight mt-2">
            {t("notFound.title")}
          </h1>
          <p className="text-sm text-muted-foreground mt-2 max-w-xs">
            {t("notFound.body")}
          </p>
        </div>
        {/* Links keep the visitor in their own language. */}
        <div className="flex flex-col gap-2 w-full max-w-xs">
          <Link
            href={`/${locale}/portfolio`}
            className="btn-glass-primary w-full min-h-12 flex items-center justify-center text-sm font-bold"
          >
            {t("notFound.browse")}
          </Link>
          <Link
            href={`/${locale}`}
            className="btn-glass w-full min-h-12 flex items-center justify-center text-sm font-semibold"
          >
            {t("common.backHome")}
          </Link>
        </div>
      </div>
    </div>
  );
}
