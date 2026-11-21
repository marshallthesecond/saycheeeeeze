"use client";

// The set open on a gallery's Photos tab: ?set=<id> in the Studio's address,
// so the grid and the upload panel above it agree on it (uploads land in the
// open set) and a reload keeps it. The first set when the address names none
// or one that is gone.
//
// The choice is also kept here, apart from the address: a save that ends in
// the router reading the page again writes the address the router knew
// before, which may not have the set in it. The address is put right again
// after that render.

import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { GallerySet } from "@/src/lib/gallery-sets";

const listeners = new Set<() => void>();
/** The set last opened on this page, whatever the address says now. */
let chosen: string | null = null;

function fromAddress(): string | null {
  return new URLSearchParams(window.location.search).get("set");
}

function read(): string | null {
  return chosen ?? fromAddress();
}

function subscribe(notify: () => void): () => void {
  listeners.add(notify);
  const onPop = () => {
    chosen = null;
    notify();
  };
  window.addEventListener("popstate", onPop);
  return () => {
    listeners.delete(notify);
    window.removeEventListener("popstate", onPop);
  };
}

function writeAddress(id: string) {
  const u = new URL(window.location.href);
  if (u.searchParams.get("set") === id) return;
  u.searchParams.set("set", id);
  window.history.replaceState(window.history.state, "", u.toString());
}

/** The open set's id (null: the gallery has no sets) and a way to open another. */
export function useActiveSet(sets: readonly GallerySet[]): [string | null, (id: string) => void] {
  const raw = useSyncExternalStore(subscribe, read, () => null);
  const id = sets.length === 0 ? null : sets.some((s) => s.id === raw) ? raw : sets[0].id;

  // The address follows the choice, again after any render that changed it.
  useEffect(() => {
    if (chosen && chosen === id) writeAddress(chosen);
  });

  const open = useCallback((next: string) => {
    chosen = next;
    writeAddress(next);
    listeners.forEach((notify) => notify());
  }, []);
  return [id, open];
}
