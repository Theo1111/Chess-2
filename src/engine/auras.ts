/**
 * Auras — abilities one piece projects onto other squares.
 *
 * Two things are computed for a whole position at once:
 *   - `granted`: extra movement patterns handed to the piece on a square
 *     (Archbishop's diagonal blessing, the General's command).
 *   - `immobilized`: squares whose piece cannot move or capture at all
 *     (caught in a Trapper's web).
 *
 * The result is derived purely from the board, cached per board array, and
 * skipped entirely when no ability piece is in play — so standard chess pays
 * nothing for this system.
 */

import { BOARD_SIZE, fileOf, isInside, makeSquare, rankOf } from './board';
import { hasAuraAbility } from './abilities';
import { isMovementBlocked } from './effects';
import { DIAGONAL, ORTHOGONAL, getPieceDefinition } from './pieces';
import type { MovementPattern, PieceDefinition } from './pieces';
import type { Board, GameState, Piece, Square } from './types';

export interface AuraInfo {
  /** Extra patterns for the piece standing on each square. */
  readonly granted: ReadonlyMap<Square, readonly MovementPattern[]>;
  /** Squares whose occupant may not move or capture. */
  readonly immobilized: ReadonlySet<Square>;
}

const EMPTY_AURAS: AuraInfo = { granted: new Map(), immobilized: new Set() };

const auraCache = new WeakMap<object, AuraInfo>();

/** True if this piece changes what other pieces can do, or needs live state. */
export const isAbilityPiece = (definition: PieceDefinition): boolean =>
  Boolean(definition.abilities?.length || definition.dynamicPatterns || definition.canMove);

/** Scan for ability pieces — used to maintain `GameState.hasAbilityPieces`. */
export function boardHasAbilityPieces(board: Board): boolean {
  for (let square = 0; square < BOARD_SIZE; square++) {
    const piece = board[square];
    if (piece && isAbilityPiece(getPieceDefinition(piece.type))) return true;
  }
  return false;
}

export function getAuras(state: GameState): AuraInfo {
  if (!state.hasAbilityPieces) return EMPTY_AURAS;
  const cached = auraCache.get(state.board as object);
  if (cached) return cached;
  const computed = computeAuras(state.board);
  auraCache.set(state.board as object, computed);
  return computed;
}

function computeAuras(board: Board): AuraInfo {
  const granted = new Map<Square, MovementPattern[]>();
  const immobilized = new Set<Square>();

  const grant = (square: Square, patterns: readonly MovementPattern[]) => {
    const existing = granted.get(square);
    if (existing) existing.push(...patterns);
    else granted.set(square, [...patterns]);
  };

  for (let square = 0; square < BOARD_SIZE; square++) {
    const piece = board[square];
    if (!piece) continue;
    const abilities = getPieceDefinition(piece.type).abilities;
    if (!hasAuraAbility(abilities)) continue;

    for (const ability of abilities ?? []) {
      if (ability.kind === 'grant-patterns') {
        if (ability.scope === 'all-allies') {
          for (let other = 0; other < BOARD_SIZE; other++) {
            const ally = board[other];
            if (ally && ally.color === piece.color) grant(other, ability.patterns);
          }
        } else {
          for (const neighbour of neighbours(board, square, DIAGONAL)) {
            if (neighbour.piece.color === piece.color) grant(neighbour.square, ability.patterns);
          }
        }
      } else if (ability.kind === 'immobilize-adjacent-enemies') {
        for (const neighbour of neighbours(board, square, [...ORTHOGONAL, ...DIAGONAL])) {
          const other = neighbour.piece;
          // A Trapper cannot trap another Trapper.
          if (other.color !== piece.color && other.type !== piece.type) {
            immobilized.add(neighbour.square);
          }
        }
      }
    }
  }

  return { granted, immobilized };
}

function neighbours(
  board: Board,
  square: Square,
  directions: readonly (readonly [number, number])[],
): { square: Square; piece: Piece }[] {
  const found: { square: Square; piece: Piece }[] = [];
  const file = fileOf(square);
  const rank = rankOf(square);
  for (const [deltaFile, deltaRank] of directions) {
    const nextFile = file + deltaFile;
    const nextRank = rank + deltaRank;
    if (!isInside(nextFile, nextRank)) continue;
    const target = makeSquare(nextFile, nextRank);
    const piece = board[target];
    if (piece) found.push({ square: target, piece });
  }
  return found;
}

/** True if the piece on this square is currently unable to move or capture. */
export function isImmobilized(state: GameState, square: Square): boolean {
  if (state.effects.length > 0) {
    const piece = state.board[square];
    if (piece && isMovementBlocked(state.effects, piece.id)) return true;
  }
  return state.hasAbilityPieces && getAuras(state).immobilized.has(square);
}

/**
 * Everything the piece on `square` can currently do: its own patterns, any
 * state-derived patterns (Avenger), and any granted by friendly auras.
 */
export function effectivePatterns(
  state: GameState,
  square: Square,
  piece: Piece,
): readonly MovementPattern[] {
  const definition = getPieceDefinition(piece.type);
  const granted = state.hasAbilityPieces ? getAuras(state).granted.get(square) : undefined;

  if (!definition.dynamicPatterns && !granted) return definition.patterns;

  const patterns: MovementPattern[] = [...definition.patterns];
  if (definition.dynamicPatterns) patterns.push(...definition.dynamicPatterns({ state, square, piece }));
  if (granted) patterns.push(...granted);
  return patterns;
}
