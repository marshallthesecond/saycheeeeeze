// A client gallery's Passkeys tab: whether a code is needed at all, the codes
// that exist, and making or turning off one.

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import ConfirmButton from "@/src/components/studio/ConfirmButton";
import { AccessModeForm, NewPasskeyForm } from "@/src/components/studio/PasskeyForms";
import { Section } from "@/src/components/studio/fields";
import { revokePasskey } from "@/src/app/studio/gallery-actions";
import { ACCESS_TTL_SECONDS } from "@/src/lib/gallery-access";
import { SITE_URL } from "@/src/lib/seo";
import { getStudioGallery, listPasskeys, studioDate, type StudioPasskey } from "@/src/lib/studio/gallery";
import { getStudioDictionary, translator } from "@/src/lib/studio/i18n";
import { getStudioLocale } from "@/src/lib/studio/locale";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const gallery = await getStudioGallery(decodeURIComponent((await params).slug));
  return { title: gallery?.title };
}

export default async function GalleryAccessPage({ params }: Props) {
  const gallery = await getStudioGallery(decodeURIComponent((await params).slug));
  // Albums have no passkeys: the public site has no gate in front of them.
  if (!gallery || gallery.kind !== "client") notFound();

  const locale = await getStudioLocale();
  const t = translator(await getStudioDictionary(locale));
  const passkeys = await listPasskeys(gallery.id);

  const usage = (p: StudioPasskey) => {
    const created = t("access.created", { date: studioDate(p.createdAt, locale) });
    if (p.useCount === 0 || !p.lastUsedAt) return `${created}, ${t("access.neverUsed")}`;
    const last = studioDate(p.lastUsedAt, locale);
    return `${created}, ${t(p.useCount === 1 ? "access.usedOne" : "access.usedMany", { n: p.useCount, date: last })}`;
  };

  return (
    <div className="grid max-w-2xl gap-5">
      <AccessModeForm gallery={gallery} />

      {/* The days come from the gate's own cookie lifetime: turning a passkey
          off stops new unlocks, it does not sign out a browser already in. */}
      <Section
        title={t("access.passkeys")}
        blurb={t("access.passkeysBlurb", { days: Math.round(ACCESS_TTL_SECONDS / 86_400) })}
      >
        {passkeys.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("access.none")}</p>
        ) : (
          <ul className="divide-y divide-border border-y border-border">
            {passkeys.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3">
                <div className="min-w-0">
                  <p className="text-[15px]">
                    <span className={`font-semibold ${p.status === "active" ? "" : "text-muted-foreground line-through"}`}>
                      {p.label}
                    </span>
                    <span className="ml-2 text-[13px] text-muted-foreground">{t(`access.${p.status}`)}</span>
                  </p>
                  <p className="mt-0.5 text-[13px] text-muted-foreground">{usage(p)}</p>
                </div>
                {p.status === "active" && (
                  <form action={revokePasskey}>
                    <input type="hidden" name="galleryId" value={gallery.id} />
                    <input type="hidden" name="passkey" value={p.id} />
                    <ConfirmButton label={t("access.revoke")} confirmLabel={t("access.revokeConfirm")} />
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-6">
          <NewPasskeyForm gallery={gallery} url={`${SITE_URL}${gallery.href}`} />
        </div>
      </Section>
    </div>
  );
}
