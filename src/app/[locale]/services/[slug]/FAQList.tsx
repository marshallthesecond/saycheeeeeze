'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { accentText } from './accent';

interface FAQ {
  question: string;
  answer: string;
}

function FAQItem({ question, answer, accent }: FAQ & { accent?: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border-b border-border last:border-b-0">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-4 min-h-14 py-4 text-left text-sm font-semibold text-foreground hover:text-foreground/80 active:text-muted-foreground transition"
      >
        <span>{question}</span>
        {/* One rotating chevron rather than swapping two icons — smoother,
            and it telegraphs the open/closed state continuously. */}
        <ChevronDown
          className="w-4 h-4 shrink-0 transition-transform duration-200"
          style={{
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
            color: open && accent ? accentText(accent) : 'var(--muted-foreground)',
          }}
        />
      </button>

      {/* Grid-rows trick: animates height from 0 to auto, which a plain
          max-height transition can't do without a hardcoded guess. */}
      <div
        className="grid transition-all duration-250 ease-out"
        style={{
          gridTemplateRows: open ? '1fr' : '0fr',
          opacity: open ? 1 : 0,
        }}
      >
        <div className="overflow-hidden">
          <p className="pb-4 text-sm text-muted-foreground leading-relaxed">{answer}</p>
        </div>
      </div>
    </div>
  );
}

export default function FAQList({ faqs, accent }: { faqs: FAQ[]; accent?: string }) {
  return (
    <div className="rounded-xl bg-foreground/3 px-4">
      {faqs.map((faq, i) => (
        <FAQItem key={i} question={faq.question} answer={faq.answer} accent={accent} />
      ))}
    </div>
  );
}