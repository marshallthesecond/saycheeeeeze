// Everything in the Studio that needs a signed-in photographer.
//
// (panel) is a route group: the brackets keep it out of the address, so the
// pages here are /studio, /studio/galleries/… and so on, while /studio/login
// stays outside and gets no sidebar.
//
// requireStudio() here decides what the frame shows. It is NOT the only check:
// a layout does not run again when you move between its pages, so every page
// calls requireStudio() itself as well. Within one request the answer is
// computed once.

import StudioShell from "@/src/components/studio/StudioShell";
import { getStudioDictionary, translator } from "@/src/lib/studio/i18n";
import { getStudioLocale } from "@/src/lib/studio/locale";
import { requireStudio } from "@/src/lib/studio/session";

export default async function StudioPanelLayout({ children }: { children: React.ReactNode }) {
  const session = await requireStudio();
  const locale = await getStudioLocale();
  const t = translator(await getStudioDictionary(locale));

  return (
    <StudioShell
      accountName={session.account.displayName}
      email={session.email}
      locale={locale}
      labels={{
        brand: t("brand"),
        viewSite: t("nav.viewSite"),
        signOut: t("nav.signOut"),
        language: t("nav.language"),
      }}
    >
      {children}
    </StudioShell>
  );
}
