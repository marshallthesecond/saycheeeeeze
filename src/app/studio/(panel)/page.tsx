// /studio — the Galleries screen: everything in the account, and the way in
// to each gallery and to making a new one.

import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import GalleryCard from "@/src/components/studio/GalleryCard";
import { BUTTON_PRIMARY } from "@/src/components/studio/fields";
import { STUDIO_HOME, STUDIO_NEW_GALLERY } from "@/src/lib/studio/config";
import { listStudioGalleries } from "@/src/lib/studio/galleries";
import { getStudioDictionary, translator } from "@/src/lib/studio/i18n";
import { getStudioLocale } from "@/src/lib/studio/locale";
import { requireStudio } from "@/src/lib/studio/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = translator(await getStudioDictionary(await getStudioLocale()));
  return { title: t("galleries.title") };
}

type Filter = "all" | "album" | "client";

export default async function StudioGalleriesPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  const session = await requireStudio();
  const t = translator(await getStudioDictionary(await getStudioLocale()));

  const { type } = await searchParams;
  const filter: Filter = type === "album" || type === "client" ? type : "all";

  const all = await listStudioGalleries(session);
  const shown = filter === "all" ? all : all.filter((g) => g.kind === filter);

  const filters: { id: Filter; label: string; count: number; href: string }[] = [
    { id: "all", label: t("galleries.all"), count: all.length, href: STUDIO_HOME },
    {
      id: "album",
      label: t("galleries.albums"),
      count: all.filter((g) => g.kind === "album").length,
      href: `${STUDIO_HOME}?type=album`,
    },
    {
      id: "client",
      label: t("galleries.client"),
      count: all.filter((g) => g.kind === "client").length,
      href: `${STUDIO_HOME}?type=client`,
    },
  ];

  const photosLabel = (n: number) =>
    n === 0 ? t("galleries.noPhotos") : t(n === 1 ? "galleries.photosOne" : "galleries.photosMany", { n });

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold leading-tight">{t("galleries.title")}</h1>
        <Link
          href={filter === "client" ? `${STUDIO_NEW_GALLERY}?type=client` : STUDIO_NEW_GALLERY}
          className={BUTTON_PRIMARY}
        >
          <Plus aria-hidden className="size-4" />
          {t("galleries.new")}
        </Link>
      </div>

      {/* One line that scrolls sideways rather than wrapping, like the chips
          on the public site. */}
      <nav aria-label={t("galleries.title")} className="-mx-4 mt-4 overflow-x-auto px-4 [scrollbar-width:none] sm:-mx-8 sm:px-8 lg:mx-0 lg:px-0 [&::-webkit-scrollbar]:hidden">
        <ul className="flex w-max gap-2">
          {filters.map((f) => {
            const active = f.id === filter;
            return (
              <li key={f.id}>
                <Link
                  href={f.href}
                  aria-current={active ? "true" : undefined}
                  className={`inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 text-[13px] font-medium transition ${
                    active
                      ? "bg-foreground text-background"
                      : "bg-foreground/6 text-foreground hover:bg-foreground/12"
                  }`}
                >
                  {f.label}
                  <span className={`tabular-nums ${active ? "" : "text-muted-foreground"}`}>{f.count}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {shown.length === 0 ? (
        <p className="mt-10 text-sm text-muted-foreground">{t("galleries.empty")}</p>
      ) : (
        <ul className="mt-6 grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-3 sm:gap-x-5 xl:grid-cols-4 2xl:grid-cols-5">
          {shown.map((g) => (
            <li key={g.id} className="min-w-0">
              <GalleryCard
                gallery={g}
                labels={{
                  kindAlbum: t("galleries.kindAlbum"),
                  kindClient: t("galleries.kindClient"),
                  private: t("galleries.private"),
                  open: t("galleries.open"),
                  hidden: t("galleries.hidden"),
                  view: t("galleries.view"),
                  photos: photosLabel(g.photoCount),
                }}
              />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
