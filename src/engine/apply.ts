import { BOARD_SIZE, makePiece } from './board';
import { getPieceDefinition } from './pieces';
import type { Board, Color, Move, Piece, PieceType, Square } from './types';
import { opposite } from './types';

/**
 * Applies a move to a board and returns a new board. Pure and cheap — used
 * both by legality testing (make/probe/discard) and by full state transitions.
 *
 * All board-level ability effects live here so that legality testing sees
 * exactly the position a move really produces.
 */
export function applyMoveToBoard(board: Board, move: Move): Board {
  const next = board.slice();
  const piece = next[move.from];
  if (!piece) throw new Error(`No piece on square ${move.from} to move`);

  // Royal swap (Double): the two pieces simply exchange squares.
  if (move.special === 'royal-swap') {
    next[move.from] = next[move.to] ?? null;
    next[move.to] = piece;
    return next;
  }

  next[move.from] = null;

  // Collateral removals (Battering Ram): resolved before the piece lands.
  if (move.extraCaptures) {
    for (const extra of move.extraCaptures) next[extra.square] = null;
  }

  if (move.repelled) {
    // The defender holds: the attacker is destroyed and the target stays put,
    // one hit point lighter.
    const defender = next[move.to];
    if (defender) {
      next[move.to] = { ...defender, hitPoints: Math.max((defender.hitPoints ?? 1) - 1, 1) };
    }
  } else {
    if (move.captured) next[move.captured.square] = null;
    next[move.to] = move.promotion ? changeType(piece, move.promotion) : landingPiece(piece, move);

    if (move.rook) {
      const rook = next[move.rook.from];
      next[move.rook.from] = null;
      next[move.rook.to] = rook ?? null;
    }
  }

  // Diplomat: pieces jumped over change allegiance.
  if (move.converts) {
    for (const square of move.converts) {
      const victim = next[square];
      if (victim) next[square] = { ...victim, color: opposite(victim.color) };
    }
  }

  // Chariot: a piece comes back from the reserves onto the vacated square.
  if (move.returns) {
    next[move.returns.square] = createPiece(move.color, move.returns.type, move.returns.square);
  }

  // Revolutionary: sacrifice itself, then both armies change hands.
  if (move.special === 'defect') {
    next[move.to] = null;
    return swapBoardColors(next);
  }

  return next;
}

/** Flips the allegiance of every piece — the board half of a side swap. */
export function swapBoardColors(board: Board): Board {
  const next = board.slice();
  for (let square = 0; square < BOARD_SIZE; square++) {
    const piece = next[square];
    if (piece) next[square] = { ...piece, color: opposite(piece.color) };
  }
  return next;
}

/**
 * Changes a unit's shape while keeping its identity: used by pawn promotion,
 * the Spy's transformation and the Jester's shape-shifting. `origin`
 * remembers what the unit was drafted as; abilities that follow the unit
 * (transform-on-capture) key off it. Durability resets to the new shape's.
 */
export function changeType(piece: Piece, type: PieceType): Piece {
  const hitPoints = initialHitPoints(type);
  return {
    ...piece,
    type,
    id: `${piece.id}=${type}`,
    origin: piece.origin ?? piece.type,
    ...(hitPoints === undefined ? { hitPoints: undefined } : { hitPoints }),
  };
}

/**
 * The piece as it lands on its destination. A unit with the
 * transform-on-capture ability (checked on its origin, so a transformed
 * Jester keeps transforming) becomes what it just killed.
 */
function landingPiece(piece: Piece, move: Move): Piece {
  if (!move.captured || move.captured.color === piece.color) return piece;
  const identity = getPieceDefinition(piece.origin ?? piece.type);
  if (!identity.abilities?.some((ability) => ability.kind === 'transform-on-capture')) return piece;
  return changeType(piece, move.captured.type);
}

/** Starting hit points for a piece type, from its hit-point ability. */
export function initialHitPoints(type: PieceType): number | undefined {
  const ability = getPieceDefinition(type).abilities?.find((entry) => entry.kind === 'hit-points');
  return ability?.kind === 'hit-points' ? ability.value : undefined;
}

/**
 * Creates a piece with any durability its definition grants. Every code path
 * that puts a piece on the board should go through here.
 */
export function createPiece(color: Color, type: PieceType, square: Square, seq = 0): Piece {
  const piece = makePiece(color, type, square, seq);
  const hitPoints = initialHitPoints(type);
  return hitPoints === undefined ? piece : { ...piece, hitPoints };
}
