// A gallery's Settings tab: everything that used to be an UPDATE typed into
// the SQL editor.

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DeleteForm, DetailsForm, DownloadsForm, PublishingForm } from "@/src/components/studio/SettingsForms";
import { Section } from "@/src/components/studio/fields";
import { getStudioGallery } from "@/src/lib/studio/gallery";
import { getStudioDictionary, translator } from "@/src/lib/studio/i18n";
import { getStudioLocale } from "@/src/lib/studio/locale";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const gallery = await getStudioGallery(decodeURIComponent((await params).slug));
  return { title: gallery?.title };
}

export default async function GallerySettingsPage({ params }: Props) {
  const gallery = await getStudioGallery(decodeURIComponent((await params).slug));
  if (!gallery) notFound();

  const t = translator(await getStudioDictionary(await getStudioLocale()));

  return (
    <div className="grid max-w-2xl gap-5">
      <DetailsForm gallery={gallery} />
      <PublishingForm gallery={gallery} />
      {gallery.kind === "client" && <DownloadsForm gallery={gallery} />}

      <Section title={t("settings.address")} blurb={t("settings.addressHint")}>
        <dl className="grid gap-3 text-sm">
          <div>
            <dt className="text-[13px] text-muted-foreground">{t("settings.address")}</dt>
            <dd className="mt-0.5 break-all font-mono">{gallery.href}</dd>
          </div>
          {gallery.folder && (
            <div>
              <dt className="text-[13px] text-muted-foreground">{t("gallery.photos.folder")}</dt>
              <dd className="mt-0.5 break-all font-mono">{gallery.folder}</dd>
            </div>
          )}
        </dl>
      </Section>

      <DeleteForm gallery={gallery} />
    </div>
  );
}
