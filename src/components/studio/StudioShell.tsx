// The frame around every signed-in Studio screen: a sidebar from 1024px, a
// top bar below that.
//
// A Server Component. Sign-out and the language switch are plain forms that
// post to Server Actions, so the only JavaScript in the frame is StudioNav,
// which needs the address to mark the current section.

import { ExternalLink, LogOut } from "lucide-react";
import type { Locale } from "@/src/lib/i18n/config";
import { signOut } from "@/src/app/studio/actions";
import LocaleSwitch from "./LocaleSwitch";
import StudioNav from "./StudioNav";

export interface ShellLabels {
  brand: string;
  viewSite: string;
  signOut: string;
  language: string;
}

/** The worker and the storage used, as of this page load. */
export interface ShellStatus {
  /** null: not known (the uploads update is not in the database yet). */
  workerOnline: boolean | null;
  workerLabel: string;
  /** "12.4 GB stored" */
  stored: string;
}

export default function StudioShell({
  accountName,
  email,
  locale,
  labels,
  status,
  children,
}: {
  accountName: string;
  email: string | null;
  locale: Locale;
  labels: ShellLabels;
  status: ShellStatus;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-dvh bg-background text-foreground lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]">
      {/* Sidebar, from 1024px. */}
      <aside className="sticky top-0 hidden h-dvh flex-col border-r border-border px-3 py-5 lg:flex">
        <div className="px-3">
          <p className="text-lg font-semibold leading-none">{labels.brand}</p>
          <p className="mt-1.5 truncate text-sm text-muted-foreground">{accountName}</p>
        </div>

        <StudioNav className="mt-7" />

        <div className="mt-auto grid gap-3 px-3">
          <div className="grid gap-1 text-[13px] text-muted-foreground">
            {status.workerOnline !== null && (
              <p className="flex items-center gap-1.5">
                <span
                  aria-hidden
                  className={`size-2 shrink-0 rounded-full ${status.workerOnline ? "bg-emerald-500" : "bg-foreground/30"}`}
                />
                {status.workerLabel}
              </p>
            )}
            <p>{status.stored}</p>
          </div>

          <a
            href="/"
            target="_blank"
            rel="noopener"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            {labels.viewSite}
            <ExternalLink aria-hidden className="size-3.5" />
          </a>

          <div className="-ml-2">
            <LocaleSwitch active={locale} label={labels.language} />
          </div>

          <div className="border-t border-border pt-3">
            {email && <p className="truncate text-xs text-muted-foreground">{email}</p>}
            <form action={signOut}>
              <button
                type="submit"
                className="mt-1 inline-flex items-center gap-1.5 text-sm font-medium text-foreground underline-offset-4 hover:underline"
              >
                <LogOut aria-hidden className="size-4" />
                {labels.signOut}
              </button>
            </form>
          </div>
        </div>
      </aside>

      <div className="min-w-0">
        {/* Top bar, below 1024px. */}
        <header
          className="sticky top-0 z-30 flex h-12 items-center justify-between gap-3 border-b border-border bg-background px-4
            pt-[env(safe-area-inset-top)] lg:hidden"
        >
          <p className="min-w-0 truncate text-sm">
            <span className="font-semibold">{labels.brand}</span>
            <span className="ml-2 text-muted-foreground">{accountName}</span>
          </p>
          <div className="flex shrink-0 items-center gap-1">
            <StudioNav compact />
            <LocaleSwitch active={locale} label={labels.language} />
            <form action={signOut}>
              <button
                type="submit"
                aria-label={labels.signOut}
                title={labels.signOut}
                className="inline-flex size-9 items-center justify-center rounded-md text-muted-foreground transition hover:bg-foreground/8 hover:text-foreground"
              >
                <LogOut aria-hidden className="size-4" />
              </button>
            </form>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1400px] px-4 pb-16 pt-6 sm:px-8 lg:px-10 lg:pt-9">
          {children}
        </main>
      </div>
    </div>
  );
}
