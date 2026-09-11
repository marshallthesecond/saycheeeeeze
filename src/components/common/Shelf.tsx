import Link from "next/link";

interface ShelfProps {
  title: string;
  /** When set, renders a "Show all" link on the right of the heading. */
  showAllHref?: string;
  showAllLabel?: string;
  children: React.ReactNode;
  className?: string;
}

/**
 * Spotify's core layout unit: a bold section title with an optional "Show all"
 * on the right, above a horizontally scrolling rail that snaps to each card
 * and bleeds off the right edge so it reads as scrollable.
 */
export default function Shelf({
  title,
  showAllHref,
  showAllLabel = "Show all",
  children,
  className = "",
}: ShelfProps) {
  return (
    <section className={`relative z-10 ${className}`}>
      <div className="flex items-baseline justify-between px-4 sm:px-8 mb-3">
        <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight">{title}</h2>
        {showAllHref && (
          <Link
            href={showAllHref}
            className="text-[11px] font-bold uppercase tracking-widest text-white/50 hover:text-white active:text-white/80 transition shrink-0 ml-4"
          >
            {showAllLabel}
          </Link>
        )}
      </div>

      <div
        className="flex gap-3 overflow-x-auto [&::-webkit-scrollbar]:hidden
                   px-4 sm:px-8 pb-2 snap-x snap-mandatory scroll-px-4 sm:scroll-px-8"
      >
        {children}
      </div>
    </section>
  );
}