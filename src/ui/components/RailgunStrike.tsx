import type { CSSProperties } from 'react';
import type { Color } from '../../engine';

interface RailgunStrikeProps {
  /** Whose Ruler gave the order — the beam is fired from their side. */
  caster: Color;
}

/** Motes of light dragged into the muzzle while the shot charges. */
const SPARKS = Array.from({ length: 16 }, (_, index) => index);
/** Rings that expand out of the impact line. */
const SHOCKS = [0, 1, 2];

/**
 * Ruler's Authority — the joke card's spectacle.
 *
 * Three beats: the rail charges (light is dragged out of the board into the
 * muzzle), it fires (a blinding horizontal lance, screen shake, chromatic
 * fringes), and the dust settles under the decree. Every bit of it is CSS
 * keyframes over a dozen divs — no assets, no canvas, nothing to preload.
 *
 * Decorative only: `pointer-events: none` throughout, and the whole thing is
 * replaced by a plain flash under `prefers-reduced-motion`.
 */
export function RailgunStrike({ caster }: RailgunStrikeProps) {
  return (
    <div className={`railgun railgun--${caster}`} aria-hidden="true">
      <div className="railgun__void" />
      <div className="railgun__grid" />

      <div className="railgun__charge">
        {SPARKS.map((index) => (
          <span
            key={index}
            className="railgun__spark"
            style={{ '--i': index, '--n': SPARKS.length } as CSSProperties}
          />
        ))}
        <span className="railgun__muzzle" />
      </div>

      <div className="railgun__aim" />

      <div className="railgun__beam">
        <span className="railgun__fringe railgun__fringe--cyan" />
        <span className="railgun__fringe railgun__fringe--magenta" />
        <span className="railgun__core" />
      </div>

      {SHOCKS.map((index) => (
        <span
          key={index}
          className="railgun__shock"
          style={{ '--i': index } as CSSProperties}
        />
      ))}

      <div className="railgun__flash" />

      <p className="railgun__banner">
        <span className="railgun__eyebrow">By decree of the crown</span>
        <span className="railgun__title">RULER’S AUTHORITY</span>
        <span className="railgun__sub">The board is cleared. Only the Ruler remains.</span>
      </p>
    </div>
  );
}
