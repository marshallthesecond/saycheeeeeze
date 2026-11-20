// One service in the Services tab: the editor for its cover, texts and
// packages (a draft, published when every language is written), its on/off
// switch and the photos on its page.

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import ServiceEditor from "@/src/components/studio/services/ServiceEditor";
import { editableContent, textOf, type Text } from "@/src/lib/service-content";
import { HERO_STACK_COUNT, RAIL_COUNT } from "@/src/lib/placements";
import { allPackages, pickLocale } from "@/src/lib/services";
import { getStudioDictionary, translator } from "@/src/lib/studio/i18n";
import { getStudioLocale } from "@/src/lib/studio/locale";
import { requireStudio } from "@/src/lib/studio/session";
import {
  ServicesNotSetUp,
  coverPhoto,
  getStudioService,
  servicePhotos,
  type StudioServiceRow,
} from "@/src/lib/studio/services";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const locale = await getStudioLocale();
  const t = translator(await getStudioDictionary(locale));
  const session = await requireStudio();
  const row = await getStudioService(session, slug).catch(() => null);
  return { title: row ? pickLocale(row.code.title, locale) : t("services.title") };
}

export default async function StudioServicePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const session = await requireStudio();
  const t = translator(await getStudioDictionary(await getStudioLocale()));

  let row: StudioServiceRow | null;
  try {
    row = await getStudioService(session, slug);
  } catch (e) {
    if (!(e instanceof ServicesNotSetUp)) throw e;
    return (
      <div className="mx-auto max-w-3xl">
        <h1 className="text-2xl font-semibold leading-tight">{t("services.title")}</h1>
        <p className="mt-4 max-w-prose rounded-lg border border-border bg-card px-4 py-3 text-sm">{t("services.notSetUp")}</p>
      </div>
    );
  }
  if (!row) notFound();

  const content = editableContent(row.code, row.published, row.draft);
  const [cover, rail] = await Promise.all([
    coverPhoto(session, content.cover.path).catch(() => undefined),
    servicePhotos(session, slug),
  ]);

  // Ever on the site: in the code, or in what was published. Deleting one of
  // these keeps it, marked, for the bookings made with it.
  const liveIds = new Set(allPackages(row.code).flatMap((p) => (p.id ? [p.id] : [])));
  for (const g of row.published?.groups ?? []) for (const p of g.packages) liveIds.add(p.id);

  const notes: Record<string, Text> = {};
  for (const p of allPackages(row.code)) if (p.id && p.note) notes[p.id] = textOf(p.note);

  return (
    <ServiceEditor
      slug={slug}
      grouped={Boolean(row.code.packageGroups?.length)}
      content={content}
      rev={row.rev}
      hasDraft={row.draft !== null}
      enabled={row.enabled}
      coverPhoto={cover}
      rail={rail}
      railShows={row.code.hero?.graphic === "stack" ? RAIL_COUNT + HERO_STACK_COUNT : RAIL_COUNT}
      liveIds={[...liveIds]}
      notes={notes}
    />
  );
}
