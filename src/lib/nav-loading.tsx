"use client";

// src/lib/nav-loading.tsx
//
// "Is the app busy?" — the single piece of shared state the bottom nav's
// perimeter animation reads.
//
// ── What this used to miss ───────────────────────────────────
// There were exactly two ways to switch the animation on: `useLinkStatus()`
// inside the four links of the BottomNav itself, and a <NavLoadingBeacon /> in
// a route's loading.tsx. So tapping "Portfolio" in the nav lit it up, and
// tapping a service card, an album, a gallery, "Book a session" or the
// language switcher did not — which is most of the links on the site. The
// indicator was telling the truth about a small corner of the app and staying
// silent about the rest.
//
// Now the provider watches for navigation ITSELF, from any link anywhere, plus
// browser back/forward, and still accepts explicit begin()/end() for work that
// is not a navigation at all.
//
// ── Two kinds of busy, tracked separately ────────────────────
//   count      explicit begin()/end() pairs — Suspense fallbacks, and any
//              async operation that calls in. A COUNTER, not a boolean: two
//              things can run at once, and if the second finishes first a
//              boolean would switch the animation off while the first is still
//              going.
//   navPending one navigation in flight. Not a counter — there is only ever
//              one current navigation, and a second click replaces the first.

import {
  createContext,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * How long a navigation must be in flight before the animation appears.
 *
 * Without it, a route that resolves in 60 ms produces a flash of glow, which
 * reads as a glitch rather than as progress. Anything slower than this is long
 * enough for a person to notice the wait, which is exactly when the indicator
 * earns its place.
 */
const SHOW_DELAY_MS = 120;

/**
 * A navigation can be abandoned without ever landing — the user taps a second
 * link, the route throws, a prefetch races. Nothing would clear the flag, and
 * the nav would glow until the next page change. This is the backstop.
 */
const NAV_FAILSAFE_MS = 8_000;

interface NavLoadingValue {
  loading: boolean;
  begin: () => void;
  end: () => void;
}

const NavLoadingContext = createContext<NavLoadingValue | null>(null);

/**
 * Clears the pending flag once the URL has actually changed.
 *
 * useSearchParams is why this is a separate component inside <Suspense> rather
 * than a hook in the provider: used unwrapped it opts every page under this
 * layout out of static rendering. Confined here, the cost is one boundary and
 * the indicator stays correct for navigations that change only the query
 * string — /book?package=grad-campus-90m, for one.
 */
function NavigationSettled({ onSettled }: { onSettled: () => void }) {
  const pathname = usePathname();
  const search = useSearchParams();

  useEffect(() => {
    onSettled();
  }, [pathname, search, onSettled]);

  return null;
}

export function NavLoadingProvider({ children }: { children: React.ReactNode }) {
  const [count, setCount] = useState(0);
  const [navPending, setNavPending] = useState(false);
  const [navVisible, setNavVisible] = useState(false);

  const begin = useCallback(() => setCount((c) => c + 1), []);
  const end = useCallback(() => setCount((c) => Math.max(0, c - 1)), []);
  const settle = useCallback(() => setNavPending(false), []);

  // Hold the indicator back briefly, then give up on it entirely if the
  // navigation never lands.
  useEffect(() => {
    if (!navPending) {
      setNavVisible(false);
      return;
    }
    const show = setTimeout(() => setNavVisible(true), SHOW_DELAY_MS);
    const giveUp = setTimeout(() => setNavPending(false), NAV_FAILSAFE_MS);
    return () => {
      clearTimeout(show);
      clearTimeout(giveUp);
    };
  }, [navPending]);

  // ── Every internal link on the page, not just the ones in the nav ──
  //
  // Capture phase, so this still sees the click if a handler further down
  // stops propagation. It only observes — it never prevents the default, so
  // Next's own router handling is untouched.
  useEffect(() => {
    function onClick(event: MouseEvent) {
      // Left button, no modifier: anything else opens a new tab or window and
      // leaves this page exactly where it is.
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest("a");
      if (!(anchor instanceof HTMLAnchorElement)) return;

      // target="_blank", downloads and mailto:/tel:/https://t.me all leave the
      // app rather than navigating inside it.
      if (anchor.target && anchor.target !== "_self") return;
      if (anchor.hasAttribute("download")) return;

      let url: URL;
      try {
        url = new URL(anchor.href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return;

      // A bare #hash, or a link back to the page we are already on, is not a
      // navigation anyone waits for.
      if (
        url.pathname === window.location.pathname &&
        url.search === window.location.search
      ) {
        return;
      }

      setNavPending(true);
    }

    document.addEventListener("click", onClick, { capture: true });
    return () => document.removeEventListener("click", onClick, { capture: true });
  }, []);

  // Back and forward are navigations too, and they can be just as slow.
  useEffect(() => {
    const onPopState = () => setNavPending(true);
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const value = useMemo<NavLoadingValue>(
    () => ({ loading: count > 0 || navVisible, begin, end }),
    [count, navVisible, begin, end],
  );

  return (
    <NavLoadingContext.Provider value={value}>
      <Suspense fallback={null}>
        <NavigationSettled onSettled={settle} />
      </Suspense>
      {children}
    </NavLoadingContext.Provider>
  );
}

/** Degrades to "never loading" outside a provider rather than throwing. */
export function useNavLoading(): NavLoadingValue {
  return useContext(NavLoadingContext) ?? { loading: false, begin: () => {}, end: () => {} };
}

/**
 * Drop into any loading.tsx (or any component that represents a busy state).
 * Renders nothing; turns the nav animation on while it is mounted and off when
 * it unmounts — which is exactly the lifetime of a Suspense fallback.
 */
export function NavLoadingBeacon() {
  const { begin, end } = useNavLoading();

  useEffect(() => {
    begin();
    return end;
  }, [begin, end]);

  return null;
}

/**
 * Wraps an async operation so the nav reports it.
 *
 *     const busy = useBusy();
 *     await busy(() => fetch(...));
 *
 * For work that is not a navigation and has no Suspense boundary — submitting
 * the booking form, unlocking a gallery, building a ZIP. The nav has no way to
 * know about any of those on its own.
 */
export function useBusy(): <T>(run: () => Promise<T>) => Promise<T> {
  const { begin, end } = useNavLoading();

  return useCallback(
    async <T,>(run: () => Promise<T>): Promise<T> => {
      begin();
      try {
        return await run();
      } finally {
        end();
      }
    },
    [begin, end],
  );
}
