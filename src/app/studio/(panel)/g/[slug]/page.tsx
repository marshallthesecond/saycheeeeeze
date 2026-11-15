// A gallery's Photos tab: what is in it, and which photo is the cover.
// Read-only apart from the cover until uploading arrives.

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import PhotoFrame from "@/src/components/common/PhotoFrame";
import CopyButton from "@/src/components/studio/CopyButton";
import { PendingButton } from "@/src/components/studio/FormFeedback";
import { setCover } from "@/src/app/studio/gallery-actions";
import { getStudioGallery, listStudioPhotos } from "@/src/lib/studio/gallery";
import { getStudioDictionary, translator } from "@/src/lib/studio/i18n";
import { getStudioLocale } from "@/src/lib/studio/locale";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const gallery = await getStudioGallery(decodeURIComponent((await params).slug));
  return { title: gallery?.title };
}

export default async function GalleryPhotosPage({ params }: Props) {
  const gallery = await getStudioGallery(decodeURIComponent((await params).slug));
  if (!gallery) notFound();

  const t = translator(await getStudioDictionary(await getStudioLocale()));
  const photos = await listStudioPhotos(gallery);

  if (photos.length === 0) {
    return (
      <div className="max-w-prose">
        <h2 className="text-base font-semibold">{t("gallery.photos.empty")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("gallery.photos.emptyBlurb")}</p>
        {gallery.folder && (
          <dl className="mt-5">
            <dt className="text-[13px] text-muted-foreground">{t("gallery.photos.folder")}</dt>
            <dd className="mt-1 flex flex-wrap items-center gap-3">
              <code className="min-w-0 break-all rounded-lg bg-foreground/6 px-3 py-2 font-mono text-sm">
                {gallery.folder}
              </code>
              <CopyButton text={gallery.folder} />
            </dd>
          </dl>
        )}
      </div>
    );
  }

  return (
    <>
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
