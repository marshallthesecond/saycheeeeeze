// The Services tab: every service page, with its cover, its lowest price,
// whether it has unpublished changes, and its on/off switch.

import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import PhotoFrame from "@/src/components/common/PhotoFrame";
import ServiceSwitch from "@/src/components/studio/services/ServiceSwitch";
import { formatSom } from "@/src/lib/packages";
import { applyContent } from "@/src/lib/service-content";
import { entryPackage, offeredPackages, pickLocale } from "@/src/lib/services";
import { bunnyUrl } from "@/src/lib/bunny-url";
import { studioServicePath } from "@/src/lib/studio/config";
import { getStudioDictionary, translator } from "@/src/lib/studio/i18n";
import { getStudioLocale } from "@/src/lib/studio/locale";
import { requireStudio } from "@/src/lib/studio/session";
import { ServicesNotSetUp, coverPhoto, listStudioServices, type StudioServiceRow } from "@/src/lib/studio/services";

export async function generateMetadata(): Promise<Metadata> {
  const t = translator(await getStudioDictionary(await getStudioLocale()));
  return { title: t("services.title") };
}

export default async function StudioServicesPage() {
  const session = await requireStudio();
  const locale = await getStudioLocale();
  const t = translator(await getStudioDictionary(locale));

  let rows: StudioServiceRow[];
  try {
    rows = await listStudioServices(session);
  } catch (e) {
    if (!(e instanceof ServicesNotSetUp)) throw e;
    return (
      <>
        <h1 className="text-2xl font-semibold leading-tight">{t("services.title")}</h1>
        <p className="mt-4 max-w-prose rounded-lg border border-border bg-card px-4 py-3 text-sm">{t("services.notSetUp")}</p>
      </>
    );
  }

  const items = await Promise.all(
    rows.map(async (row) => {
      // What the editor shows: the draft if there is one, else the site's.
      const content = row.draft ?? row.published;
      const service = content ? applyContent(row.code, content) : row.code;
      const entry = entryPackage(service);
      return {
        row,
        title: pickLocale(service.title, locale),
        from: entry ? formatSom(entry.priceUzs, locale) : null,
        count: offeredPackages(service).length,
        cover: await coverPhoto(session, service.hero?.groundPath ?? service.coverPath).catch(() => undefined),
        coverPath: service.hero?.groundPath ?? service.coverPath,
      };
    }),
  );

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-semibold leading-tight">{t("services.title")}</h1>
      <p className="mt-1.5 max-w-prose text-sm text-muted-foreground">{t("services.blurb")}</p>

      <ul className="mt-6 grid gap-2.5">
        {items.map(({ row, title, from, count, cover, coverPath }) => (
          <li key={row.slug} className="flex min-w-0 items-center gap-3 rounded-xl border border-border bg-card p-2.5 pr-4">
            <Link href={studioServicePath(row.slug)} className="flex min-w-0 flex-1 items-center gap-3 rounded-lg">
              <PhotoFrame
                ladder={cover?.ladder}
                src={cover ? undefined : bunnyUrl(coverPath)}
                thumbhash={cover?.thumbhash}
                alt=""
                sizes="64px"
                className={`size-16 shrink-0 rounded-lg ${row.enabled ? "" : "opacity-50 grayscale"}`}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{title}</span>
                <span className="block truncate text-[13px] text-muted-foreground">
                  {[from ? t("services.from", { price: from }) : null, t(count === 1 ? "services.packagesOne" : "services.packagesMany", { n: count })]
                    .filter(Boolean)
                    .join(", ")}
                </span>
                {(row.draft || !row.enabled) && (
                  <span className="mt-1 flex flex-wrap gap-1.5">
                    {row.draft && (
                      <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-medium text-amber-300">
                        {t("services.draft")}
                      </span>
                    )}
                    {!row.enabled && (
                      <span className="whitespace-nowrap rounded-md bg-foreground/8 px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                        {t("services.off")}
                      </span>
                    )}
                  </span>
                )}
              </span>
              <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            </Link>
            <ServiceSwitch slug={row.slug} name={title} initial={row.enabled} />
          </li>
        ))}
      </ul>
    </div>
  );
}
