
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getAlbumBySlug, getAllAlbumSlugs, getAlbumPhotos } from '@/src/lib/albums';
import AlbumView from './AlbumView';

export async function generateStaticParams() {
  return (await getAllAlbumSlugs()).map((slug) => ({ slug }));
}

// Per-album metadata, so a shared link shows that album's cover and title
// rather than the generic site card.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const album = await getAlbumBySlug(slug);
  if (!album) return { title: 'Album not found' };

  const description =
    album.description ||
    `${album.title} — photographed in ${album.location}, ${album.year}.`;

  return {
    title: album.title,
    description,
    openGraph: {
      title: `${album.title} · saycheeeeeze`,
      description,
      type: 'article',
      images: [{ url: album.cover, alt: album.title }],
    },
    twitter: {
      card: 'summary_large_image',
      title: `${album.title} · saycheeeeeze`,
      description,
      images: [album.cover],
    },
  };
}

export default async function AlbumPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const album = await getAlbumBySlug(slug);
  if (!album) notFound();

  // Live list from the album's Bunny folder if it has one, else the hardcoded
  // `photos` array.
  const photos = await getAlbumPhotos(album);

  return <AlbumView album={{ ...album, photos }} />;
}