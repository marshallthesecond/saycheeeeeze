// A gallery's Photos tab: uploading into it, what is in it, which photo is
// the cover, what the client chose, and deleting, publishing or moving some.
// A photo opens in the photo panel, with its name, description, tags and
// whether it is shown (2026-11-21). A gallery divided into sets shows one set
// at a time; uploads land in the open one.

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { PlaceOption } from "@/src/components/studio/PhotoActions";
import StudioPhotoGrid from "@/src/components/studio/StudioPhotoGrid";
import UploadPanel from "@/src/components/studio/UploadPanel";
import { PICKS_WANTED } from "@/src/app/[locale]/about/best-picks";
import { BEST_PICKS_PLACE, HERO_STACK_COUNT, PLACES, RAIL_COUNT } from "@/src/lib/placements";
import { getDictionary } from "@/src/lib/i18n/dictionaries";
import { getServiceBySlug, pickLocale } from "@/src/lib/services";
import { albumTargets, getStudioGallery, listStudioPhotoDetails, placementState } from "@/src/lib/studio/gallery";
import { getStudioLocale } from "@/src/lib/studio/locale";
import { requireStudio } from "@/src/lib/studio/session";
import { getWorkerStatus, unfinishedUploads } from "@/src/lib/studio/uploads";

/**
 * The places a photo can be added to, named in the Studio's language as Home's
 * Sessions list names them, each with how many of its photos the site shows
 * (Best picks fills 11; a service rail 8, graduation 3 more for its fan).
 */
async function placeOptions(): Promise<PlaceOption[]> {
  const locale = await getStudioLocale();
  const names = (await getDictionary(locale)).profile.sessionNames as Record<string, string | undefined>;
  return PLACES.map((id) => {
    if (id === BEST_PICKS_PLACE) return { id, shows: PICKS_WANTED };
    const slug = id.slice("service:".length);
    const service = getServiceBySlug(slug);
    return {
      id,
      title: names[slug] ?? (service ? pickLocale(service.title, locale) : slug),
      shows: service?.hero?.graphic === "stack" ? RAIL_COUNT + HERO_STACK_COUNT : RAIL_COUNT,
    };
  });
}

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
  const [{ photos, detailsReady, sets, setsReady }, pending, worker, targets] = await Promise.all([
    listStudioPhotoDetails(gallery),
    unfinishedUploads(session, gallery.id).catch(() => []),
    getWorkerStatus().catch(() => null),
    albumTargets(session, gallery.id).catch(() => ({ albums: [], categories: [] })),
  ]);

  const panel = (
    <UploadPanel
      galleryId={gallery.id}
      canUpload={Boolean(gallery.folder)}
      hasPhotos={photos.length > 0}
      pending={pending}
      worker={worker ? { online: worker.online, name: worker.name } : null}
      sets={sets}
    />
  );

  if (photos.length === 0) return panel;

  // Albums only: a client photo is published to an album before it can be
  // added anywhere, so its menu says that instead.
  const [places, placements] = await Promise.all([
    placeOptions(),
    gallery.kind === "album"
      ? placementState(
          session,
          photos.map((p) => p.id),
        ).catch((e: unknown) => {
          console.error(e instanceof Error ? e.message : e);
          return "failed" as const;
        })
      : null,
  ]);

  return (
    <>
      {panel}
      <StudioPhotoGrid
        galleryId={gallery.id}
        galleryTitle={gallery.title}
        kind={gallery.kind}
        photos={photos}
        albums={targets.albums}
        categories={targets.categories}
        places={places}
        placements={placements}
        detailsReady={detailsReady}
        siteHref={gallery.href}
        sets={sets}
        setsReady={setsReady}
      />
    </>
  );
}
