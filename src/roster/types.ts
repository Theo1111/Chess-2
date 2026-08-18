import type { Color, PieceType, Square } from '../engine';

/**
 * One bought piece. `id` is an instance handle: two Champions are two units
 * with the same `type` but different ids, so placement can tell them apart.
 */
export interface RosterUnit {
  readonly id: string;
  readonly type: PieceType;
}

/**
 * A player's army: what they bought and where it starts. Deliberately separate
 * from the board — a roster is a plan, the board is a game in progress. This
 * is what saved rosters, formats and matchmaking will hand around later.
 */
export interface Roster {
  readonly color: Color;
  readonly budget: number;
  readonly units: readonly RosterUnit[];
  /** Unit id → starting square. Empty until the placement step. */
  readonly placement: Readonly<Record<string, Square>>;
  /** The army's Spell Card deck — exactly five for a standard match. */
  readonly spellIds: readonly string[];
  /** The army's Trap Card deck — exactly five, fully separate from spells. */
  readonly trapIds: readonly string[];
}

export type RosterErrorCode =
  | 'unknown-piece'
  | 'not-draftable'
  | 'missing-king'
  | 'too-many-kings'
  | 'no-units'
  | 'too-many-units'
  | 'over-budget'
  | 'duplicate-unit-id'
  | 'unplaced-unit'
  | 'square-outside-zone'
  | 'square-occupied'
  | 'placement-collision'
  | 'spells-incomplete'
  | 'traps-incomplete'
  | 'invalid-card'
  | 'duplicate-card';

export interface RosterError {
  readonly code: RosterErrorCode;
  readonly message: string;
  /** The unit or square the problem relates to, when there is one. */
  readonly unitId?: string;
  readonly square?: Square;
}

export interface RosterValidation {
  readonly valid: boolean;
  readonly errors: readonly RosterError[];
}
