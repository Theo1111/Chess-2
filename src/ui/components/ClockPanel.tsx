import type { Color } from '../../engine';
import { formatClock } from '../timeControls';
import type { GameClock } from '../useGameClock';

interface ClockPanelProps {
  clock: GameClock;
  /** Side to move — drives which face is highlighted as ticking. */
  turn: Color;
  gameOver: boolean;
}

/** Both players' clocks. Renders nothing at all in an untimed game. */
export function ClockPanel({ clock, turn, gameOver }: ClockPanelProps) {
  if (!clock.enabled) return null;

  const face = (color: Color) => {
    const ms = clock.remaining[color];
    const active = !gameOver && clock.flagged === null && turn === color;
    const low = ms <= 30_000;
    const out = ms <= 0;
    return (
      <div
        key={color}
        className={[
          'clock__face',
          `clock__face--${color}`,
          active ? 'clock__face--active' : '',
          low && !out ? 'clock__face--low' : '',
          out ? 'clock__face--out' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <span className="clock__label">
          <span className={`swatch swatch--${color}`} />
          {color === 'white' ? 'White' : 'Black'}
        </span>
        <span className="clock__time" aria-label={`${color} clock`}>
          {formatClock(ms)}
        </span>
      </div>
    );
  };

  return (
    <section className="panel clock">
      {face('black')}
      {face('white')}
    </section>
  );
}
