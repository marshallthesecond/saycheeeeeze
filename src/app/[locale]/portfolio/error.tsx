"use client";

// Catches anything the Portfolio route throws — usually Bunny being
// unreachable — and offers a retry instead of a blank crash page.

import Link from "next/link";
import { ImageOff, RotateCw } from "lucide-react";
import { useT } from "@/src/lib/i18n/LanguageProvider";

export default function PortfolioError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { t, locale } = useT();

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col items-center justify-center px-6 text-center gap-5">
      <div className="w-16 h-16 rounded-full bg-foreground/[0.07] flex items-center justify-center">
        <ImageOff className="w-7 h-7 text-muted-foreground" />
      </div>
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">
          {t("portfolio.errorTitle")}
        </h1>
        <p className="text-sm text-muted-foreground mt-2 max-w-xs">
          {t("portfolio.errorBody")}
        </p>
      </div>
      <div className="flex flex-col gap-2 w-full max-w-xs">
        <button
          onClick={reset}
          className="btn-glass-primary flex items-center justify-center gap-2 w-full min-h-12 text-sm font-bold"
        >
          <RotateCw className="w-4 h-4" />
          {t("common.tryAgain")}
        </button>
        <Link
          href={`/${locale}`}
          className="btn-glass w-full min-h-12 flex items-center justify-center text-sm font-semibold"
        >
          {t("common.backHome")}
        </Link>
      </div>
    </div>
  );
}