/**
 * Standard Algebraic Notation for the move history.
 *
 * Kept separate from state transitions: SAN needs the position *before* the
 * move (for disambiguation) and the outcome *after* it (for + / #), both of
 * which are passed in, so this module stays free of engine dependencies.
 */

import { FILE_NAMES, fileOf, rankOf, squareName } from './board';
import { getPieceDefinition } from './pieces';
import type { Move, PieceType } from './types';

export interface MoveOutcome {
  readonly check: boolean;
  readonly checkmate: boolean;
}

const notationLetter = (type: PieceType): string => {
  const definition = getPieceDefinition(type);
  return definition.notation ?? definition.symbol.toUpperCase();
};

/**
 * @param move            the move being described
 * @param legalMoves      all legal moves in the position before the move
 * @param outcome         whether the move gives check / checkmate
 */
export function toSan(move: Move, legalMoves: readonly Move[], outcome: MoveOutcome): string {
  const suffix = outcome.checkmate ? '#' : outcome.check ? '+' : '';

  if (move.special === 'castle-kingside') return `O-O${suffix}`;
  if (move.special === 'castle-queenside') return `O-O-O${suffix}`;
  if (move.special === 'royal-swap') {
    return `${notationLetter(move.piece)}~${squareName(move.to)}${suffix}`;
  }
  if (move.special === 'transform') {
    return `${notationLetter(move.piece)}${squareName(move.from)}=${move.promotion ? notationLetter(move.promotion) : '?'}${suffix}`;
  }

  const letter = notationLetter(move.piece);
  const capture = move.captured || move.extraCaptures?.length ? 'x' : '';
  const destination = squareName(move.to);
  const promotion = move.promotion ? `=${notationLetter(move.promotion)}` : '';

  if (letter === '') {
    // Pawn: captures are written with the origin file, e.g. "exd5".
    const origin = move.captured ? `${FILE_NAMES[fileOf(move.from)]}` : '';
    return `${origin}${capture}${destination}${promotion}${suffix}`;
  }

  return `${letter}${disambiguate(move, legalMoves)}${capture}${destination}${promotion}${suffix}`;
}

/** Minimal origin hint needed to distinguish this move from its rivals. */
function disambiguate(move: Move, legalMoves: readonly Move[]): string {
  const rivals = legalMoves.filter(
    (other) =>
      other.piece === move.piece &&
      other.color === move.color &&
      other.to === move.to &&
      other.from !== move.from,
  );
  if (rivals.length === 0) return '';

  const sameFile = rivals.some((other) => fileOf(other.from) === fileOf(move.from));
  const sameRank = rivals.some((other) => rankOf(other.from) === rankOf(move.from));

  if (!sameFile) return FILE_NAMES[fileOf(move.from)] ?? '';
  if (!sameRank) return String(rankOf(move.from) + 1);
  return squareName(move.from);
}

/** "1. e4 e5 2. Nf3" style listing, useful for exports and debugging. */
export function toMoveList(sanMoves: readonly string[], startingColor: 'white' | 'black' = 'white'): string {
  const parts: string[] = [];
  let moveNumber = 1;
  let index = 0;
  if (startingColor === 'black' && sanMoves.length > 0) {
    parts.push(`1... ${sanMoves[0]}`);
    index = 1;
    moveNumber = 2;
  }
  for (; index < sanMoves.length; index += 2) {
    const white = sanMoves[index];
    const black = sanMoves[index + 1];
    parts.push(`${moveNumber}. ${white}${black ? ` ${black}` : ''}`);
    moveNumber++;
  }
  return parts.join(' ');
}
