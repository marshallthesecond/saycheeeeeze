// What can be done to one photo, from its ⋯ menu or its panel. The grid
// implements these with the server actions and keeps its tiles in step; the
// menu and the panel only call them. Each resolves to an error key under
// `errors`, or nothing when it worked.

import type { PhotoChanges } from "@/src/app/studio/gallery-actions";

export interface MoveTarget {
  /** An album's id, or "new". */
  to: string;
  /** For a new album. */
  title?: string;
  category?: string;
}

export interface PhotoOps {
  update(photoId: string, changes: PhotoChanges): Promise<string | undefined>;
  setCover(photoId: string): Promise<string | undefined>;
  /** Moves an album photo, publishes a client one. Resolves to the album's title when it worked. */
  move(photoId: string, target: MoveTarget): Promise<{ error?: string; album?: string }>;
  remove(photoId: string): Promise<string | undefined>;
  /** The original file's address. */
  original(photoId: string): Promise<{ url?: string; error?: string }>;
  /** Into another set of the gallery (one divided into sets). */
  toSet(photoIds: string[], setId: string): Promise<string | undefined>;
}
