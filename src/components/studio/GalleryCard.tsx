// One gallery on the Studio's Galleries screen.

import { ExternalLink, EyeOff, Images, Lock } from "lucide-react";
import PhotoFrame from "@/src/components/common/PhotoFrame";
import type { StudioGallery } from "@/src/lib/studio/galleries";

export interface CardLabels {
  kindAlbum: string;
  kindClient: string;
  private: string;
  hidden: string;
  view: string;
  /** Already counted and translated: "86 photos", "1 photo", "No photos yet". */
  photos: string;
}

const BADGE =
  "inline-flex items-center gap-1 rounded-md bg-black/70 px-1.5 py-1 text-[11px] font-medium leading-none text-white";

export default function GalleryCard({ gallery, labels }: { gallery: StudioGallery; labels: CardLabels }) {
  const hasCover = Boolean(gallery.cover);

  return (
    <article className="min-w-0">
      <div className="relative overflow-hidden rounded-xl ring-1 ring-border">
        <PhotoFrame
          ladder={gallery.cover}
          thumbhash={gallery.coverThumbhash}
          // Decorative here: the title is right underneath.
          alt=""
          // A gallery with no cover yet is a quiet tile, not its accent colour
          // at full strength across a third of the screen.
          accent={hasCover ? gallery.accent : "var(--muted)"}
          sizes="(min-width: 1536px) 18vw, (min-width: 1280px) 22vw, (min-width: 640px) 30vw, 46vw"
          className="aspect-[4/3] w-full"
        />

        {!hasCover && (
          <span className="absolute inset-0 grid place-items-center text-muted-foreground">
            <Images aria-hidden className="size-7" />
          </span>
        )}

        {(gallery.isPrivate || !gallery.isPublished) && (
          <span className="absolute left-2 top-2 flex flex-wrap gap-1">
            {gallery.isPrivate && (
              <span className={BADGE}>
                <Lock aria-hidden className="size-3" />
                {labels.private}
              </span>
            )}
            {!gallery.isPublished && (
              <span className={BADGE}>
                <EyeOff aria-hidden className="size-3" />
                {labels.hidden}
              </span>
            )}
          </span>
        )}
      </div>

      <h2 className="mt-2.5 truncate text-[15px] font-semibold leading-snug" title={gallery.title}>
        {gallery.title}
      </h2>
      <p className="mt-0.5 truncate text-[13px] text-muted-foreground">
        {gallery.kind === "client" ? labels.kindClient : labels.kindAlbum}, {labels.photos}
      </p>

      {gallery.isPublished && (
        <a
          href={gallery.href}
          target="_blank"
          rel="noopener"
          className="mt-1 inline-flex items-center gap-1 text-[13px] text-accent-warm underline-offset-4 hover:underline"
        >
          {labels.view}
          <ExternalLink aria-hidden className="size-3" />
        </a>
      )}
    </article>
  );
}
