"use client";

// What saycheeeeeze is, as a platform, and an open door for early clients
// and collaborators: under the gallery stack on a computer, at the very end
// of the page on a phone (2026-11-17).

import { Check, Send } from "lucide-react";
import { CARD } from "@/src/components/profile/RailCards";
import { useT } from "@/src/lib/i18n/LanguageProvider";
import { PROFILE } from "@/src/lib/profile";

export default function PlatformCard({ className = "" }: { className?: string }) {
  const { t } = useT();
  return (
    <section aria-labelledby="platform-h" className={`${CARD} flex flex-col gap-2.5 ${className}`}>
      <h2 id="platform-h" className="text-base font-bold tracking-tight">
        saycheeeeeze
      </h2>
      <p className="text-[13px] leading-relaxed text-muted-foreground">{t("home.platform.body")}</p>
      <ul className="flex flex-col gap-1.5">
        {(["delivery", "portfolio", "booking"] as const).map((k) => (
          <li key={k} className="flex items-center gap-2 text-[13px] text-foreground">
            <Check aria-hidden className="size-3.5 shrink-0 text-accent-warm" strokeWidth={2.25} />
            {t(`home.platform.${k}`)}
          </li>
        ))}
      </ul>
      <div className="mt-1.5 flex flex-col gap-2.5 border-t border-border pt-3.5">
        <p className="text-[13px] leading-relaxed text-foreground">{t("home.platform.open")}</p>
        <a
          href={PROFILE.telegram}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-glass inline-flex h-8 w-fit items-center gap-1.5 whitespace-nowrap px-3 text-[12px] font-medium text-foreground"
        >
          <Send aria-hidden className="size-3.5" />
          {t("home.platform.reach")}
        </a>
      </div>
    </section>
  );
}
