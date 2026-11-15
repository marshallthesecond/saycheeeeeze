// Shown for a Studio address that leads nowhere, most often a gallery that
// was deleted or belongs to another account. The two are answered alike on
// purpose: the page never says a gallery exists that you may not see.

import Link from "next/link";
import { BUTTON_QUIET } from "@/src/components/studio/fields";
import { STUDIO_HOME } from "@/src/lib/studio/config";
import { getStudioDictionary, translator } from "@/src/lib/studio/i18n";
import { getStudioLocale } from "@/src/lib/studio/locale";

export default async function StudioNotFound() {
  const t = translator(await getStudioDictionary(await getStudioLocale()));
  return (
    <div className="py-10">
      <h1 className="text-2xl font-semibold leading-tight">{t("gallery.notFoundTitle")}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{t("gallery.notFoundBlurb")}</p>
      <Link href={STUDIO_HOME} className={`${BUTTON_QUIET} mt-6`}>
        {t("gallery.back")}
      </Link>
    </div>
  );
}
