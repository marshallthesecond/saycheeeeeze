"use client";

// "Is the app busy?" — what the bottom nav's perimeter animation reads.
//
// `count` is a counter, not a boolean: two things can be loading at once, and
// if the second finishes first a boolean would stop the animation early.
// `navPending` is separate because there is only ever one current navigation.
//
// The provider detects navigation itself, so any link on the page counts — not
// just the four in the nav.

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

/** Delay before the animation appears. Without it a route that resolves in
 *  60ms produces a flash of glow, which reads as a glitch. */
const SHOW_DELAY_MS = 120;

/** A navigation can be abandoned and never land — a second click, a throw, a
 *  prefetch race. Nothing else would clear the flag. */
const NAV_FAILSAFE_MS = 8_000;

interface NavLoadingValue {
  loading: boolean;
  begin: () => void;
  end: () => void;
}

const NavLoadingContext = createContext<NavLoadingValue | null>(null);

/** Clears the flag once the URL has changed. Separate and inside <Suspense>
 *  because useSearchParams unwrapped would opt every page under this layout
 *  out of static rendering. */
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

  // Capture phase, so this still sees the click if something downstream stops
  // propagation. It only observes and never calls preventDefault, so Next's
  // own router handling is untouched.
  useEffect(() => {
    function onClick(event: MouseEvent) {
      // Anything else opens a new tab and leaves this page where it is.
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest("a");
      if (!(anchor instanceof HTMLAnchorElement)) return;

      if (anchor.target && anchor.target !== "_self") return;
      if (anchor.hasAttribute("download")) return;

      let url: URL;
      try {
        url = new URL(anchor.href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return;

      // A bare #hash, or a link to the page we are already on.
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

  // Back and forward are navigations too, and can be just as slow.
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

/** Drop into a loading.tsx. Renders nothing; on while mounted. */
export function NavLoadingBeacon() {
  const { begin, end } = useNavLoading();

  useEffect(() => {
    begin();
    return end;
  }, [begin, end]);

  return null;
}

/** For async work with no Suspense boundary — submitting the booking form,
 *  unlocking a gallery, building a ZIP. `await busy(() => fetch(...))`. */
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
