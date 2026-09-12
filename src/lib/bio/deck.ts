// No repeats until every variant has been shown.
//
// A shuffled deck rather than a dice roll: shuffle all N indices once, deal
// one per browser session, reshuffle when the deck runs out. A variant can
// only come round again after the others have had their turn.
//
// Two storages on purpose. localStorage holds the deck, which has to outlive
// the session or it resets every visit and repeats immediately; sessionStorage
// holds this session's dealt card and whether it has been typed out yet.
//
// Every access is wrapped — Safari in private mode throws on write and some
// hardened browsers throw on read. A storage failure degrades to "random each
// time", which is worse but never a crash.

const DECK_KEY = "sc.bio.deck.v1";
const LAST_KEY = "sc.bio.last.v1";
const SESSION_KEY = "sc.bio.session.v1";

export interface BioSession {
  /** Index into the current locale's variants array. */
  index: number;
  /** True once the typewriter has finished — stops it replaying on soft nav. */
  typed: boolean;
}

function readLocal(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocal(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* private mode / quota — rotation degrades, page still works */
  }
}

function shuffle(n: number): number[] {
  const a = Array.from({ length: n }, (_, i) => i);
  // Fisher-Yates. Every permutation equally likely, unlike sort(() => 0.5 - r).
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = a[i]!;
    a[i] = a[j]!;
    a[j] = tmp;
  }
  return a;
}

/** Deals the next index and persists the remaining deck. `poolSize` comes
 *  from the loaded variants array, so adding bios to the files is all there is
 *  to do — no count to keep in sync here. */
export function drawIndex(poolSize: number): number {
  if (poolSize <= 0) return -1;

  const lastRaw = readLocal(LAST_KEY);
  const last = lastRaw === null ? null : Number.parseInt(lastRaw, 10);

  let deck: number[] = [];
  try {
    const parsed: unknown = JSON.parse(readLocal(DECK_KEY) ?? "null");
    if (Array.isArray(parsed)) {
      // Drop anything out of range, so shrinking or reordering the pool can't
      // strand the deck on indices that no longer exist. New variants join at
      // the next reshuffle.
      deck = parsed.filter(
        (v): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v < poolSize
      );
    }
  } catch {
    deck = [];
  }

  if (deck.length === 0) {
    deck = shuffle(poolSize);
    // Guards the seam between two decks: the last card of one shuffle and the
    // first of the next could otherwise match, which is the one repeat a
    // visitor would actually notice.
    if (deck.length > 1 && last !== null && deck[0] === last) {
      const head = deck[0]!;
      deck[0] = deck[1]!;
      deck[1] = head;
    }
  }

  const next = deck.shift()!;
  writeLocal(DECK_KEY, JSON.stringify(deck));
  writeLocal(LAST_KEY, String(next));
  return next;
}

/**
 * Reads this session's dealt card.
 *
 * Pass `poolSize` when you're about to index into a variants array and the
 * index gets wrapped into range — covering a pool that shrank mid-session, or
 * locale files that are out of sync. Omit it if you only want `typed`.
 */
export function readSession(poolSize?: number): BioSession | null {
  try {
    const parsed: unknown = JSON.parse(window.sessionStorage.getItem(SESSION_KEY) ?? "null");
    if (!parsed || typeof parsed !== "object") return null;
    const { index, typed } = parsed as Partial<BioSession>;
    if (typeof index !== "number" || !Number.isInteger(index) || index < 0) return null;
    return {
      index: poolSize && poolSize > 0 ? index % poolSize : index,
      typed: typed === true,
    };
  } catch {
    return null;
  }
}

export function writeSession(session: BioSession): void {
  try {
    window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    /* no-op */
  }
}

/** Escape hatch for the console if you want to watch the rotation while testing. */
export function resetBioDeck(): void {
  try {
    window.localStorage.removeItem(DECK_KEY);
    window.localStorage.removeItem(LAST_KEY);
    window.sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* no-op */
  }
}