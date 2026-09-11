'use client';

// src/app/[locale]/services/[slug]/ServiceNotice.tsx
//
// The small "?" beside a section heading, and the panel it opens.
//
// ── Why this is not just a paragraph on the page ─────────────
// On the graduation page the notice says "this is my first season, and the
// pricing says so". That is honest and it is worth saying — but printed inline
// under the description it is a caveat placed before anyone has decided they
// want the thing, which is the worst possible moment for one. Behind a question
// mark next to the prices, it answers the question at the point the question is
// actually asked: why is this cheaper than I expected?
//
// So the note is not hidden. It sits exactly where the doubt appears.
//
// ── Shape ────────────────────────────────────────────────────
// Same panel as GalleryPickerSheet and DownloadSheet — bottom sheet on a phone,
// centred on a desktop, backdrop tap to close, Escape to close, body scroll
// locked. A fourth dialog in this app that behaved differently would be a bug
// with extra steps.

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
        // 44px of tap target around a 16px icon. An icon button sized to its
        // icon is a coin-flip on a phone, and this one sits next to a heading
        // where a mis-tap does nothing visible to correct itself.
        aria-label={triggerLabel}
        title={triggerLabel}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white/40 transition hover:bg-white/10 hover:text-white/80 active:bg-white/15"
      >
        <HelpCircle className="h-[18px] w-[18px]" />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-70 flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-t-3xl bg-neutral-950 ring-1 ring-white/10 sm:rounded-3xl"
            style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={title}
          >
            <div className="flex items-start justify-between gap-4 px-6 pt-6">
              <h2 className="text-lg font-bold text-white">{title}</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={closeLabel}
                className="-mr-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <span
              aria-hidden
              className="mx-6 mt-4 block h-0.5 w-10 rounded-full"
              style={{ background: accent }}
            />

            <p className="px-6 pb-7 pt-4 text-sm leading-relaxed text-white/70">{body}</p>
          </div>
        </div>
      )}
    </>
  );
}
