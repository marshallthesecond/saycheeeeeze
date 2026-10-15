import Link from "next/link";

interface ShelfProps {
  title: string;
  /**
   * One line under the heading, for a shelf whose title does not fully say
   * what is in it.
   *
   * Added for "Reference photos" on the About page: the pictures there are
   * mood references rather than Marshall's own work, and a rail of photographs
   * on a photographer's page is read as the photographer's unless something
   * says otherwise.
   */
  subtitle?: string;
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
  subtitle,
  showAllHref,
  showAllLabel = "Show all",
  children,
  className = "",
}: ShelfProps) {
  return (
    <section className={`relative z-10 ${className}`}>
      <div className="flex items-baseline justify-between px-4 sm:px-8 mb-3">
        <div className="min-w-0">
          <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight">{title}</h2>
          {subtitle && <p className="text-sm text-white/40 mt-1">{subtitle}</p>}
        </div>
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