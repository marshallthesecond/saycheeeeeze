
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getAlbumBySlug, getAllAlbumSlugs, getAlbumPhotos } from '@/src/lib/albums';
import { hasLadder, shareSrc } from '@/src/lib/ladder';
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

  /**
   * THE SHARE RENDITION, not the cover URL.
   *
   * `album.cover` is the untouched original, and for these albums that means
   * og:image was a 71 MB PNG on Mekhrangiz and 64 MB on Diyora. Every paste of
   * an album link into Telegram, WhatsApp or a DM sends a scraper after it —
   * and a scraper on a 71 MB file does not render a slow preview, it times out
   * and renders none, so the link that was meant to show the work shows a bare
   * URL instead.
   *
   * share.jpg is 2048px at q82, which the ladder already builds: around half a
   * megabyte, and comfortably over the 1200×630 any of them want. Social
   * scrapers do not read srcset, so this has to stay one plain URL — the same
   * reason the service pages use downloadSrc() rather than a rung.
   *
   * Falls back to the original when a cover has no ladder. A heavy preview
   * beats no preview, and an album in that state is one the worker has not
   * reached yet.
   */
  const ogImage = hasLadder(album.coverLadder)
    ? shareSrc(album.coverLadder)
    : album.cover;

  return {
    title: album.title,
    description,
    openGraph: {
      title: `${album.title} · saycheeeeeze`,
      description,
      type: 'article',
      images: [{ url: ogImage, alt: album.title }],
    },
    twitter: {
      card: 'summary_large_image',
      title: `${album.title} · saycheeeeeze`,
      description,
      images: [ogImage],
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