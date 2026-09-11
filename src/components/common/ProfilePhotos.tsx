"use client";

import Image from "next/image";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type ProfilePhotosProps = {
  images: string[];
  alt?: string;
  interval?: number;
  className?: string;
};

const FRAME_W = "w-[min(76vw,19rem)] sm:w-[19rem] lg:w-[21rem]";

export default function ProfilePhotos({
  images,
  alt = "Marshall — photographer in Tashkent",
  interval = 4000,
  className = "",
}: ProfilePhotosProps) {
  const [index, setIndex] = useState(0);
  const [open, setOpen] = useState(false);

  const count = images.length;

  useEffect(() => {
    if (count < 2 || open) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const id = window.setInterval(
      () => setIndex((i) => (i + 1) % count),
      interval
    );
    return () => window.clearInterval(id);
  }, [count, open, interval]);

  if (count === 0) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Open photos (${index + 1} of ${count})`}
        className={
          "relative shrink-0 w-18 h-22 sm:w-28 sm:h-34 rounded-2xl overflow-hidden " +
          "border border-white/8 bg-white/5 cursor-zoom-in " +
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 " +
          className
        }
      >
        {images.map((src, i) => (
          <Image
            key={src}
            src={src}
            alt={i === index ? alt : ""}
            fill
            sizes="(min-width: 640px) 112px, 72px"
            priority={i === 0}
            className={`object-cover transition-opacity duration-700 ease-out ${
              i === index ? "opacity-100" : "opacity-0"
            }`}
          />
        ))}

        {count > 1 && (
          <span className="pointer-events-none absolute inset-x-1.5 top-1.5 flex gap-1">
            {images.map((src, i) => (
              <span
                key={src}
                className={`h-0.5 flex-1 rounded-full transition-colors duration-300 ${
                  i === index ? "bg-white/90" : "bg-white/30"
                }`}
              />
            ))}
          </span>
        )}
      </button>

      {open && (
        <PhotoViewer
          images={images}
          alt={alt}
          startIndex={index}
          onIndexChange={setIndex}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

type ViewerProps = {
  images: string[];
  alt: string;
  startIndex: number;
  onIndexChange: (i: number) => void;
  onClose: () => void;
};

function PhotoViewer({
  images,
  alt,
  startIndex,
  onIndexChange,
  onClose,
}: ViewerProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const slideRefs = useRef<(HTMLDivElement | null)[]>([]);
  const rafRef = useRef(0);
  const settleRef = useRef(0);
  const [mounted, setMounted] = useState(false);
  const [shown, setShown] = useState(false);
  const [active, setActive] = useState(startIndex);
  const count = images.length;

  useEffect(() => setMounted(true), []);

  const offsetOf = useCallback((i: number) => {
    const slide = slideRefs.current[i];
    return slide ? slide.offsetLeft : null;
  }, []);

  const nearestIndex = useCallback(() => {
    const el = trackRef.current;
    if (!el) return 0;
    let best = 0;
    let bestGap = Infinity;
    for (let i = 0; i < slideRefs.current.length; i++) {
      const left = offsetOf(i);
      if (left === null) continue;
      const gap = Math.abs(left - el.scrollLeft);
      if (gap < bestGap) {
        bestGap = gap;
        best = i;
      }
    }
    return best;
  }, [offsetOf]);

  const scrollTo = useCallback(
    (i: number, smooth = true) => {
      const el = trackRef.current;
      const left = offsetOf(i);
      if (!el || left === null) return;
      el.scrollTo({ left, behavior: smooth ? "smooth" : "auto" });
    },
    [offsetOf]
  );

  useLayoutEffect(() => {
    if (!mounted) return;
    scrollTo(startIndex, false);
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, [mounted, startIndex, scrollTo]);

  const close = useCallback(() => {
    setShown(false);
    window.setTimeout(onClose, 160);
  }, [onClose]);

  useEffect(() => onIndexChange(active), [active, onIndexChange]);

  useEffect(() => {
    const { overflow, paddingRight } = document.body.style;
    const gap = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = "hidden";
    if (gap > 0) document.body.style.paddingRight = `${gap}px`;
    return () => {
      document.body.style.overflow = overflow;
      document.body.style.paddingRight = paddingRight;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "ArrowRight") scrollTo(Math.min(active + 1, count - 1));
      if (e.key === "ArrowLeft") scrollTo(Math.max(active - 1, 0));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, count, close, scrollTo]);

  useEffect(() => {
    const onResize = () => scrollTo(active, false);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [active, scrollTo]);

  useEffect(() => {
    return () => {
      cancelAnimationFrame(rafRef.current);
      window.clearTimeout(settleRef.current);
    };
  }, []);

  const handleScroll = () => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      const i = nearestIndex();
      setActive((p) => (p === i ? p : i));
    });

    window.clearTimeout(settleRef.current);
    settleRef.current = window.setTimeout(() => {
      const el = trackRef.current;
      if (!el) return;
      const i = nearestIndex();
      const left = offsetOf(i);
      if (left === null) return;
      if (Math.abs(el.scrollLeft - left) > 0.5) {
        el.scrollTo({ left, behavior: "auto" });
      }
    }, 130);
  };

  if (!mounted) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Photos"
      onClick={(e) => e.target === e.currentTarget && close()}
      className={`fixed inset-0 z-100 flex flex-col items-center justify-center bg-black/85 backdrop-blur-xl transition-opacity duration-200 ${
        shown ? "opacity-100" : "opacity-0"
      }`}
    >
      <button
        type="button"
        onClick={close}
        aria-label="Close"
        className="absolute right-4 z-30 grid h-9 w-9 place-items-center rounded-full bg-white/8 text-white/70 backdrop-blur transition hover:bg-white/16 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
        style={{ top: "calc(1rem + env(safe-area-inset-top))" }}
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>

      <div className="relative w-full">
        <div
          ref={trackRef}
          onScroll={handleScroll}
          className="relative flex w-full snap-x snap-mandatory overflow-x-auto overflow-y-hidden overscroll-x-contain scroll-p-0 scrollbar-none [&::-webkit-scrollbar]:hidden"
        >
          {images.map((src, i) => (
            <div
              key={src}
              ref={(node) => {
                slideRefs.current[i] = node;
              }}
              className="relative flex w-full shrink-0 snap-start snap-always items-center justify-center"
            >
              <span className="absolute inset-0" onClick={close} />

              <div
                className={`relative z-10 shrink-0 overflow-hidden rounded-3xl bg-white/5 ring-1 ring-white/10 shadow-[0_24px_60px_-12px_rgba(0,0,0,0.9)] aspect-4/5 ${FRAME_W} transition-transform duration-200 ease-out ${
                  shown ? "scale-100" : "scale-95"
                }`}
              >
                <Image
                  src={src}
                  alt={`${alt} — photo ${i + 1} of ${count}`}
                  fill
                  sizes="(min-width: 1024px) 336px, (min-width: 640px) 304px, 76vw"
                  priority={i === startIndex}
                  className="object-cover"
                  draggable={false}
                />

                {count > 1 && (
                  <>
                    <button
                      type="button"
                      aria-label="Previous photo"
                      onClick={() => scrollTo(Math.max(i - 1, 0))}
                      className="absolute inset-y-0 left-0 w-1/2 cursor-default focus-visible:outline-none"
                    />
                    <button
                      type="button"
                      aria-label="Next photo"
                      onClick={() => scrollTo(Math.min(i + 1, count - 1))}
                      className="absolute inset-y-0 right-0 w-1/2 cursor-default focus-visible:outline-none"
                    />
                  </>
                )}
              </div>
            </div>
          ))}
        </div>

        {count > 1 && (
          <div className="pointer-events-none absolute inset-0 hidden items-center justify-center gap-3 sm:flex">
            <NavArrow dir="left" disabled={active === 0} onClick={() => scrollTo(active - 1)} />
            <div className={`${FRAME_W} shrink-0`} />
            <NavArrow dir="right" disabled={active === count - 1} onClick={() => scrollTo(active + 1)} />
          </div>
        )}
      </div>

      {count > 1 && (
        <div className={`${FRAME_W} mt-5 flex shrink-0 items-center gap-3`}>
          <div className="flex flex-1 gap-1">
            {images.map((src, i) => (
              <button
                key={src}
                type="button"
                onClick={() => scrollTo(i)}
                aria-label={`Photo ${i + 1}`}
                aria-current={i === active}
                className="group h-4 flex-1 focus-visible:outline-none"
              >
                <span
                  className={`block h-0.5 w-full rounded-full transition-colors ${
                    i === active ? "bg-white" : "bg-white/20 group-hover:bg-white/45"
                  }`}
                />
              </button>
            ))}
          </div>
          <span className="font-mono text-[10px] tabular-nums tracking-[0.14em] text-white/40">
            {active + 1}/{count}
          </span>
        </div>
      )}
    </div>,
    document.body
  );
}

function NavArrow({
  dir,
  disabled,
  onClick,
}: {
  dir: "left" | "right";
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={dir === "left" ? "Previous photo" : "Next photo"}
      className="pointer-events-auto grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/8 text-white/70 backdrop-blur transition hover:bg-white/16 hover:text-white disabled:pointer-events-none disabled:opacity-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d={dir === "left" ? "M15 5l-7 7 7 7" : "M9 5l7 7-7 7"} />
      </svg>
    </button>
  );
}