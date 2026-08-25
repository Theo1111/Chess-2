/**
 * The online clock, as a pure projection of the game row.
 *
 * The server owns the numbers: it charges the mover on every action and is
 * the only thing that may end a game on time (see `supabase/online-clock.sql`).
 * All this does is answer "what would those numbers read right now", so the
 * countdown a player watches is always derived from what the row already
 * says rather than from anything the client has been keeping on its own.
 *
 * Pure and DOM-free, so the arithmetic that decides a lost game is testable
 * without waiting five minutes.
 */

import type { Color } from '../engine';
import type { ClockState } from '../ui/timeControls';
import type { GameClock } from '../ui/useGameClock';
import type { OnlineGameRow } from './online';

/** The parts of a game row the clock reads. */
export type ClockRow = Pick<
  OnlineGameRow,
  'status' | 'turn' | 'white_ms' | 'black_ms' | 'turn_started_at' | 'winner' | 'reason'
>;

const UNTIMED: ClockState = {
  white: Number.POSITIVE_INFINITY,
  black: Number.POSITIVE_INFINITY,
};

/**
 * @param serverNow Milliseconds since the epoch ON THE SERVER'S clock — the
 *   stamps in the row are the server's, so a device with a wrong system time
 *   must correct for its own offset before asking (see `useOnlineClock`).
 */
export function projectOnlineClock(row: ClockRow | null, serverNow: number): GameClock {
  const reset = (): void => undefined; // an online game is never rewound locally

  // Both sides are seeded together, so one null means the game is untimed.
  if (!row || row.white_ms === null || row.black_ms === null) {
    return { remaining: UNTIMED, flagged: null, enabled: false, running: false, reset };
  }

  const stored: ClockState = { white: row.white_ms, black: row.black_ms };

  // Only a live game burns time. A finished row already holds its final
  // numbers, and a drafting one has not started its clock.
  if (row.status !== 'active' || row.turn_started_at === null) {
    const flagged =
      row.status === 'finished' && row.reason === 'timeout' && row.winner !== null && row.winner !== 'draw'
        ? (opposite(row.winner) as Color)
        : null;
    return { remaining: stored, flagged, enabled: true, running: false, reset };
  }

  const held = Math.max(0, serverNow - new Date(row.turn_started_at).getTime());
  const mover = row.turn;
  const left = Math.max(0, stored[mover] - held);
  const remaining: ClockState = { ...stored, [mover]: left };

  return {
    remaining,
    flagged: left === 0 ? mover : null,
    enabled: true,
    running: true,
    reset,
  };
}

const opposite = (color: 'white' | 'black'): 'white' | 'black' =>
  color === 'white' ? 'black' : 'white';
