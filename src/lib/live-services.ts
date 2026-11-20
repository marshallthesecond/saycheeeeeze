// The services as the site shows them: the code (services.ts) with what was
// published in the Studio's Services tab laid over it, and the services
// turned off marked `off`. See service-content.ts for the shape.
//
// Every page that shows a service reads through here, and so does the server
// that prices a booking, so the page and the price can never disagree.
//
// Cached under the tag "services": a Publish or the on/off switch in the
// Studio expires it (src/app/studio/service-actions.ts), and so does
// /api/sync?only=revalidate when the Studio runs somewhere else.
//
// Before 20261120120000_service_content.sql is run, or if the database cannot
// be reached, the code's version shows: the site never breaks for want of it.

import "server-only";

import { unstable_cache } from "next/cache";
import { applyOverlay, parseContent, type ServiceOverlay } from "./service-content";
import { servicesData, type ServiceData } from "./services";
import { supabaseRead, withRetry } from "./supabase";

const REVALIDATE_SECONDS = 3600;

function isMissingTable(error: { code?: string; message?: string }): boolean {
  return error.code === "PGRST205" || error.code === "42P01" || /service_content/.test(error.message ?? "");
}

const loadOverlay = unstable_cache(
  async (): Promise<ServiceOverlay> => {
    const { data, error } = await supabaseRead()
      .from("service_content")
      .select("slug, enabled, published")
      .order("slug", { ascending: true });

    if (error) {
      if (isMissingTable(error)) return {};
      throw new Error(`Supabase: failed to load the services: ${error.message}`);
    }

    const overlay: ServiceOverlay = {};
    for (const row of data ?? []) {
      const service = servicesData.find((s) => s.slug === row.slug);
      if (!service || overlay[row.slug]) continue;
      let content = null;
      if (row.published !== null) {
        content = parseContent(row.published, service);
        if (!content) console.error(`[services] The published "${row.slug}" is not valid content; showing the code's version.`);
      }
      overlay[row.slug] = { off: !row.enabled, content };
    }
    return overlay;
  },
  ["service-content"],
  { revalidate: REVALIDATE_SECONDS, tags: ["services"] },
);

/**
 * What the Studio has published and turned off, by slug. JSON-safe, so a page
 * can hand it to a Client Component (the booking form) to apply itself.
 */
export async function getServiceOverlay(): Promise<ServiceOverlay> {
  try {
    return await withRetry("services", loadOverlay);
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    console.warn(`[services] Could not load the Studio's services, showing the code's: ${why}`);
    return {};
  }
}

/** Every service, as the site shows it. Services turned off are in it, marked `off`. */
export async function getLiveServices(): Promise<ServiceData[]> {
  return applyOverlay(servicesData, await getServiceOverlay());
}

/** One service as the site shows it, off or not; undefined if there is no such service. */
export async function getLiveService(slug: string): Promise<ServiceData | undefined> {
  return (await getLiveServices()).find((s) => s.slug === slug);
}
