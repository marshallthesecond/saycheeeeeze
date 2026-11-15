// /studio/new — make a gallery. It is created empty and unpublished; a client
// gallery is created private, with its first passkey.

import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import NewGalleryForm from "@/src/components/studio/NewGalleryForm";
import { STUDIO_HOME } from "@/src/lib/studio/config";
import { newGalleryDefaults } from "@/src/lib/studio/gallery";
import { getStudioDictionary, translator } from "@/src/lib/studio/i18n";
import { getStudioLocale } from "@/src/lib/studio/locale";
import { generatePasskey } from "@/src/lib/studio/passkey";
import { requireStudio } from "@/src/lib/studio/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = translator(await getStudioDictionary(await getStudioLocale()));
  return { title: t("newGallery.title") };
}

export default async function NewGalleryPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  const session = await requireStudio();
  const t = translator(await getStudioDictionary(await getStudioLocale()));
  const [{ type }, defaults] = await Promise.all([searchParams, newGalleryDefaults(session)]);

  return (
    <>
      <Link
        href={STUDIO_HOME}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        <ChevronLeft aria-hidden className="size-4" />
        {t("gallery.back")}
      </Link>
      <h1 className="mt-3 text-2xl font-semibold leading-tight">{t("newGallery.title")}</h1>

      <div className="mt-6">
        <NewGalleryForm
          categories={defaults.categories}
          defaultLocation={defaults.location}
          // A fresh suggestion on every visit. It becomes a passkey only if
          // the form is sent with it still in the field.
          suggestedCode={generatePasskey()}
          initialKind={type === "client" ? "client" : "album"}
        />
      </div>
    </>
  );
}
