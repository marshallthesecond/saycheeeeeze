// The Services tab's Preview button: turns on Next's draft mode for this
// browser and opens the service page, which then shows the draft instead of
// what is published (see serviceFor() in services/[slug]/page.tsx). Only for
// someone signed in to the Studio: the page reads the draft as them, so the
// cookie alone shows nobody anything.
//
//   GET /api/studio/preview?slug=portraits          preview on, to the page
//   GET /api/studio/preview?slug=portraits&exit=1   preview off, back to the editor

import { draftMode } from "next/headers";
import { redirect } from "next/navigation";
import { STUDIO_LOGIN, studioServicePath, STUDIO_SERVICES } from "@/src/lib/studio/config";
import { getStudioLocale } from "@/src/lib/studio/locale";
import { getStudioState } from "@/src/lib/studio/session";
import { servicesData } from "@/src/lib/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const params = new URL(req.url).searchParams;
  const slug = params.get("slug") ?? "";
  const known = servicesData.some((s) => s.slug === slug);
  const draft = await draftMode();

  if (params.get("exit") === "1") {
    draft.disable();
    redirect(known ? studioServicePath(slug) : STUDIO_SERVICES);
  }

  const state = await getStudioState();
  if (state.kind !== "ok") redirect(STUDIO_LOGIN);
  if (!known) redirect(STUDIO_SERVICES);

  draft.enable();
  // In the Studio's language: the three are the site's three.
  redirect(`/${await getStudioLocale()}/services/${slug}`);
}
