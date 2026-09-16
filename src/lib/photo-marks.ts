// What a client says they want done with one photograph.
//
// No secrets, no server imports: the API route, the gallery shell, the grid and
// the lightbox all read this file, and three of those run in the browser.
//
// A mark is a REQUEST, not an action. Nothing in this codebase deletes a file,
// publishes a photograph or moves anything because of one. The photographer
// reads them and does the work by hand — see the review queries at the bottom
// of the migration. That separation is the whole safety model: a client who
// taps the wrong button on a phone has changed a column, not lost a negative.

/** The three marks, in the order they are shown. */
export const PHOTO_MARKS = ['keep', 'publish', 'delete'] as const;

export type PhotoMark = (typeof PHOTO_MARKS)[number];

/** What the filter above the grid offers: the three, plus the two ends. */
export const MARK_FILTERS = ['all', ...PHOTO_MARKS, 'unmarked'] as const;

export type MarkFilter = (typeof MARK_FILTERS)[number];

/**
 * A value from the database, or from a request body, narrowed to a mark.
 *
 * Returns null for anything unrecognised rather than throwing. The column has
 * a CHECK constraint, so an unknown value means the constraint was changed and
 * this file was not — in which case showing the photograph as unmarked is the
 * conservative reading, and refusing to render the gallery is not.
 */
export function parseMark(value: unknown): PhotoMark | null {
  return typeof value === 'string' && (PHOTO_MARKS as readonly string[]).includes(value)
    ? (value as PhotoMark)
    : null;
}

/** The same, for a request body where `null` is a legitimate instruction —
 *  clearing a mark — and anything else is a bad request. */
export function parseMarkInput(value: unknown): { ok: true; mark: PhotoMark | null } | { ok: false } {
  if (value === null) return { ok: true, mark: null };
  const mark = parseMark(value);
  return mark ? { ok: true, mark } : { ok: false };
}

export function matchesFilter(mark: PhotoMark | null | undefined, filter: MarkFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'unmarked') return !mark;
  return mark === filter;
}

/**
 * Dictionary keys, so every label comes from one place and a missing
 * translation is a missing key rather than an English word on a Russian page.
 *
 * `toast` is the sentence shown when the button is pressed. The wording matters
 * more than it looks: "Marked for deletion" says a decision was RECORDED.
 * "Deleted" would be a lie, and the client's next question would be why the
 * photograph is still on screen.
 */
export const MARK_KEYS: Record<PhotoMark, { label: string; toast: string }> = {
  keep: { label: 'gallery.markKeep', toast: 'gallery.markedKeep' },
  publish: { label: 'gallery.markPublish', toast: 'gallery.markedPublish' },
  delete: { label: 'gallery.markDelete', toast: 'gallery.markedDelete' },
};

export const FILTER_KEYS: Record<MarkFilter, string> = {
  all: 'gallery.filterAll',
  keep: 'gallery.markKeep',
  publish: 'gallery.markPublish',
  delete: 'gallery.markDelete',
  unmarked: 'gallery.filterUnmarked',
};

/** English fallbacks, used until a key exists — see AlbumView's tx(). */
export const MARK_FALLBACK: Record<PhotoMark, { label: string; toast: string }> = {
  keep: { label: 'Keep', toast: 'Marked to keep' },
  publish: { label: 'Publish', toast: 'Marked as OK to publish' },
  delete: { label: 'Delete', toast: 'Marked for deletion' },
};

export const FILTER_FALLBACK: Record<MarkFilter, string> = {
  all: 'All',
  keep: 'Keep',
  publish: 'Publish',
  delete: 'Delete',
  unmarked: 'Unmarked',
};
