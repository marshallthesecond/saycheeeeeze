"use client";

// The Studio's section links. A Client Component only because the current
// section is read from the address; everything around it renders on the
// server.
//
// One entry today. Uploads, Bookings, Services and prices, Profile and
// Settings are added to ITEMS as each is built, and nothing else here changes.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Images, type LucideIcon } from "lucide-react";
import { useT } from "@/src/lib/i18n/LanguageProvider";
import { STUDIO_HOME } from "@/src/lib/studio/config";

interface Item {
  href: string;
  /** A key in the Studio dictionary. */
  label: string;
  Icon: LucideIcon;
  /** Is this the section the address is in? */
  matches: (pathname: string) => boolean;
}

const ITEMS: Item[] = [
  {
    href: STUDIO_HOME,
    label: "nav.galleries",
    Icon: Images,
    matches: (p) => p === STUDIO_HOME || p === `${STUDIO_HOME}/new` || p.startsWith(`${STUDIO_HOME}/g/`),
  },
];

export default function StudioNav({ className = "" }: { className?: string }) {
  const pathname = usePathname();
  const { t } = useT();

  return (
    <nav aria-label={t("brand")} className={className}>
      <ul className="grid gap-1">
        {ITEMS.map(({ href, label, Icon, matches }) => {
          const active = matches(pathname);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`flex h-10 items-center gap-2.5 rounded-lg px-3 text-sm transition ${
                  active
                    ? "bg-foreground/8 font-semibold text-foreground"
                    : "text-muted-foreground hover:bg-foreground/6 hover:text-foreground"
                }`}
              >
                <Icon aria-hidden className="size-4 shrink-0" />
                <span className="truncate">{t(label)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
