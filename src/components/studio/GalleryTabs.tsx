"use client";

// The tabs under a gallery's title. Each one is its own address, so a tab can
// be bookmarked and the Back button moves between them.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useT } from "@/src/lib/i18n/LanguageProvider";
import { studioGalleryPath } from "@/src/lib/studio/config";

export default function GalleryTabs({ slug, withAccess }: { slug: string; withAccess: boolean }) {
  const pathname = usePathname();
  const { t } = useT();

  const tabs = [
    { href: studioGalleryPath(slug), label: t("gallery.tabs.photos") },
    { href: studioGalleryPath(slug, "settings"), label: t("gallery.tabs.settings") },
    ...(withAccess ? [{ href: studioGalleryPath(slug, "access"), label: t("gallery.tabs.access") }] : []),
  ];

  return (
    <nav aria-label={t("nav.galleries")} className="mt-6 border-b border-border">
      {/* One line that scrolls sideways rather than wrapping. */}
      <ul className="-mb-px flex gap-6 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {tabs.map((tab) => {
          const active = decodeURIComponent(pathname) === decodeURIComponent(tab.href);
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={`inline-flex h-11 items-center whitespace-nowrap border-b-2 text-sm transition ${
                  active
                    ? "border-foreground font-semibold text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
