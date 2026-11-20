// Shown on a service page opened from the Studio's Preview button: what you
// are looking at is the draft, not what visitors see. "Back to Studio" turns
// preview off and returns to the editor.

import { Eye } from 'lucide-react';

export default function PreviewBar({
  label,
  offNote,
  exitLabel,
  exitHref,
}: {
  label: string;
  /** Set when the service is turned off: visitors get Not found. */
  offNote?: string;
  exitLabel: string;
  exitHref: string;
}) {
  return (
    <div
      role="status"
      className="fixed inset-x-3 bottom-24 z-[60] mx-auto flex max-w-md items-center gap-3 rounded-[10px] border border-border bg-card/95 px-3 py-2 shadow-lg backdrop-blur sm:bottom-6"
    >
      <Eye aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      <p className="min-w-0 flex-1 text-xs leading-snug">
        <span className="font-semibold">{label}</span>
        {offNote && <span className="block text-muted-foreground">{offNote}</span>}
      </p>
      {/* A plain link, not next/link: the route has to run on the server to clear the preview cookie. */}
      <a href={exitHref} className="btn-glass inline-flex h-8 shrink-0 items-center whitespace-nowrap rounded-[10px] px-3 text-xs font-semibold">
        {exitLabel}
      </a>
    </div>
  );
}
