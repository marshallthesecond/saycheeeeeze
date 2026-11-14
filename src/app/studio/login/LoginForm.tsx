"use client";

// The sign-in form. It posts to the signIn Server Action, so it works before
// the page's JavaScript has loaded, and the password is never held in React
// state.

import { useActionState } from "react";
import { CircleAlert } from "lucide-react";
import { useT } from "@/src/lib/i18n/LanguageProvider";
import { signIn, type SignInState } from "../actions";

const FIELD =
  "mt-1.5 block h-11 w-full rounded-lg border border-input bg-card px-3 text-[15px] text-foreground outline-none transition " +
  "placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40";

export default function LoginForm({ notice }: { notice?: SignInState["error"] }) {
  const { t } = useT();
  const [state, action, pending] = useActionState<SignInState, FormData>(
    signIn,
    notice ? { error: notice } : {},
  );

  return (
    <form action={action} className="grid gap-4">
      <label className="block text-sm font-medium">
        {t("login.email")}
        <input
          name="email"
          type="email"
          // "username" is what password managers look for beside a password.
          autoComplete="username"
          inputMode="email"
          autoCapitalize="none"
          spellCheck={false}
          required
          // React resets a form after its action runs. Handing the email back
          // as the default keeps a mistyped password from costing it.
          defaultValue={state.email ?? ""}
          className={FIELD}
        />
      </label>

      <label className="block text-sm font-medium">
        {t("login.password")}
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className={FIELD}
        />
      </label>

      {/* Always in the tree, so a screen reader announces the text when it
          appears. An icon as well as a colour, as everywhere else on the site. */}
      <p role="alert" className="min-h-5 text-sm text-destructive">
        {state.error && (
          <span className="flex items-start gap-2">
            <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
            <span>{t(`login.errors.${state.error}`)}</span>
          </span>
        )}
      </p>

      <button
        type="submit"
        disabled={pending}
        className="inline-flex h-11 items-center justify-center rounded-lg bg-primary px-4 text-[15px] font-semibold text-primary-foreground transition
          hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-70"
      >
        {pending ? t("login.submitting") : t("login.submit")}
      </button>
    </form>
  );
}
