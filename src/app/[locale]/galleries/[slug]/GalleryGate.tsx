"use client";

// src/app/[locale]/galleries/[slug]/GalleryGate.tsx
//
// The door. Also the expired notice, because both are the same screen with
// different copy and neither is worth its own file.
//
// Design notes, such as they are: this borrows nothing new. Same near-black
// background, same white pill for the primary action, same white/[0.07] for
// the secondary, same 12rem minimum tap target as the 404 and the portfolio
// error page. A client who lands here should feel like they're still on the
// site, not at a login wall bolted onto it.
//
// The copy does one job: tell someone who doesn't have a code how to get one.
// That is the only genuinely useful thing this screen can say, so it gets a
// button rather than a sentence.

import { useCallback, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Lock, Send, Mail, Clock } from "lucide-react";

import { CONTACT } from "@/src/lib/gallery";
import { useT } from "@/src/lib/i18n/LanguageProvider";
import StickyHeader from "@/src/components/common/StickyHeader";

interface Props {
  slug: string;
  title: string;
  state: "locked" | "expired";
  photoCount?: number;
  dateLabel?: string;
}

export default function GalleryGate({
  slug,
  title,
  state,
  photoCount,
  dateLabel,
}: Props) {
  const router = useRouter();
  const { t, locale } = useT();

  // Same fallback trick AlbumView uses: ship English until the key exists in
  // the dictionary, never ship "gallery.unlock" to a user. Every key below now
  // resolves in all three languages; the fallback stays as a net for the next
  // string somebody adds.
  const tx = useCallback(
    (key: string, fallback: string, vars?: Record<string, string | number>) => {
      const value = t(key, vars);
      if (value !== key) return value;
      return vars
        ? Object.entries(vars).reduce(
            (out, [k, v]) => out.replaceAll(`{${k}}`, String(v)),
            fallback,
          )
        : fallback;
    },
    [t],
  );

  const [code, setCode] = useState("");
  const [status, setStatus] = useState<"idle" | "checking" | "error" | "locked-out">(
    "idle",
  );

  const submit = useCallback(async () => {
    if (!code.trim() || status === "checking") return;
    setStatus("checking");

    try {
      const res = await fetch("/api/galleries/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, code }),
      });

      if (res.ok) {
        // The cookie is set. Re-render the server component, which will now
        // take the unlocked branch.
        router.refresh();
        return;
      }

      setStatus(res.status === 429 ? "locked-out" : "error");
    } catch {
      setStatus("error");
    }
  }, [code, slug, status, router]);

  const isExpired = state === "expired";

  const askForAccess = isExpired
    ? tx(
        "gate.askRestore",
        'Hi — the gallery "{title}" has expired. Could you put it back up?',
        { title },
      )
    : tx("gate.askAccess", 'Hi — could I get the code for the "{title}" gallery?', {
        title,
      });

  const mailSubject = tx("gate.mailSubject", "Gallery access — {title}", { title });

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6 pb-28 text-center text-white">
      {/* The same bar the rest of the site uses, so the door doesn't read as a
          login wall bolted onto a different product. */}
      <StickyHeader
        title="saycheeeeeze"
        accent="#0e0c09"
        fadeOver={200}
        variant="wordmark"
        backHref={`/${locale}/portfolio`}
      />

      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-80"
        style={{
          background:
            "linear-gradient(to bottom, rgba(80,100,119,0.22) 0%, rgba(14,12,9,0) 100%)",
        }}
      />

      <div className="relative z-10 flex w-full max-w-xs flex-col items-center gap-6">
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white/10">
          {isExpired ? (
            <Clock className="h-7 w-7 text-white/70" />
          ) : (
            <Lock className="h-7 w-7 text-white/70" />
          )}
        </span>

        <div>
          <p className="font-mono text-[11px] uppercase tracking-widest text-white/40">
            {isExpired
              ? tx("gate.expiredEyebrow", "No longer available")
              : tx("gate.eyebrow", "Private gallery")}
          </p>
          <h1 className="mt-2 text-2xl font-extrabold leading-tight tracking-tight">
            {title}
          </h1>

          {isExpired ? (
            <p className="mt-3 text-sm leading-relaxed text-white/50">
              {tx(
                "gate.expiredBody",
                "This gallery came down after its delivery window. Message me and I'll put it back up.",
              )}
            </p>
          ) : (
            <>
              {(dateLabel || photoCount) && (
                <p className="mt-1 text-sm text-white/50">
                  {[
                    dateLabel,
                    photoCount
                      ? tx("gate.photos", "{n} photos", { n: photoCount })
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              )}
              <p className="mt-3 text-sm leading-relaxed text-white/50">
                {tx("gate.body", "Enter the code I sent you to open it.")}
              </p>
            </>
          )}
        </div>

        {!isExpired && (
          <div className="flex w-full flex-col gap-2">
            <input
              type="text"
              inputMode="text"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => {
                setCode(e.target.value);
                if (status === "error") setStatus("idle");
              }}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              aria-label={tx("gate.codeLabel", "Gallery code")}
              aria-invalid={status === "error"}
              placeholder={tx("gate.placeholder", "Your code")}
              disabled={status === "locked-out"}
              className="w-full rounded-full border border-white/15 bg-white/5 px-5 text-center font-mono tracking-[0.2em] text-white placeholder:tracking-normal placeholder:font-sans placeholder:text-white/30 focus:border-white/40 focus:outline-none disabled:opacity-50"
              style={{ minHeight: "3rem" }}
            />

            <button
              onClick={submit}
              disabled={
                !code.trim() || status === "checking" || status === "locked-out"
              }
              className="flex min-h-12 w-full items-center justify-center rounded-full bg-white text-sm font-bold text-black transition active:scale-[0.98] disabled:opacity-40"
            >
              {status === "checking"
                ? tx("gate.checking", "Checking…")
                : tx("gate.open", "Open gallery")}
            </button>

            {/* Errors say what happened and what to do, in the site's voice.
                They don't apologise and they don't hint at whether the slug
                exists — a wrong code and a wrong URL read identically. */}
            {status === "error" && (
              <p role="alert" className="text-xs text-amber-300">
                {tx("gate.wrong", "That code didn't work. Check it and try again.")}
              </p>
            )}
            {status === "locked-out" && (
              <p role="alert" className="text-xs text-amber-300">
                {tx(
                  "gate.tooMany",
                  "Too many tries. Wait fifteen minutes, or message me below.",
                )}
              </p>
            )}
          </div>
        )}

        {/* The way out for someone with no code. This is the point of the
            screen for everyone who isn't the client. */}
        <div className="flex w-full flex-col gap-2">
          <p className="text-[11px] uppercase tracking-widest text-white/30">
            {isExpired
              ? tx("gate.expiredHelp", "Ask me to restore it")
              : tx("gate.noCode", "No code, or it stopped working?")}
          </p>

          <a
            href={`https://t.me/${CONTACT.telegram}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-white/[0.07] text-sm font-semibold transition hover:bg-white/12"
          >
            <Send className="h-4 w-4" />
            {tx("gate.telegram", "Message me on Telegram")}
          </a>

          <a
            href={`mailto:${CONTACT.email}?subject=${encodeURIComponent(
              mailSubject,
            )}&body=${encodeURIComponent(askForAccess)}`}
            className="flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-white/[0.07] text-sm font-semibold transition hover:bg-white/12"
          >
            <Mail className="h-4 w-4" />
            {tx("gate.email", "Email me")}
          </a>
        </div>

        <Link
          href={`/${locale}`}
          className="text-xs text-white/30 transition hover:text-white/60"
        >
          ← {tx("gallery.back", "Back to saycheeeeze")}
        </Link>
      </div>
    </div>
  );
}