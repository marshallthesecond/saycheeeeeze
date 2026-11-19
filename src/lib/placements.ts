// Where a photograph can be shown besides its own album, chosen in the Studio
// from the menu on each photo ("Add to..."), like adding a song to a playlist
// (Marshall, 2026-11-19): the Best picks grid on Home, and the photo rail at
// the bottom of each service page Home lists under Sessions.
//
// Stored in photo_placements (supabase/migrations/20261119120000_photo_placements.sql),
// one row per photo per place, in order. Until that migration is run the
// site shows the lists in the code instead (BEST_PICKS, galleryPaths).
//
// No "server-only": the Studio's menu, the Studio's actions and the public
// pages all read the same list.

import { PROFILE } from "./profile";

export const BEST_PICKS_PLACE = "best-picks";

/** "service:portraits": the rail at the bottom of that service's page. */
export const servicePlace = (slug: string): string => `service:${slug}`;

/** The service pages that get a place: the ones Home lists under Sessions. */
export const PLACE_SERVICES: readonly string[] = PROFILE.sessions;

/** Every place, in the order the Studio's menu lists them. */
export const PLACES: readonly string[] = [BEST_PICKS_PLACE, ...PLACE_SERVICES.map(servicePlace)];

export const isPlace = (value: string): boolean => PLACES.includes(value);

/** Most photos one place can hold (the database refuses more). */
export const PLACE_MAX = 100;

/** Photos a service page's rail shows. */
export const RAIL_COUNT = 8;

/**
 * Photographs in the stack hero's fan (graduation). A stack-hero page takes
 * its fan from the same list, so its place shows this many more.
 */
export const HERO_STACK_COUNT = 3;
