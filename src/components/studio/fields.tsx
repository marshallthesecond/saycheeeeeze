// The Studio's form pieces: one look for every field, section and button.
// Nothing here keeps state, so both Server and Client Components can use it.

import { cloneElement, useId } from "react";

export const FIELD =
  "mt-1.5 block h-11 w-full rounded-lg border border-input bg-card px-3 text-[15px] text-foreground outline-none transition " +
  "placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40";

export const TEXTAREA =
  "mt-1.5 block min-h-24 w-full rounded-lg border border-input bg-card px-3 py-2.5 text-[15px] leading-relaxed text-foreground outline-none transition " +
  "placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40";

const BUTTON =
  "inline-flex h-10 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-4 text-sm font-semibold transition " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-60";

export const BUTTON_PRIMARY = `${BUTTON} bg-primary text-primary-foreground hover:bg-primary-hover`;
export const BUTTON_QUIET = `${BUTTON} bg-foreground/6 text-foreground hover:bg-foreground/12`;
// Hover thickens the outline instead of tinting the fill: this red on the card
// clears the 4.5:1 text contrast line with little to spare, and any tint
// behind it drops it under (measured 4.04 in dark with a 10% fill).
export const BUTTON_DANGER = `${BUTTON} border border-destructive text-destructive hover:ring-1 hover:ring-destructive`;

/** A titled block of the settings pages. */
export function Section({
  title,
  blurb,
  children,
}: {
  title: string;
  blurb?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-5 sm:p-6">
      <h2 className="text-base font-semibold leading-snug">{title}</h2>
      {blurb && <p className="mt-1 max-w-prose text-sm text-muted-foreground">{blurb}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

/**
 * A label, its control, and an optional line of help under it.
 *
 * The help sits outside the <label> and is tied to the control with
 * aria-describedby, so a screen reader says "Title, edit text" and then the
 * help, rather than reading the help out as part of the name.
 */
export function Field({
  label,
  hint,
  children,
  className = "",
}: {
  label: string;
  hint?: string;
  /** One control: an input, a select or a textarea. */
  children: React.ReactElement<{ "aria-describedby"?: string }>;
  className?: string;
}) {
  const hintId = useId();
  return (
    <div className={className}>
      <label className="block text-sm font-medium">
        {label}
        {hint ? cloneElement(children, { "aria-describedby": hintId }) : children}
      </label>
      {hint && (
        <p id={hintId} className="mt-1.5 text-[13px] text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  );
}

/**
 * A checkbox with its label beside it and help under the label. The whole
 * block is the click target, but only the first line is the checkbox's name.
 */
export function Check({
  name,
  label,
  hint,
  defaultChecked,
}: {
  name: string;
  label: string;
  hint?: string;
  defaultChecked?: boolean;
}) {
  const id = useId();
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        aria-labelledby={`${id}-label`}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className="mt-0.5 size-[18px] shrink-0 accent-[var(--primary)]"
      />
      <span className="min-w-0">
        <span id={`${id}-label`} className="block text-sm font-medium">
          {label}
        </span>
        {hint && (
          <span id={`${id}-hint`} className="mt-0.5 block text-[13px] text-muted-foreground">
            {hint}
          </span>
        )}
      </span>
    </label>
  );
}
