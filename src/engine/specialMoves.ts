/**
 * Moves that pure movement patterns cannot express: the pawn's double push,
 * en passant and promotion, and the king's castling.
 *
 * These are attached to piece definitions as hooks, so the rest of the engine
 * never special-cases "pawn" or "king" by name.
 */

import { fileOf, forwardDirection, makeSquare, pawnStartRank, promotionRank, rankOf } from './board';
import { blockedSquares } from './boardEffects';
import { isShielded } from './effects';
import { isImmobilized } from './auras';
import { CASTLING_RULES } from './castling';
import type { MoveGenContext } from './pieces';
import type { Move, PieceType } from './types';

/** Piece types a pawn may promote to, in UI order. */
export const PROMOTION_CHOICES: readonly PieceType[] = ['queen', 'rook', 'bishop', 'knight'];

export function generatePawnSpecialMoves(ctx: MoveGenContext): Move[] {
  const { state, from, color } = ctx;
  const { board } = state;
  const moves: Move[] = [];
  const direction = forwardDirection(color);
  const file = fileOf(from);
  const rank = rankOf(from);

  // Double push — only from the starting rank, and only over empty squares.
  // Skipped during attack probing: a double push never attacks anything.
  if (!ctx.attacksOnly && rank === pawnStartRank(color)) {
    const oneAhead = makeSquare(file, rank + direction);
    const twoAhead = makeSquare(file, rank + direction * 2);
    const blocked = blockedSquares(state);
    if (!board[oneAhead] && !board[twoAhead] && !blocked.has(oneAhead) && !blocked.has(twoAhead)) {
      moves.push({ from, to: twoAhead, piece: 'pawn', color, special: 'double-push' });
    }
  }

  // En passant.
  if (state.enPassant !== null) {
    const target = state.enPassant;
    if (rankOf(target) === rank + direction && Math.abs(fileOf(target) - file) === 1) {
      const capturedSquare = makeSquare(fileOf(target), rank);
      const capturedPiece = board[capturedSquare];
      if (capturedPiece && capturedPiece.color !== color && !isShielded(state.effects, capturedPiece.id)) {
        moves.push({
          from,
          to: target,
          piece: 'pawn',
          color,
          special: 'en-passant',
          captured: {
            type: capturedPiece.type,
            color: capturedPiece.color,
            id: capturedPiece.id,
            square: capturedSquare,
          },
        });
      }
    }
  }

  return moves;
}

/** Expands any pawn move that lands on the last rank into the four promotions. */
export function expandPawnPromotions(moves: readonly Move[], ctx: MoveGenContext): Move[] {
  const last = promotionRank(ctx.color);
  const result: Move[] = [];
  for (const move of moves) {
    if (rankOf(move.to) !== last) {
      result.push(move);
      continue;
    }
    for (const promotion of PROMOTION_CHOICES) {
      result.push({ ...move, promotion });
    }
  }
  return result;
}

export function generateCastlingMoves(ctx: MoveGenContext): Move[] {
  // Castling is never an attack, so attack probing skips it entirely
  // (this also prevents infinite recursion through `isSquareAttacked`).
  if (ctx.attacksOnly) return [];

  const { state, from, color } = ctx;
  const { board } = state;
  const moves: Move[] = [];

  for (const rule of CASTLING_RULES[color]) {
    if (!state.castling[rule.rightsKey]) continue;
    if (from !== rule.kingFrom) continue;

    // Chess 2 armies choose their own deployment, so the corner is not
    // reserved for a Rook: whatever friendly piece holds it is the King's
    // castling partner. Only its square matters — never its type.
    const partner = board[rule.rookFrom];
    if (!partner || partner.color !== color) continue;
    // A partner that cannot move cannot be swung around the King either.
    if (isImmobilized(state, rule.rookFrom)) continue;
    if (rule.empty.some((square) => board[square])) continue;
    if (rule.empty.some((square) => blockedSquares(state).has(square))) continue;
    // The king may not start in, pass through, or land in check.
    if (rule.safe.some((square) => ctx.isSquareAttacked(square, color))) continue;

    moves.push({
      from,
      to: rule.kingTo,
      piece: 'king',
      color,
      special: rule.side === 'kingside' ? 'castle-kingside' : 'castle-queenside',
      rook: { from: rule.rookFrom, to: rule.rookTo },
    });
  }

  return moves;
}
