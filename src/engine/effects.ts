/**
 * Effects — statuses attached to pieces (Shield, Freeze, relics, curses).
 *
 * Effects are plain data in `GameState.effects`, keyed to a piece's stable id
 * so they follow the piece when it moves. An effect either expires at a named
 * turn boundary (`expiresAtTurnStartOf`) or lasts until something consumes
 * it (`null`) — a relic is worn until it is used, a curse until it resolves.
 * `tickEffects` is called at every real turn boundary.
 *
 * Enforcement lives in the engine's existing funnels:
 *   shield        → captureRules.captureAllowed (blocks every capture producer)
 *   freeze        → auras.isImmobilized         (blocks movement and attacks)
 *   mirror-shield → spells.castSpell            (fizzles the first enemy card)
 *   crown         → game.applyMove              (opens a bonus Pawn move)
 *   decay         → beginTurn, below            (crumbles the piece)
 *
 * New cards add a kind here plus one check in the relevant funnel — no
 * per-card booleans scattered through the state.
 */

import type { Board, Color, GameState, PieceType } from './types';

export type EffectKind =
  | 'shield'
  | 'freeze'
  | 'webbed'
  /** Relic: cancels the first enemy card that targets the wearer. */
  | 'mirror-shield'
  /** Relic: the wearer's next move also buys its owner a bonus Pawn move. */
  | 'crown'
  /** Curse: the piece crumbles after three of its owner's turns. */
  | 'decay';

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
   * Freeze both expire at the start of their caster's next turn. Null for an
   * effect that lasts until it is used or resolves — relics and curses.
   */
  readonly expiresAtTurnStartOf: Color | null;
  /**
   * Turns of the AFFECTED piece's owner still to come before the effect
   * resolves. Counted down by `beginTurn`; only Decay uses it.
   */
  readonly turnsRemaining?: number;
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

/** True if the piece carries an effect of this kind. */
export const hasEffect = (
  effects: readonly ActiveEffect[],
  kind: EffectKind,
  pieceId: string,
): boolean => effects.some((effect) => effect.kind === kind && effect.targetPieceId === pieceId);

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
 * expires everything scheduled for that boundary. Effects with no expiry
 * (relics, curses) are never swept up here.
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

/** What a turn boundary did to the board's pieces and their effects. */
export interface TurnStart {
  readonly board: Board;
  readonly effects: readonly ActiveEffect[];
  /** Pieces that crumbled here. They join their owner's reserves. */
  readonly decayed: readonly { readonly type: PieceType; readonly color: Color }[];
}

/**
 * One turn begins: effects age, and any Decay curse whose victim belongs to
 * the side now to move counts down — reaching zero destroys the piece where
 * it stands.
 *
 * Destruction, not capture: nothing is credited to the curse's caster, and no
 * on-capture ability triggers. A piece crumbling can leave its own King in
 * check, which is a legal position its owner must simply answer — it is their
 * turn, after all. Kings and Queen-class pieces cannot be cursed in the first
 * place (see the Decay card), so no game ends by decay alone.
 */
export function beginTurn(
  board: Board,
  effects: readonly ActiveEffect[],
  turn: Color,
  phase: 'main' | 'bonus',
): TurnStart {
  const ticked = tickEffects(effects, board, turn, phase);
  if (phase !== 'main' || !ticked.some((effect) => effect.kind === 'decay')) {
    return { board, effects: ticked, decayed: [] };
  }

  const byId = new Map<string, { square: number; type: PieceType; color: Color }>();
  for (let square = 0; square < board.length; square++) {
    const piece = board[square];
    if (piece) byId.set(piece.id, { square, type: piece.type, color: piece.color });
  }

  const decayed: { type: PieceType; color: Color }[] = [];
  const removed: number[] = [];
  const next: ActiveEffect[] = [];

  for (const effect of ticked) {
    if (effect.kind !== 'decay') {
      next.push(effect);
      continue;
    }
    const victim = byId.get(effect.targetPieceId);
    // Not this player's piece: the curse waits for its owner's turn.
    if (!victim || victim.color !== turn) {
      next.push(effect);
      continue;
    }
    const left = (effect.turnsRemaining ?? 1) - 1;
    if (left > 0) {
      next.push({ ...effect, turnsRemaining: left });
      continue;
    }
    removed.push(victim.square);
    decayed.push({ type: victim.type, color: victim.color });
  }

  if (removed.length === 0) return { board, effects: next, decayed: [] };

  const crumbled = board.slice();
  for (const square of removed) crumbled[square] = null;
  return { board: crumbled, effects: pruneEffects(next, crumbled), decayed };
}

