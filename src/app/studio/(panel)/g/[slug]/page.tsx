// A gallery's Photos tab: uploading into it, what is in it, which photo is
// the cover, and deleting some.

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import StudioPhotoGrid from "@/src/components/studio/StudioPhotoGrid";
import UploadPanel from "@/src/components/studio/UploadPanel";
import { getStudioGallery, listStudioPhotos } from "@/src/lib/studio/gallery";
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
      <StudioPhotoGrid galleryId={gallery.id} photos={photos} />
    </>
  );
}
