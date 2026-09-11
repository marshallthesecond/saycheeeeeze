// src/components/common/GalleryRequestSheet.tsx
//
// The client's way of asking you to change something. There's no backend
// behind this yet, so it composes a message and hands it to Telegram or email
// — the filenames are baked in so you can act on it without a back-and-forth.
//
// When you do add a database, this component keeps its shape: swap the two
// send handlers for a POST and everything else stays.

"use client";

import { useEffect, useMemo, useState } from "react";
import { X, Send, Copy, Mail, Check } from "lucide-react";
import {
  buildRequestMessage,
  fileName,
  mailtoUrl,
  requestSubject,
  telegramUrl,
  type RequestKind,
} from "@/src/lib/gallery";
import { useT } from "@/src/lib/i18n/LanguageProvider";

interface Props {
  open: boolean;
  onClose: () => void;
  galleryTitle: string;
  /** Sources of the photos the request applies to. Ignored for delete/private. */
  selectedSources: string[];
  initialKind?: RequestKind;
}

// Dictionary KEYS, not text. The message that actually gets sent to you is
// still composed in English by buildRequestMessage() — deliberately, so a
// request written by an Uzbek-speaking client is still readable in your inbox.
// Only what the CLIENT reads is translated.
const OPTIONS: { kind: RequestKind; labelKey: string; helpKey: string }[] = [
  { kind: "hide", labelKey: "request.hideLabel", helpKey: "request.hideHelp" },
  { kind: "private", labelKey: "request.privateLabel", helpKey: "request.privateHelp" },
  { kind: "delete", labelKey: "request.deleteLabel", helpKey: "request.deleteHelp" },
  { kind: "approve", labelKey: "request.approveLabel", helpKey: "request.approveHelp" },
];

export default function GalleryRequestSheet({
  open,
  onClose,
  galleryTitle,
  selectedSources,
  initialKind = "hide",
}: Props) {
  const { t } = useT();
  const [kind, setKind] = useState<RequestKind>(initialKind);
  const [note, setNote] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (open) setKind(initialKind);
  }, [open, initialKind]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  const message = useMemo(() => {
    if (!open) return "";
    return buildRequestMessage({
      kind,
      galleryTitle,
      galleryUrl: window.location.href.split("?")[0],
      photoNames: selectedSources.map(fileName),
      note,
    });
  }, [open, kind, galleryTitle, selectedSources, note]);

  if (!open) return null;

  const needsSelection = kind === "hide" || kind === "approve";
  const missingSelection = needsSelection && selectedSources.length === 0;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      return true;
    } catch {
      return false;
    }
  };

  // t.me can't prefill a message to a personal account, so we copy first and
  // open the chat second. The button says what actually happens.
  const sendOnTelegram = async () => {
    await copy();
    window.open(telegramUrl(), "_blank", "noopener,noreferrer");
  };

  const sendByEmail = () => {
    window.location.href = mailtoUrl(requestSubject(kind, galleryTitle), message);
  };

  return (
    <div
      className="fixed inset-0 z-70 flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center"
      onClick={onClose}
    >
      <div
        className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-neutral-950 ring-1 ring-white/10 sm:rounded-3xl"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t("request.heading")}
      >
        <div className="flex items-center justify-between px-6 pb-2 pt-6">
          <h2 className="text-lg font-semibold text-white">{t("request.heading")}</h2>
          <button
            onClick={onClose}
            aria-label={t("common.close")}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="px-6 text-sm text-white/50">{t("request.blurb")}</p>

        <div className="mt-5 space-y-2 px-6">
          {OPTIONS.map((option) => {
            const active = kind === option.kind;
            return (
              <button
                key={option.kind}
                onClick={() => setKind(option.kind)}
                className={`w-full rounded-2xl border p-4 text-left transition ${
                  active
                    ? "border-white bg-white/10"
                    : "border-white/10 hover:border-white/30"
                }`}
              >
                <span className="block text-sm font-medium text-white">
                  {t(option.labelKey)}
                </span>
                <span className="mt-0.5 block text-xs text-white/50">
                  {t(option.helpKey)}
                </span>
              </button>
            );
          })}
        </div>

        {needsSelection && (
          <p
            className={`mt-4 px-6 text-xs ${
              missingSelection ? "text-amber-300" : "text-white/50"
            }`}
          >
            {missingSelection
              ? t("request.needSelection")
              : t("request.selected", { n: selectedSources.length })}
          </p>
        )}

        <div className="mt-4 px-6">
          <label
            htmlFor="request-note"
            className="mb-2 block text-xs uppercase tracking-widest text-white/40"
          >
            {t("request.noteLabel")}
          </label>
          <textarea
            id="request-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder={t("request.notePlaceholder")}
            className="w-full resize-none rounded-xl border border-white/15 bg-white/5 p-3 text-sm text-white placeholder:text-white/30 focus:border-white/40 focus:outline-none"
          />
        </div>

        <div className="mt-4 px-6">
          <p className="mb-2 text-xs uppercase tracking-widest text-white/40">
            {t("request.previewLabel")}
          </p>
          <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-xl bg-white/5 p-3 font-mono text-[11px] leading-relaxed text-white/60">
            {message}
          </pre>
        </div>

        <div className="flex flex-wrap gap-2 px-6 py-6">
          <button
            onClick={sendOnTelegram}
            disabled={missingSelection}
            className="flex flex-1 items-center justify-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-semibold text-black transition hover:bg-white/85 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Send className="h-4 w-4" />
            {t("request.sendTelegram")}
          </button>
          <button
            onClick={sendByEmail}
            disabled={missingSelection}
            className="flex items-center justify-center gap-2 rounded-full border border-white/20 px-5 py-3 text-sm font-medium text-white transition hover:border-white/50 disabled:opacity-40"
          >
            <Mail className="h-4 w-4" />
            {t("request.sendEmail")}
          </button>
          <button
            onClick={copy}
            className="flex items-center justify-center gap-2 rounded-full border border-white/20 px-5 py-3 text-sm font-medium text-white transition hover:border-white/50"
          >
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied ? t("request.copied") : t("request.copy")}
          </button>
        </div>
      </div>
    </div>
  );
}