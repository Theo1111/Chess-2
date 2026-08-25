/**
 * Board-level card state: regions, square statuses and trap placements.
 *
 * Three reusable containers, all plain serializable data on `GameState`:
 *
 *  - **Regions** (`regions`): a set of squares under an area effect —
 *    Smoke Screen (visual concealment) and Null Field (spell suppression).
 *  - **Square statuses** (`squareStatuses`): per-square gameplay metadata —
 *    Sacred Ground (card immunity for the occupant), active Dead Zones and
 *    Walls (both blocked terrain).
 *  - **Portals** (`portals`): pairs of linked squares a piece may step
 *    between. Terrain that was built stays built, so unlike everything else
 *    here they carry no duration.
 *  - **Trap placements** (`traps`): hidden one-shot board effects with a
 *    standard hidden/revealed lifecycle, detectable by Sonar-style scans
 *    and disabled by Interference-style spells.
 *
 * Durations are counted in plies: `pliesRemaining` is decremented at every
 * real turn start (main phase) and the entry is removed when it reaches 0 —
 * so an entry created with N survives N−1 turns of play.
 */

import { fileOf, isInside, makeSquare, rankOf } from './board';
import type { Color, GameState, Square } from './types';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type RegionKind = 'smoke' | 'null-field';

export interface RegionEffect {
  readonly id: string;
  readonly kind: RegionKind;
  readonly owner: Color;
  readonly center: Square;
  readonly squares: readonly Square[];
  readonly pliesRemaining: number;
}

export type SquareStatusKind = 'sacred-ground' | 'dead-zone' | 'wall';

export interface SquareStatus {
  readonly id: string;
  readonly kind: SquareStatusKind;
  readonly owner: Color;
  readonly square: Square;
  readonly pliesRemaining: number;
}

/**
 * Two linked squares. A piece standing on one may step out of the other —
 * see `portalExit` and the move generator. Both squares are stored so
 * either end works; a square belongs to at most one pair.
 */
export interface PortalPair {
  readonly id: string;
  readonly owner: Color;
  readonly squares: readonly [Square, Square];
}

export type TrapKind = 'tripwire' | 'sonar' | 'web-trap' | 'dead-zone' | 'mine';

export interface TrapPlacement {
  readonly id: string;
  readonly trap: TrapKind;
  readonly owner: Color;
  readonly square: Square;
  /** Known to the opponent (Sonar scan, or triggering). Owner always sees it. */
  readonly revealed: boolean;
  /** Still able to fire. Disarmed traps are kept out of play and pruned. */
  readonly armed: boolean;
  /** Dead Zone only: the piece whose departure will activate the zone. */
  readonly pendingPieceId?: string;
}

/* ------------------------------------------------------------------ */
/* Geometry                                                            */
/* ------------------------------------------------------------------ */

/** The 3×3 block centred on a square, clipped to the board. */
export function regionSquares(center: Square): Square[] {
  const squares: Square[] = [];
  const file = fileOf(center);
  const rank = rankOf(center);
  for (let df = -1; df <= 1; df++) {
    for (let dr = -1; dr <= 1; dr++) {
      if (isInside(file + df, rank + dr)) squares.push(makeSquare(file + df, rank + dr));
    }
  }
  return squares;
}

/* ------------------------------------------------------------------ */
/* Queries                                                             */
/* ------------------------------------------------------------------ */

const EMPTY_SET: ReadonlySet<Square> = new Set();

/** Squares that are impassable terrain right now (Dead Zones and Walls). */
export function blockedSquares(state: GameState): ReadonlySet<Square> {
  if (state.squareStatuses.length === 0) return EMPTY_SET;
  const blocked = new Set<Square>();
  for (const status of state.squareStatuses) {
    if (status.kind === 'dead-zone' || status.kind === 'wall') blocked.add(status.square);
  }
  return blocked.size ? blocked : EMPTY_SET;
}

/**
 * Where a piece standing on `square` may emerge, or null if the square is
 * not a portal. Only the far end is offered: a portal you are standing on
 * is a door, not a destination.
 */
export function portalExit(state: GameState, square: Square): Square | null {
  for (const portal of state.portals) {
    const [a, b] = portal.squares;
    if (a === square) return b;
    if (b === square) return a;
  }
  return null;
}

/** True if the square is either end of any portal. */
export const isPortal = (state: GameState, square: Square): boolean =>
  state.portals.some((portal) => portal.squares[0] === square || portal.squares[1] === square);

/** True if the piece standing on `square` is immune to card effects. */
export function isCardImmuneAt(state: GameState, square: Square): boolean {
  if (state.squareStatuses.length === 0) return false;
  if (!state.board[square]) return false;
  return state.squareStatuses.some(
    (status) => status.kind === 'sacred-ground' && status.square === square,
  );
}

/** Squares inside any active Null Field — spells may not target them. */
export function nullFieldSquares(state: GameState): ReadonlySet<Square> {
  if (state.regions.length === 0) return EMPTY_SET;
  const set = new Set<Square>();
  for (const region of state.regions) {
    if (region.kind === 'null-field') for (const square of region.squares) set.add(square);
  }
  return set.size ? set : EMPTY_SET;
}

/** Squares under smoke that `viewer` may not see enemy pieces on. */
export function obscuredSquaresFor(state: GameState, viewer: Color): ReadonlySet<Square> {
  if (state.regions.length === 0) return EMPTY_SET;
  const set = new Set<Square>();
  for (const region of state.regions) {
    if (region.kind === 'smoke' && region.owner !== viewer) {
      for (const square of region.squares) set.add(square);
    }
  }
  return set.size ? set : EMPTY_SET;
}

/** The traps `viewer` is entitled to know about. UIs must use this. */
export function visibleTraps(state: GameState, viewer: Color): TrapPlacement[] {
  return state.traps.filter((trap) => trap.owner === viewer || trap.revealed);
}

/** Armed trap on a square, if any. */
export function trapAt(state: GameState, square: Square): TrapPlacement | undefined {
  return state.traps.find((trap) => trap.square === square && trap.armed);
}

/* ------------------------------------------------------------------ */
/* Lifecycle                                                           */
/* ------------------------------------------------------------------ */

/** One turn has genuinely begun: age everything counted in plies. */
export function tickPlies<T extends { readonly pliesRemaining: number }>(
  entries: readonly T[],
): readonly T[] {
  if (entries.length === 0) return entries;
  return entries
    .map((entry) => ({ ...entry, pliesRemaining: entry.pliesRemaining - 1 }))
    .filter((entry) => entry.pliesRemaining > 0);
}

/**
 * Hidden-effect detection (Sonar): reveal every enemy trap inside `squares`.
 * Detection informs — nothing is disarmed. Future hidden effects join by
 * carrying the same hidden/revealed shape.
 */
export function revealHiddenIn(
  traps: readonly TrapPlacement[],
  squares: ReadonlySet<Square>,
  scanner: Color,
): { traps: readonly TrapPlacement[]; found: TrapPlacement[] } {
  const found: TrapPlacement[] = [];
  const next = traps.map((trap) => {
    if (trap.owner === scanner || trap.revealed || !squares.has(trap.square)) return trap;
    const revealed = { ...trap, revealed: true };
    found.push(revealed);
    return revealed;
  });
  return { traps: found.length ? next : traps, found };
}
