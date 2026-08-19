import { useCallback, useEffect, useRef, useState } from 'react';
import type { Color, GameState } from '../engine';
import { chargeClock, getTimeControl, type ClockState, type TimeControlId } from './timeControls';

/**
 * The match clock.
 *
 * Deliberately outside the engine: `GameState` stays a pure function of the
 * moves played, which is what lets the balance laboratory replay hundreds of
 * thousands of games deterministically with no wall clock in sight.
 *
 * Timing is measured from `Date.now()` deltas rather than counted ticks, so a
 * throttled background tab (browsers slow timers to ~1/s when hidden) still
 * deducts the real elapsed time instead of silently gaining the player time.
 *
 * Whose clock runs is read from the engine: `game.turn`. A bonus phase keeps
 * the same side to move, so their clock correctly keeps running through it.
 */

export interface GameClock {
  /** Remaining milliseconds per side; both Infinity when untimed. */
  readonly remaining: ClockState;
  /** True once a side has run out. */
  readonly flagged: Color | null;
  /** False for an untimed game — the UI hides the clocks entirely. */
  readonly enabled: boolean;
  /** True while time is actually being deducted (first move played, game live). */
  readonly running: boolean;
  /** Reset for a new game with the same time control. */
  readonly reset: () => void;
}

const TICK_MS = 100;

export function useGameClock(
  game: GameState,
  timeControl: TimeControlId,
  gameOver: boolean,
): GameClock {
  const control = getTimeControl(timeControl);
  const budget = control.ms;
  const enabled = budget !== null;

  const initial = useCallback(
    (): ClockState => ({
      white: budget ?? Number.POSITIVE_INFINITY,
      black: budget ?? Number.POSITIVE_INFINITY,
    }),
    [budget],
  );

  const [remaining, setRemaining] = useState<ClockState>(initial);
  const [flagged, setFlagged] = useState<Color | null>(null);
  /** Wall-clock stamp the current side's deduction is measured from. */
  const sinceRef = useRef<number | null>(null);

  // Standard chess convention: White's clock is running the moment the match
  // begins. Waiting for the first move instead would hand White a free move
  // while Black is charged from theirs.
  const running = enabled && !gameOver && flagged === null;
  const turn = game.turn;

  const reset = useCallback(() => {
    setRemaining(initial());
    setFlagged(null);
    sinceRef.current = null;
  }, [initial]);

  // A new game (or a changed time control) rewinds the clocks.
  useEffect(() => {
    reset();
  }, [reset]);

  // Hand over the clock when the turn changes: the outgoing side is charged
  // for the exact time they held it before the new side's stamp begins.
  useEffect(() => {
    if (!running) {
      sinceRef.current = null;
      return;
    }
    sinceRef.current = Date.now();
  }, [running, turn]);

  useEffect(() => {
    if (!running) return;

    const tick = (): void => {
      const since = sinceRef.current;
      if (since === null) return;
      const elapsed = Date.now() - since;
      sinceRef.current = Date.now();

      setRemaining((current) => {
        const charge = chargeClock(current, turn, elapsed);
        if (charge.flagged) setFlagged(charge.flagged);
        return charge.remaining;
      });
    };

    const handle = window.setInterval(tick, TICK_MS);
    // A hidden tab throttles intervals; settle up the moment it returns.
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      window.clearInterval(handle);
      document.removeEventListener('visibilitychange', onVisible);
      tick(); // charge the time held up to this transition
    };
  }, [running, turn]);

  return { remaining, flagged, enabled, running, reset };
}
