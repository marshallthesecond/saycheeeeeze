// The frame around one gallery: its title, what state it is in, the Publish
// button and the tabs. The tab's own page is drawn underneath.

import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, CircleAlert, ExternalLink, EyeOff, Lock, LockOpen } from "lucide-react";
import GalleryTabs from "@/src/components/studio/GalleryTabs";
import { PendingButton } from "@/src/components/studio/FormFeedback";
import { BUTTON_PRIMARY, BUTTON_QUIET } from "@/src/components/studio/fields";
import { setPublished } from "@/src/app/studio/gallery-actions";
import { STUDIO_HOME, studioGalleryPath } from "@/src/lib/studio/config";
import { getStudioGallery, listPasskeys } from "@/src/lib/studio/gallery";
import { getStudioDictionary, translator } from "@/src/lib/studio/i18n";
import { getStudioLocale } from "@/src/lib/studio/locale";

const BADGE =
  "inline-flex items-center gap-1 rounded-md bg-foreground/8 px-2 py-1 text-xs font-medium leading-none text-foreground";

export default async function GalleryLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const gallery = await getStudioGallery(decodeURIComponent(slug));
  if (!gallery) notFound();

  const t = translator(await getStudioDictionary(await getStudioLocale()));
  const client = gallery.kind === "client";

  // A private gallery with no passkey that works is a locked door with no
  // key cut: worth saying before the link goes out.
  const passkeys = client && gallery.isPrivate ? await listPasskeys(gallery.id) : [];
  const unopenable = client && gallery.isPrivate && !passkeys.some((p) => p.status === "active");

  const photos =
    gallery.photoCount === 0
      ? t("galleries.noPhotos")
      : t(gallery.photoCount === 1 ? "galleries.photosOne" : "galleries.photosMany", { n: gallery.photoCount });
  const meta = [client ? t("galleries.kindClient") : t("galleries.kindAlbum"), photos, gallery.dateLabel || gallery.year]
    .filter(Boolean)
    .join(", ");

  return (
    <>
      <Link
        href={STUDIO_HOME}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        <ChevronLeft aria-hidden className="size-4" />
        {t("gallery.back")}
      </Link>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          <h1 className="break-words text-2xl font-semibold leading-tight">{gallery.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{meta}</p>
          {(client || !gallery.isPublished) && (
            <p className="mt-3 flex flex-wrap gap-1.5">
              {client && gallery.isPrivate && (
                <span className={BADGE}>
                  <Lock aria-hidden className="size-3" />
                  {t("galleries.private")}
                </span>
              )}
              {client && !gallery.isPrivate && (
                <span className={BADGE}>
                  <LockOpen aria-hidden className="size-3" />
                  {t("galleries.open")}
                </span>
              )}
              {!gallery.isPublished && (
                <span className={BADGE}>
                  <EyeOff aria-hidden className="size-3" />
                  {t("galleries.hidden")}
                </span>
              )}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {gallery.isPublished && (
            <a href={gallery.href} target="_blank" rel="noopener" className={BUTTON_QUIET}>
              {t("galleries.view")}
              <ExternalLink aria-hidden className="size-3.5" />
            </a>
          )}
          <form action={setPublished}>
            <input type="hidden" name="galleryId" value={gallery.id} />
            <PendingButton
              name="to"
              value={gallery.isPublished ? "draft" : "published"}
              className={gallery.isPublished ? BUTTON_QUIET : BUTTON_PRIMARY}
            >
              {gallery.isPublished ? t("gallery.unpublish") : t("gallery.publish")}
            </PendingButton>
          </form>
        </div>
      </div>

      {client && (!gallery.isPrivate || unopenable) && (
        <p role="note" className="mt-4 flex max-w-prose items-start gap-2 text-sm text-destructive">
          <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span>
            {gallery.isPrivate ? t("gallery.noCodeWarning") : t("gallery.openWarning")}{" "}
            <Link href={studioGalleryPath(gallery.slug, "access")} className="font-medium underline underline-offset-4">
              {t("gallery.toPasskeys")}
            </Link>
          </span>
        </p>
      )}

      <GalleryTabs slug={gallery.slug} withAccess={client} />

      <div className="mt-6">{children}</div>
    </>
  );
}
