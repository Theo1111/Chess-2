/**
 * Chess 2 — Bishop-class roster pieces.
 *
 * Same contract as the other class files: every piece is data. New mechanics
 * introduced by this class live in generic engine layers:
 *
 *   - capture immunities        → captureRules.ts (Monk, Shieldmaiden)
 *   - state-derived range       → dynamicPatterns (Jailer)
 *   - destination restrictions  → transformMoves  (Kingsguard)
 *   - legality-aware compulsion → restrictLegalMoves (Warhound)
 *   - stab captures             → the walker's stopShort flag (Spearman)
 */

import { BOARD_SIZE, fileOf, rankOf } from './board';
import { DIAGONAL, ORTHOGONAL, getPieceDefinition, registerPiece } from './pieces';
import type { MovementPattern, PatternContext, Vector } from './pieces';
import { classOfPiece } from './captureRules';
import type { GameState, Move, PieceType, Square } from './types';

const ALL_DIRECTIONS: readonly Vector[] = [...ORTHOGONAL, ...DIAGONAL];
const KING_PATTERN: MovementPattern = { vectors: ALL_DIRECTIONS };

/** The default cost of a Bishop-class piece. Each definition stores its own. */
export const BISHOP_CLASS_COST = 3;

registerPiece({
  type: 'monk',
  name: 'Monk',
  symbol: 'ô',
  notation: 'Mo',
  value: 3,
  pieceClass: 'bishop',
  cost: BISHOP_CLASS_COST,
  patterns: [{ vectors: DIAGONAL, sliding: true }],
  movementText: 'Moves and captures like a Bishop.',
  abilityText: 'Cannot capture Pawn-class pieces, and Pawn-class pieces cannot capture it.',
  flavor: 'Protected by faith.',
  abilities: [
    { kind: 'no-capture-class', pieceClass: 'pawn' },
    { kind: 'uncapturable-by-class', pieceClass: 'pawn' },
  ],
});

registerPiece({
  type: 'shieldmaiden',
  name: 'Shieldmaiden',
  symbol: 'ä',
  notation: 'Sh',
  value: 3,
  pieceClass: 'bishop',
  cost: BISHOP_CLASS_COST,
  patterns: [KING_PATTERN],
  movementText: 'Moves and captures like a King.',
  abilityText:
    'Cannot be captured by an enemy that starts its move on a row in front of her. Attacks from her row or behind land normally.',
  flavor: 'You cannot attack me from the front.',
  abilities: [{ kind: 'shielded-from-front' }],
});

/** Enemy pawn-class pieces this player has captured — the Jailer's range. */
export function jailerRange(state: GameState, color: 'white' | 'black'): number {
  return state.captured[color].filter((type) => classOfPiece(type) === 'pawn').length;
}

registerPiece({
  type: 'jailer',
  name: 'Jailer',
  symbol: 'ï',
  notation: 'Ja',
  value: 3,
  pieceClass: 'bishop',
  cost: BISHOP_CLASS_COST,
  // All movement is state-derived; with no captured pawns it cannot move.
  patterns: [],
  movementText: 'Moves and captures like a Queen — limited to N squares.',
  abilityText:
    'N is the number of enemy Pawns its owner has captured this game. It starts at 0: the Jailer begins the game unable to move.',
  flavor: 'The more prisoners I take, the stronger I become.',
  dynamicPatterns: ({ state, piece }: PatternContext) => {
    const range = jailerRange(state, piece.color);
    if (range <= 0) return [];
    return [{ vectors: ALL_DIRECTIONS, sliding: true, range }];
  },
});

/** Chebyshev distance — the board's natural "squares away" metric. */
const distance = (a: Square, b: Square): number =>
  Math.max(Math.abs(fileOf(a) - fileOf(b)), Math.abs(rankOf(a) - rankOf(b)));

/** The friendly King's square, if any. */
export function ownRoyalSquare(state: GameState, color: 'white' | 'black'): Square | null {
  for (let square = 0; square < BOARD_SIZE; square++) {
    const piece = state.board[square];
    if (piece && piece.color === color && getPieceDefinition(piece.type).royal) return square;
  }
  return null;
}

registerPiece({
  type: 'kingsguard',
  name: 'Kingsguard',
  symbol: 'û',
  notation: 'Kg',
  value: 3,
  pieceClass: 'bishop',
  cost: BISHOP_CLASS_COST,
  patterns: [{ vectors: ALL_DIRECTIONS, sliding: true }],
  movementText: 'Moves and captures like a Queen.',
  abilityText:
    'May never end a move more than 2 squares from its own King. The King moves freely — the Kingsguard adapts.',
  flavor: 'I exist to protect the King.',
  /** `kingRadius` is read by the UI to visualise the allowed area. */
  metadata: { kingRadius: 2 },
  transformMoves: (moves: readonly Move[], ctx) => {
    const king = ownRoyalSquare(ctx.state, ctx.color);
    if (king === null) return [...moves];
    return moves.filter((move) => distance(move.to, king) <= 2);
  },
});

registerPiece({
  type: 'warhound',
  name: 'Warhound',
  symbol: 'ñ',
  notation: 'Wh',
  value: 3,
  pieceClass: 'bishop',
  cost: BISHOP_CLASS_COST,
  patterns: [{ vectors: ALL_DIRECTIONS, sliding: true }],
  movementText: 'Moves and captures like a Queen.',
  abilityText:
    'Bloodlust: while it has at least one legal capture, it must capture. Only truly legal captures count.',
  flavor: 'Once I smell blood, I must attack.',
  restrictLegalMoves: (moves: Move[]) => {
    const captures = moves.filter((move) => move.captured !== undefined);
    return captures.length > 0 ? captures : moves;
  },
});

registerPiece({
  type: 'spearman',
  name: 'Spearman',
  symbol: 'ê',
  notation: 'Sp',
  value: 3,
  pieceClass: 'bishop',
  cost: BISHOP_CLASS_COST,
  patterns: [
    // Quiet bishop slides.
    { vectors: DIAGONAL, sliding: true, capture: false },
    // Stab captures: the victim dies, the spearman halts one square short —
    // which also means an adjacent enemy is out of reach.
    { vectors: DIAGONAL, sliding: true, quiet: false, stopShort: true },
  ],
  movementText: 'Moves like a Bishop.',
  abilityText:
    'Captures at range along a clear diagonal: the target dies and the Spearman stops one square before it. Adjacent enemies are too close to stab.',
  flavor: 'I strike from just outside your reach.',
});

/** Piece types that make up the current Bishop-class roster options. */
export const BISHOP_CLASS_TYPES: readonly PieceType[] = [
  'bishop',
  'monk',
  'shieldmaiden',
  'jailer',
  'kingsguard',
  'warhound',
  'spearman',
];
