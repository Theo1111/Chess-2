/**
 * Match time controls.
 *
 * The clock is a MATCH rule, not a chess rule: the engine stays a pure,
 * deterministic function of moves (the balance laboratory replays thousands
 * of games with no wall clock at all), so nothing about time lives in
 * `GameState`. This module is the shared vocabulary; `useGameClock` runs it.
 */

export type TimeControlId = 'unlimited' | '5' | '10' | '15' | '30' | '60';

export interface TimeControl {
  readonly id: TimeControlId;
  readonly label: string;
  /** Starting time per player, or null for an untimed game. */
  readonly ms: number | null;
}

const minutes = (count: number): number => count * 60_000;

export const TIME_CONTROLS: readonly TimeControl[] = [
  { id: 'unlimited', label: 'Unlimited', ms: null },
  { id: '5', label: '5 min', ms: minutes(5) },
  { id: '10', label: '10 min', ms: minutes(10) },
  { id: '15', label: '15 min', ms: minutes(15) },
  { id: '30', label: '30 min', ms: minutes(30) },
  { id: '60', label: '1 hour', ms: minutes(60) },
];

export const DEFAULT_TIME_CONTROL: TimeControlId = 'unlimited';

export const getTimeControl = (id: TimeControlId): TimeControl =>
  TIME_CONTROLS.find((control) => control.id === id) ?? TIME_CONTROLS[0]!;

/** Remaining milliseconds per side. Infinity in an untimed game. */
export interface ClockState {
  readonly white: number;
  readonly black: number;
}

export interface ClockCharge {
  readonly remaining: ClockState;
  /** Set when this charge took a side to zero. */
  readonly flagged: 'white' | 'black' | null;
}

/**
 * Charges `elapsed` milliseconds to one side's clock — the whole time rule,
 * kept pure so it is testable without a DOM or a five-minute wait. Time never
 * goes negative, and hitting exactly zero flags.
 */
export function chargeClock(
  remaining: ClockState,
  color: 'white' | 'black',
  elapsed: number,
): ClockCharge {
  const current = remaining[color];
  if (!Number.isFinite(current)) return { remaining, flagged: null };

  const left = Math.max(0, current - Math.max(0, elapsed));
  return {
    remaining: { ...remaining, [color]: left },
    flagged: left === 0 ? color : null,
  };
}

/**
 * Clock face: `m:ss` normally, `m:ss.t` under ten seconds so the last moments
 * read as urgent. Never renders below zero.
 */
export function formatClock(ms: number): string {
  const safe = Math.max(0, ms);
  const totalSeconds = safe / 1000;
  const hours = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = Math.floor(totalSeconds % 60);
  const pad = (value: number): string => String(value).padStart(2, '0');

  if (hours > 0) return `${hours}:${pad(mins)}:${pad(secs)}`;
  if (safe < 10_000) return `${mins}:${pad(secs)}.${Math.floor((safe % 1000) / 100)}`;
  return `${mins}:${pad(secs)}`;
}
