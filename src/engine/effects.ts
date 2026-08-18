/**
 * Temporary effects — timed statuses attached to pieces (Shield, Freeze).
 *
 * Effects are plain data in `GameState.effects`, keyed to a piece's stable id
 * so they follow the piece when it moves. Each effect names the turn-start at
 * which it expires; `tickEffects` is called at every real turn boundary.
 *
 * Enforcement lives in the engine's existing funnels:
 *   shield → captureRules.captureAllowed (blocks every capture producer)
 *   freeze → auras.isImmobilized        (blocks all movement and attacks)
 *
 * Future trap cards and power-ups add new kinds here plus one check in the
 * relevant funnel — no per-card booleans scattered through the state.
 */

import type { Board, Color, GameState } from './types';

export type EffectKind = 'shield' | 'freeze' | 'webbed';

export interface ActiveEffect {
  /** Deterministic id: `${kind}:${targetPieceId}:${fullmove}`. */
  readonly id: string;
  readonly kind: EffectKind;
  /** Who cast it. */
  readonly caster: Color;
  /** The affected piece, by stable piece id (effects follow the piece). */
  readonly targetPieceId: string;
  /**
   * The effect ends when this colour's turn begins (main phase). Shield and
   * Freeze both expire at the start of their caster's next turn.
   */
  readonly expiresAtTurnStartOf: Color;
}

export const isShielded = (effects: readonly ActiveEffect[], pieceId: string): boolean =>
  effects.some((effect) => effect.kind === 'shield' && effect.targetPieceId === pieceId);

export const isFrozen = (effects: readonly ActiveEffect[], pieceId: string): boolean =>
  effects.some((effect) => effect.kind === 'freeze' && effect.targetPieceId === pieceId);

/** Frozen or webbed: the piece may not move or act through movement. */
export const isMovementBlocked = (effects: readonly ActiveEffect[], pieceId: string): boolean =>
  effects.some(
    (effect) =>
      (effect.kind === 'freeze' || effect.kind === 'webbed') && effect.targetPieceId === pieceId,
  );

/** Effect on the piece standing on `square`, if any. */
export function effectsOnSquare(state: GameState, square: number): ActiveEffect[] {
  const piece = state.board[square];
  if (!piece || state.effects.length === 0) return [];
  return state.effects.filter((effect) => effect.targetPieceId === piece.id);
}

/** Drops effects whose target has left the board (captured, destroyed). */
export function pruneEffects(
  effects: readonly ActiveEffect[],
  board: Board,
): readonly ActiveEffect[] {
  if (effects.length === 0) return effects;
  const alive = new Set<string>();
  for (const piece of board) if (piece) alive.add(piece.id);
  const kept = effects.filter((effect) => alive.has(effect.targetPieceId));
  return kept.length === effects.length ? effects : kept;
}

/**
 * Advances effects across a turn boundary: prunes dead targets and, when a
 * player's turn genuinely begins (main phase — not a Duelist bonus window),
 * expires everything scheduled for that boundary.
 */
export function tickEffects(
  effects: readonly ActiveEffect[],
  board: Board,
  turn: Color,
  phase: 'main' | 'bonus',
): readonly ActiveEffect[] {
  const pruned = pruneEffects(effects, board);
  if (phase !== 'main') return pruned;
  const kept = pruned.filter((effect) => effect.expiresAtTurnStartOf !== turn);
  return kept.length === pruned.length ? pruned : kept;
}
