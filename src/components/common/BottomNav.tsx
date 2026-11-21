"use client";

import Link, { useLinkStatus } from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useSyncExternalStore } from 'react';
import { ArrowUp, Camera, House, User } from 'lucide-react';
import NavPerimeterGlow from "@/src/components/common/NavPerimeterGlow";
import { useNavLoading } from "@/src/lib/nav-loading";
import { useT } from "@/src/lib/i18n/LanguageProvider";

// How far down the landing page the nav stays hidden, in *small* viewport
// heights. Scene 1 is 190svh tall (100 of entry + 90 of pinned choreography),
// and the nav should arrive as that scene finishes rather than sitting on top
// of the hand-off. Keep this in step with the `hook` entry in SCENES in
// LandingPage.tsx.
const REVEAL_AT = -1;

// The threshold in px, measured rather than derived from innerHeight.
//
// This used to be `window.innerHeight * REVEAL_AT`, which is the *dynamic*
// viewport — it grows by ~9% the moment the mobile URL bar collapses. The
// landing page's scenes are sized in svh, which does not. So the reveal point
// moved down the page as you scrolled, and near the boundary the nav could
// appear, then disappear again as the bar animated, without the reader having
// scrolled back at all. svh is the unit the page is actually built in, so it is
// the unit this threshold has to be in too.
let revealPx = 0;

function measureSvh(): number {
  const probe = document.createElement('div');
  probe.style.cssText =
    'position:absolute;top:0;left:0;width:0;height:100svh;visibility:hidden;pointer-events:none';
  document.documentElement.appendChild(probe);
  // Zero if the browser has no svh unit; innerHeight is the honest fallback.
  const svh = probe.getBoundingClientRect().height || window.innerHeight || 1;
  probe.remove();
  return svh;
}

// Subscribing to scroll through useSyncExternalStore rather than a
// useState/useEffect pair means the value is right on the first client render —
// someone who reloads halfway down the page doesn't get a nav that flashes in a
// moment later. The SSR snapshot is false, matching a fresh load at the top.
function subscribeToScroll(onChange: () => void): () => void {
  let lastW = -1;
  const remeasure = () => {
    // Only a width or orientation change can move svh. A URL bar collapsing
    // fires resize too, and must be ignored here.
    const w = window.innerWidth;
    if (w === lastW) return;
    lastW = w;
    revealPx = measureSvh() * REVEAL_AT;
    onChange();
  };
  const onResize = () => {
    remeasure();
    onChange();
  };
  remeasure();
  window.addEventListener('scroll', onChange, { passive: true });
  window.addEventListener('resize', onResize, { passive: true });
  window.addEventListener('orientationchange', onResize, { passive: true });
  return () => {
    window.removeEventListener('scroll', onChange);
    window.removeEventListener('resize', onResize);
    window.removeEventListener('orientationchange', onResize);
  };
}

function isPastHero(): boolean {
  return window.scrollY > (revealPx || window.innerHeight * REVEAL_AT);
}

// The back-to-top button (2026-11-14) appears once the reader is a full screen
// down, and never before 600px, so a short page never shows it.
function subscribeToDepth(onChange: () => void): () => void {
  window.addEventListener('scroll', onChange, { passive: true });
  window.addEventListener('resize', onChange, { passive: true });
  return () => {
    window.removeEventListener('scroll', onChange);
    window.removeEventListener('resize', onChange);
  };
}

function isFarDown(): boolean {
  return window.scrollY > Math.max(600, window.innerHeight);
}

function scrollToTop() {
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  window.scrollTo({ top: 0, behavior: still ? 'auto' : 'smooth' });
}

/**
 * Reports the enclosing <Link>'s pending state to the shared nav-loading state.
 *
 * useLinkStatus only works from inside a <Link> subtree — that scoping is
 * deliberate on Next's part, and it is why there is no global equivalent. This
 * renders nothing; it exists purely to bridge that per-link signal out to the
 * nav's own border animation.
 */
function LinkPendingBridge() {
  const { pending } = useLinkStatus();
  const { begin, end } = useNavLoading();

  useEffect(() => {
    if (!pending) return;
    begin();
    return end;
  }, [pending, begin, end]);

  return null;
}

function BottomNavItem({
  icon, label, href, active,
}: {
  icon: React.ReactNode;
  label: string;
  href: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      // min-w/min-h 44px keeps every target within Apple's HIG tap-size guidance
      // Narrow phones (under 380px) get slightly tighter tabs, so the pill and
      // the back-to-top button fit side by side even in Uzbek.
      className={`flex flex-col items-center justify-center gap-1 rounded-xl min-w-16 min-h-11 px-2.5 py-1.5 max-[379px]:min-w-14 max-[379px]:px-1.5 transition
        ${active
          ? 'text-accent-warm bg-foreground/8'
          : 'text-muted-foreground hover:text-foreground active:bg-foreground/5'}`}
    >
      <LinkPendingBridge />
      {icon}
      <span className="text-[10px] leading-none whitespace-nowrap">{label}</span>
    </Link>
  );
}

// `loading` is an optional manual override; left undefined the nav follows the
// shared NavLoading state (see src/lib/nav-loading.tsx).
export default function BottomNav({ loading }: { loading?: boolean }) {
  const { loading: routeLoading } = useNavLoading();
  const busy = loading ?? routeLoading;
  const pathname = usePathname();
  const { t, locale } = useT();

  // Routes are locale-prefixed (/en/about, /ru/book), so strip the locale
  // segment before matching — otherwise nothing ever highlights.
  const rest = '/' + pathname.split('/').filter(Boolean).slice(1).join('/');
  const isHome      = rest === '/';
  // The galleries and the portfolio are on About since 2026-11-22, so an
  // album is under About too.
  const isAbout     = rest === '/about' || rest.startsWith('/albums');
  const isBook      = rest.startsWith('/book');

  // The landing page opens on a full-screen 3D scene with its own header, and a
  // floating pill over the hero would fight it. Everywhere else the nav is
  // there from the start.
  const pastHero = useSyncExternalStore(subscribeToScroll, isPastHero, () => false);
  const shown = !isHome || pastHero;
  const farDown = useSyncExternalStore(subscribeToDepth, isFarDown, () => false);
  const showTop = shown && farDown;

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 flex justify-center pointer-events-none"
      // Sits above the iOS home indicator instead of underneath it.
      style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 0.75rem)" }}
    >
      {/* The pill and the back-to-top button sit side by side with a small
          gap. The button's slot grows from nothing, so the pair stays centred
          and the pill glides aside to make room rather than jumping. */}
      <div className="flex items-stretch">
        <div
          aria-hidden={!shown}
          // `invisible` alongside the fade, not instead of it: opacity 0 plus
          // pointer-events: none still leaves three links in the tab order, so a
          // keyboard reader landing on the homepage tabbed straight into a nav
          // nobody can see. visibility transitions discretely — it holds
          // `visible` for the whole fade-out and only flips at the end — so
          // adding it to the transition list costs nothing visually.
          //
          // sc-glass (globals.css) is the look: frosted glass with a lit top
          // edge, a sheen and a deeper shadow, so the pill separates from busy
          // photos without getting any bigger.
          className={`sc-glass rounded-2xl flex items-center gap-1 p-1.5 max-[379px]:gap-0.5 max-[379px]:p-1
            transition-[opacity,transform,visibility] duration-500 ease-out
            ${shown
              ? 'pointer-events-auto visible opacity-100 translate-y-0'
              : 'pointer-events-none invisible opacity-0 translate-y-4'}`}
        >
          {/* Absolutely positioned overlay — adds no layout, no size, no spacing. */}
          <NavPerimeterGlow active={busy && shown} />

          {/* Home is the site root since 2026-11-10 — the three-column profile
              page — and About is its own page again, so both get a tab. */}
          <BottomNavItem
            icon={<House className="w-5 h-5" />}
            label={t("nav.home")}
            href={`/${locale}`}
            active={isHome}
          />
          <BottomNavItem
            icon={<Camera className="w-5 h-5" />}
            label={t("nav.book")}
            href={`/${locale}/book`}
            active={isBook}
          />
          <BottomNavItem
            icon={<User className="w-5 h-5" />}
            label={t("nav.about")}
            href={`/${locale}/about`}
            active={isAbout}
          />
        </div>

        {/* Back to top. Same height as the pill (the row stretches it), its own
            piece of glass, 8px away. */}
        <div
          aria-hidden={!showTop}
          // Left out on screens under 340px, where the pill alone fills the width.
          className={`flex max-[339px]:hidden transition-[width,margin-left,opacity,transform,visibility] duration-300 ease-out
            ${showTop
              ? 'w-15 max-[379px]:w-11 ml-2 opacity-100 scale-100 visible pointer-events-auto'
              : 'w-0 ml-0 opacity-0 scale-75 invisible pointer-events-none'}`}
        >
          <button
            type="button"
            onClick={scrollToTop}
            aria-label={t("nav.toTop")}
            title={t("nav.toTop")}
            tabIndex={showTop ? 0 : -1}
            className="sc-glass flex w-15 max-[379px]:w-11 shrink-0 items-center justify-center rounded-2xl text-foreground/80 transition hover:text-foreground active:scale-95"
          >
            <ArrowUp className="w-5 h-5" />
          </button>
        </div>
      </div>
    </nav>
  );
}