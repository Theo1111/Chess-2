/**
 * Attack detection: "is this square attacked by that colour?".
 *
 * Works off each piece's *effective* patterns, so granted movement (an
 * Archbishop's blessing) creates real threats and immobilised pieces (caught by
 * a Trapper) threaten nothing. Custom pieces get correct check detection for
 * free. Special moves are excluded — castling and pawn double-pushes never
 * attack anything.
 */

import { effectivePatterns, isImmobilized } from './auras';
import { BOARD_SIZE } from './board';
import { walkPatterns } from './patterns';
import { getPieceDefinition } from './pieces';
import type { Color, GameState, Square } from './types';

/** True if the piece on `from` attacks `target` via one of its patterns. */
export function pieceAttacks(state: GameState, from: Square, target: Square): boolean {
  const piece = state.board[from];
  if (!piece) return false;
  if (isImmobilized(state, from)) return false;

  // Threats no pattern can express (the Battering Ram's crush).
  const definition = getPieceDefinition(piece.type);
  if (definition.attackSquares?.(state.board, from, piece.color).includes(target)) {
    return true;
  }

  let found = false;
  walkPatterns(
    state.board,
    from,
    piece.color,
    effectivePatterns(state, from, piece),
    (to) => {
      if (to === target) found = true;
    },
    { captureOnly: true },
  );
  return found;
}

/** True if any piece of `attacker` colour attacks `target`. */
export function isSquareAttackedBy(state: GameState, target: Square, attacker: Color): boolean {
  for (let from = 0; from < BOARD_SIZE; from++) {
    const piece = state.board[from];
    if (!piece || piece.color !== attacker) continue;
    if (pieceAttacks(state, from, target)) return true;
  }
  return false;
}

/** Every square of `attacker` colour that attacks `target`. */
export function attackersOf(state: GameState, target: Square, attacker: Color): Square[] {
  const squares: Square[] = [];
  for (let from = 0; from < BOARD_SIZE; from++) {
    const piece = state.board[from];
    if (!piece || piece.color !== attacker) continue;
    if (pieceAttacks(state, from, target)) squares.push(from);
  }
  return squares;
}
