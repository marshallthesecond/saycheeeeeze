"use client";

// The Studio's section links. A Client Component only because the current
// section is read from the address; everything around it renders on the
// server.
//
// Galleries and Uploads today. Bookings, Services and prices, Profile and
// Settings are added to ITEMS as each is built, and nothing else here changes.
//
// Two looks: a list with names in the sidebar, icons only in the phone's top
// bar.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CloudUpload, Images, type LucideIcon } from "lucide-react";
import { useT } from "@/src/lib/i18n/LanguageProvider";
import { STUDIO_HOME, STUDIO_UPLOADS } from "@/src/lib/studio/config";

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
  {
    href: STUDIO_UPLOADS,
    label: "nav.uploads",
    Icon: CloudUpload,
    matches: (p) => p === STUDIO_UPLOADS,
  },
];

export default function StudioNav({ className = "", compact = false }: { className?: string; compact?: boolean }) {
  const pathname = usePathname();
  const { t } = useT();

  if (compact) {
    return (
      <nav aria-label={t("brand")} className={className}>
        <ul className="flex items-center gap-0.5">
          {ITEMS.map(({ href, label, Icon, matches }) => {
            const active = matches(pathname);
            return (
              <li key={href}>
                <Link
                  href={href}
                  aria-label={t(label)}
                  title={t(label)}
                  aria-current={active ? "page" : undefined}
                  className={`inline-flex size-9 items-center justify-center rounded-md transition ${
                    active
                      ? "bg-foreground/8 text-foreground"
                      : "text-muted-foreground hover:bg-foreground/8 hover:text-foreground"
                  }`}
                >
                  <Icon aria-hidden className="size-4" />
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    );
  }

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
