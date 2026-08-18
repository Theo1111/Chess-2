/**
 * Chess 2 — Rook-class roster pieces.
 *
 * Same contract as the Queen-class file: every piece is data. Movement is
 * patterns (with the walker's flags doing the heavy lifting), anything else
 * is a hook on the definition. Costs live here, per piece, for rebalancing.
 */

import { fileOf, isInside, makeSquare, rankOf } from './board';
import { blockedSquares } from './boardEffects';
import { captureAllowed } from './captureRules';
import { DIAGONAL, ORTHOGONAL, registerPiece } from './pieces';
import type { MoveGenContext, MovementPattern, Vector } from './pieces';
import type { Board, CapturedInfo, Color, Move, PieceType, Square } from './types';

const ALL_DIRECTIONS: readonly Vector[] = [...ORTHOGONAL, ...DIAGONAL];

const QUEEN_PATTERN: MovementPattern = { vectors: ALL_DIRECTIONS, sliding: true };

/** The default cost of a Rook-class piece. Each definition stores its own. */
export const ROOK_CLASS_COST = 5;

registerPiece({
  type: 'berserker',
  name: 'Berserker',
  symbol: 'z',
  notation: 'Z',
  value: 5,
  pieceClass: 'rook',
  cost: ROOK_CLASS_COST,
  // Capture-only queen lines; friendly pieces are valid prey.
  patterns: [{ ...QUEEN_PATTERN, quiet: false, captureFriendly: true }],
  movementText: 'Only moves by capturing: captures like a Queen.',
  abilityText:
    'May capture friendly pieces as well as enemies. A friendly kill is a loss, not a capture.',
  flavor: "This piece doesn't care what it destroys.",
});

registerPiece({
  type: 'leper',
  name: 'Leper',
  symbol: 'l',
  notation: 'L',
  value: 5,
  pieceClass: 'rook',
  cost: ROOK_CLASS_COST,
  patterns: [QUEEN_PATTERN],
  movementText: 'Moves and captures like a Queen.',
  abilityText: 'Cannot end its move on a square adjacent to a friendly piece.',
  flavor: 'Stay away from me.',
  transformMoves: (moves: readonly Move[], ctx: MoveGenContext) =>
    moves.filter((move) => !hasAdjacentFriendly(ctx.state.board, move.to, ctx.color, ctx.from)),
});

/** True if any of the 8 neighbours of `square` holds a friendly piece. */
function hasAdjacentFriendly(board: Board, square: Square, color: Color, ignore: Square): boolean {
  const file = fileOf(square);
  const rank = rankOf(square);
  for (const [deltaFile, deltaRank] of ALL_DIRECTIONS) {
    const nextFile = file + deltaFile;
    const nextRank = rank + deltaRank;
    if (!isInside(nextFile, nextRank)) continue;
    const neighbour = makeSquare(nextFile, nextRank);
    if (neighbour === ignore) continue; // the Leper itself is leaving this square
    const piece = board[neighbour];
    if (piece && piece.color === color) return true;
  }
  return false;
}

registerPiece({
  type: 'archer',
  name: 'Archer',
  symbol: 'f',
  notation: 'F',
  value: 5,
  pieceClass: 'rook',
  cost: ROOK_CLASS_COST,
  patterns: [
    // Movement: one king-step, never a capture.
    { vectors: ALL_DIRECTIONS, capture: false },
    // Capture: queen lines, but never the 8 adjacent squares.
    { vectors: ALL_DIRECTIONS, sliding: true, quiet: false, minRange: 2 },
  ],
  movementText: 'Moves one square in any direction.',
  abilityText: 'Captures at Queen range — but never an adjacent piece.',
  flavor: 'I kill from a distance.',
});

registerPiece({
  type: 'battering-ram',
  name: 'Battering Ram',
  symbol: 'x',
  notation: 'X',
  value: 5,
  pieceClass: 'rook',
  cost: ROOK_CLASS_COST,
  // Movement is generated whole-cloth: patterns cannot express "crush both
  // squares on the way". Attack detection uses the hook below instead.
  patterns: [],
  movementText: 'Moves exactly two squares orthogonally, through the first square.',
  abilityText:
    'Destroys every piece on the two squares of its path — enemy or friendly.',
  flavor: 'I break through whatever is in front of me.',
  generateSpecial: generateRamMoves,
  attackSquares: ramAttackSquares,
});

const asCaptured = (board: Board, square: Square): CapturedInfo | null => {
  const piece = board[square];
  return piece
    ? { type: piece.type, color: piece.color, id: piece.id, square }
    : null;
};

function generateRamMoves(ctx: MoveGenContext): Move[] {
  const { state, from, color } = ctx;
  const { board } = state;
  const attacker = board[from];
  if (!attacker) return [];
  const moves: Move[] = [];
  const file = fileOf(from);
  const rank = rankOf(from);
  const blocked = blockedSquares(state);

  for (const [deltaFile, deltaRank] of ORTHOGONAL) {
    const destFile = file + deltaFile * 2;
    const destRank = rank + deltaRank * 2;
    if (!isInside(destFile, destRank)) continue;

    const mid = makeSquare(file + deltaFile, rank + deltaRank);
    const to = makeSquare(destFile, destRank);
    if (blocked.has(mid) || blocked.has(to)) continue; // terrain stops the charge
    const midPiece = board[mid];
    const destPiece = board[to];

    // Immunities apply to the crush as well (a Shieldmaiden facing the Ram).
    if (midPiece && !captureAllowed(state, attacker, from, midPiece, mid)) continue;
    if (destPiece && !captureAllowed(state, attacker, from, destPiece, to)) continue;

    const midInfo = asCaptured(board, mid);
    const extraCaptures = midInfo ? [midInfo] : undefined;

    if (destPiece && (destPiece.hitPoints ?? 1) > 1) {
      // Charging into armour: the piece on the way is still crushed, but the
      // Ram is destroyed on the survivor (standard hit-point rules).
      moves.push({ from, to, piece: ctx.definition.type, color, repelled: true, ...(extraCaptures ? { extraCaptures } : {}) });
      continue;
    }

    const destInfo = destPiece ? asCaptured(board, to) : null;
    moves.push({
      from,
      to,
      piece: ctx.definition.type,
      color,
      ...(destInfo ? { captured: destInfo } : {}),
      ...(extraCaptures ? { extraCaptures } : {}),
    });
  }

  return moves;
}

/**
 * The Ram threatens both squares of each two-square path whenever the
 * destination is on the board — it crushes the square it passes through.
 */
function ramAttackSquares(_board: Board, from: Square, _color: Color): Square[] {
  const squares: Square[] = [];
  const file = fileOf(from);
  const rank = rankOf(from);
  for (const [deltaFile, deltaRank] of ORTHOGONAL) {
    const destFile = file + deltaFile * 2;
    const destRank = rank + deltaRank * 2;
    if (!isInside(destFile, destRank)) continue;
    squares.push(makeSquare(file + deltaFile, rank + deltaRank));
    squares.push(makeSquare(destFile, destRank));
  }
  return squares;
}

registerPiece({
  type: 'catapult',
  name: 'Catapult',
  symbol: 'o',
  notation: 'O',
  value: 5,
  pieceClass: 'rook',
  cost: ROOK_CLASS_COST,
  patterns: [
    // Movement: rook slide, never a capture.
    { vectors: ORTHOGONAL, sliding: true, capture: false },
    // Capture: launch over exactly one screen piece, take the first enemy beyond.
    { vectors: ORTHOGONAL, hop: true, quiet: false },
  ],
  movementText: 'Moves like a Rook (without capturing).',
  abilityText:
    'Captures along orthogonal lines by launching over one intervening piece, landing on the target.',
  flavor: 'I attack over obstacles.',
});

registerPiece({
  type: 'jouster',
  name: 'Jouster',
  symbol: 'j',
  notation: 'J',
  value: 5,
  pieceClass: 'rook',
  cost: ROOK_CLASS_COST,
  patterns: [{ vectors: ALL_DIRECTIONS, runUntilBlocked: true }],
  movementText: 'Moves and captures like a Queen — but cannot stop voluntarily.',
  abilityText:
    'Runs until it captures the first enemy in its path, halts before a friendly piece, or hits the board edge.',
  flavor: "Once I start, I don't stop.",
});

/** Piece types that make up the current Rook-class roster options. */
export const ROOK_CLASS_TYPES: readonly PieceType[] = [
  'rook',
  'berserker',
  'leper',
  'archer',
  'battering-ram',
  'catapult',
  'jouster',
];
