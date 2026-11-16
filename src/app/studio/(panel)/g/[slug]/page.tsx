// A gallery's Photos tab: uploading into it, what is in it, and which photo
// is the cover.

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import PhotoFrame from "@/src/components/common/PhotoFrame";
import { PendingButton } from "@/src/components/studio/FormFeedback";
import UploadPanel from "@/src/components/studio/UploadPanel";
import { setCover } from "@/src/app/studio/gallery-actions";
import { getStudioGallery, listStudioPhotos } from "@/src/lib/studio/gallery";
import { getStudioDictionary, translator } from "@/src/lib/studio/i18n";
import { getStudioLocale } from "@/src/lib/studio/locale";
import { requireStudio } from "@/src/lib/studio/session";
import { getWorkerStatus, unfinishedUploads } from "@/src/lib/studio/uploads";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const gallery = await getStudioGallery(decodeURIComponent((await params).slug));
  return { title: gallery?.title };
}

export default async function GalleryPhotosPage({ params }: Props) {
  const gallery = await getStudioGallery(decodeURIComponent((await params).slug));
  if (!gallery) notFound();

  const session = await requireStudio();
  const t = translator(await getStudioDictionary(await getStudioLocale()));
  // Uploading is optional on this page: if the database has not had the
  // uploads migration yet, the photos still show and the panel says nothing.
  const [photos, pending, worker] = await Promise.all([
    listStudioPhotos(gallery),
    unfinishedUploads(session, gallery.id).catch(() => []),
    getWorkerStatus().catch(() => null),
  ]);

  const panel = (
    <UploadPanel
      galleryId={gallery.id}
      canUpload={Boolean(gallery.folder)}
      hasPhotos={photos.length > 0}
      pending={pending}
      worker={worker ? { online: worker.online, name: worker.name } : null}
    />
  );

  if (photos.length === 0) return panel;

  return (
    <>
      {panel}
      <p className="text-sm text-muted-foreground">{t("gallery.photos.coverHint")}</p>
      <ul className="mt-4 grid grid-cols-3 gap-x-2 gap-y-4 sm:grid-cols-4 sm:gap-x-3 lg:grid-cols-5 2xl:grid-cols-6">
        {photos.map((photo) => (
          <li key={photo.id} className="min-w-0">
            <div className="relative overflow-hidden rounded-lg ring-1 ring-border">
              <PhotoFrame
                ladder={photo.ladder}
                thumbhash={photo.thumbhash}
                alt={photo.fileName}
                sizes="(min-width: 1536px) 14vw, (min-width: 1024px) 17vw, (min-width: 640px) 23vw, 31vw"
                className="aspect-square w-full"
              />
              {photo.isCover && (
                <span className="absolute left-1.5 top-1.5 rounded-md bg-black/70 px-1.5 py-1 text-[11px] font-medium leading-none text-white">
                  {t("gallery.photos.cover")}
                </span>
              )}
            </div>
            <p className="mt-1.5 truncate text-xs text-muted-foreground" title={photo.fileName}>
              {photo.fileName}
            </p>
            {!photo.isCover && (
              <form action={setCover}>
                <input type="hidden" name="galleryId" value={gallery.id} />
                <input type="hidden" name="photo" value={photo.id} />
                <PendingButton className="text-left text-[13px] text-accent-warm underline-offset-4 hover:underline disabled:opacity-60">
                  {t("gallery.photos.setCover")}
                </PendingButton>
              </form>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
