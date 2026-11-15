"use client";

// Copies a piece of text and says so for two seconds.

import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import { useT } from "@/src/lib/i18n/LanguageProvider";
import { BUTTON_QUIET } from "./fields";

export default function CopyButton({
  text,
  label,
  className = BUTTON_QUIET,
}: {
  text: string;
  /** Defaults to "Copy". */
  label?: string;
  className?: string;
}) {
  const { t } = useT();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      // No clipboard permission (an old browser, or a page not served over
      // https). The text is on screen next to this button, so it can still be
      // selected by hand; saying "Copied" would be the only wrong answer.
    }
  }

  return (
    <button type="button" onClick={copy} className={className}>
      {copied ? <Check aria-hidden className="size-4" /> : <Copy aria-hidden className="size-4" />}
      <span aria-live="polite">{copied ? t("common.copied") : (label ?? t("common.copy"))}</span>
    </button>
  );
}
