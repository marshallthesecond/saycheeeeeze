'use client';

// The small "?" beside a section heading, and the panel it opens.
//
// Not a paragraph on the page. The graduation notice says "this is my first
// season, and the pricing says so" — honest and worth saying, but printed
// inline under the description it's a caveat placed before anyone has decided
// they want the thing. Behind a question mark next to the prices it answers
// the question where the question is actually asked: why is this cheaper than
// I expected? The note isn't hidden; it sits where the doubt appears.
//
// Same panel as GalleryPickerSheet and DownloadSheet — bottom sheet on a
// phone, centred on desktop, backdrop tap and Escape to close, body scroll
// locked. A fourth dialog that behaved differently would be a bug with extra
// steps.

import { useEffect, useState } from 'react';
import { HelpCircle, X } from 'lucide-react';

interface Props {
  title: string;
  body: string;
  accent: string;
  /** Announced to screen readers on the trigger, since the icon says nothing. */
  triggerLabel: string;
  closeLabel: string;
}

export default function ServiceNotice({
  title,
  body,
  accent,
  triggerLabel,
  closeLabel,
}: Props) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        // 44px of tap target around a 16px icon. Sized to the icon it's a
        // coin-flip on a phone, and a mis-tap here does nothing visible.
        aria-label={triggerLabel}
        title={triggerLabel}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-foreground/10 hover:text-foreground/80 active:bg-foreground/15"
      >
        <HelpCircle className="h-4.5 w-4.5" />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-70 flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-t-3xl bg-card ring-1 ring-border sm:rounded-3xl"
            style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={title}
          >
            <div className="flex items-start justify-between gap-4 px-6 pt-6">
              <h2 className="text-lg font-bold text-foreground">{title}</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={closeLabel}
                className="-mr-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-foreground/10 text-foreground transition hover:bg-foreground/20"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <span
              aria-hidden
              className="mx-6 mt-4 block h-0.5 w-10 rounded-full"
              style={{ background: accent }}
            />

            <p className="px-6 pb-7 pt-4 text-sm leading-relaxed text-foreground/70">{body}</p>
          </div>
        </div>
      )}
    </>
  );
}
