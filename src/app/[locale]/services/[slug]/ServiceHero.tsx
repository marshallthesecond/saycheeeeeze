// The drawn hero: a gradient built from the service's accent, one large
// graphic bleeding off the corner, and the title. No photograph.
//
// A stand-in photograph is worse than none — a frame of something else says
// "this is a photography service" and nothing about which one. A drawn
// mortarboard says "graduation" at a glance without pretending to be work that
// hasn't been done. Drop `hero` from the service once there are real
// photographs and the photo hero comes back; that is the intended direction.
//
// The cap runs off the top-right corner rather than sitting centred, placed so
// the crown stays inside the frame — board alone is a rhombus, board plus
// crown is unmistakably a cap. The tassel is the first thing the crop takes,
// so the offsets keep as much of it as the composition allows rather than
// maximising the cap.
//
// Every gradient stop is mixed from `accent`, so a second service adopting
// this hero gets a coherent palette from its own colour with no new CSS.

import { accentRgb, shade } from './accent';

interface Props {
  title: string;
  tagline: string;
  eyebrow: React.ReactNode;
  accent: string;
  Icon: React.ComponentType<{ className?: string }>;
}

export default function ServiceHero({ title, tagline, eyebrow, accent, Icon }: Props) {
  const rgb = accentRgb(accent);

  // Two layers: a glow anchored where the cap sits, over a diagonal wash.
  // Ends transparent rather than at black, so the page background shows
  // through and there is no seam to line up.
  const background = [
    `radial-gradient(125% 95% at 76% 10%, ${shade(rgb, 0.06, 0.55)} 0%, transparent 62%)`,
    `linear-gradient(168deg, ${shade(rgb, -0.55)} 0%, ${shade(rgb, -0.78)} 46%, transparent 100%)`,
  ].join(', ');

  return (
    <div
      className="relative w-full overflow-hidden h-[44vh] min-h-[300px] max-h-[400px] sm:h-[52vh] sm:max-h-[520px]"
      style={{ background }}
    >
      <Mortarboard
        className="pointer-events-none absolute -right-[68px] -top-[54px] h-[78%] max-h-[330px] sm:-right-16 sm:-top-14 sm:max-h-[420px]"
        stroke={shade(rgb, 0.62, 0.4)}
        fill={shade(rgb, 0.28, 0.17)}
      />

      {/* Fades the graphic out before the text begins, so the headline sits on
          a settled ground rather than over a line of the drawing. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-36"
        style={{ background: 'linear-gradient(to bottom, transparent, var(--background, #0b0d0f) 88%)' }}
      />

      <div className="absolute inset-x-0 bottom-0 px-4 pb-5 sm:px-8 sm:pb-7">
        <div className="mb-2.5 flex items-center gap-2">
          <span
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg shadow-lg"
            style={{ background: accent }}
          >
            <Icon className="h-3.5 w-3.5 text-white" />
          </span>
          <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/70">
            {eyebrow}
          </span>
        </div>
        <h1 className="max-w-3xl text-[30px] font-extrabold leading-[0.95] tracking-tighter sm:text-6xl">
          {title}
        </h1>
        <p className="mt-2.5 max-w-xl text-sm leading-relaxed text-white/75 sm:text-base">
          {tagline}
        </p>
      </div>
    </div>
  );
}

/**
 * A mortarboard, drawn rather than iconified.
 *
 * The crown starts at y=96 because that's where the board's lower-left edge
 * passes through x=58; start it higher and the crown pokes out above the board
 * as two stray stubs. The tassel runs from the centre button along the board
 * and over the right corner, where a real one hangs from.
 *
 * Exported because the photographic hero uses it too, at a far lower contrast —
 * there it is a watermark behind the frames rather than the subject.
 */
export function Mortarboard({
  className,
  stroke,
  fill,
}: {
  className?: string;
  stroke: string;
  fill: string;
}) {
  return (
    <svg
      className={className}
      viewBox="0 0 200 200"
      fill="none"
      aria-hidden
      focusable="false"
    >
      {/* The board is filled as well as stroked: at this size a pure outline
          reads as a wireframe, and the soft fill is what makes it sit in the
          gradient instead of floating over it. */}
      <path d="M100 28 L192 70 L100 112 L8 70 Z" fill={fill} />
      <g
        stroke={stroke}
        strokeWidth={1.8}
        strokeLinejoin="round"
        strokeLinecap="round"
      >
        <path d="M58 96 L58 114 C58 130 76 139 100 139 C124 139 142 130 142 114 L142 96" />
        <path d="M100 28 L192 70 L100 112 L8 70 Z" />
        <path d="M100 70 L176 74 Q184 76 184 86 L184 126" />
      </g>
      <path d="M177 126 h14 l-2 15 a5 5 0 0 1 -10 0 Z" fill={stroke} />
    </svg>
  );
}
