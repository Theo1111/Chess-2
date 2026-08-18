/**
 * Chess 2 — Knight-class roster pieces.
 *
 * Same contract as the other class files: every piece is data, with
 * `generateSpecial` hooks for moves that patterns cannot express (the
 * Squire's army-jump, the Spy's transformation, the Double's royal swap and
 * the Ambusher's reaction capture). Costs live per definition.
 *
 * FEN symbols use accented letters where the ascii alphabet has run out;
 * they upper/lowercase cleanly so colour encoding keeps working.
 */

import { BOARD_SIZE, fileOf, isInside, makeSquare, rankOf } from './board';
import { blockedSquares } from './boardEffects';
import { captureAllowed } from './captureRules';
import { KNIGHT_LEAPS, ORTHOGONAL, DIAGONAL, getPieceDefinition, registerPiece } from './pieces';
import type { MoveGenContext, Vector } from './pieces';
import type { Move, PieceType, Square } from './types';

const ALL_DIRECTIONS: readonly Vector[] = [...ORTHOGONAL, ...DIAGONAL];

/** The default cost of a Knight-class piece. Each definition stores its own. */
export const KNIGHT_CLASS_COST = 3;

/** The 8 squares around a square — an Ambusher's guard zone, king steps, etc. */
export function surroundingSquares(square: Square): Square[] {
  const squares: Square[] = [];
  const file = fileOf(square);
  const rank = rankOf(square);
  for (const [deltaFile, deltaRank] of ALL_DIRECTIONS) {
    const nextFile = file + deltaFile;
    const nextRank = rank + deltaRank;
    if (isInside(nextFile, nextRank)) squares.push(makeSquare(nextFile, nextRank));
  }
  return squares;
}

registerPiece({
  type: 'squire',
  name: 'Squire',
  symbol: 'u',
  notation: 'S',
  value: 3,
  pieceClass: 'knight',
  cost: KNIGHT_CLASS_COST,
  // Its only pattern is the forward capture; movement is the army-jump hook.
  patterns: [{ vectors: [[0, 1]], directional: true, quiet: false }],
  movementText:
    'Jumps to any empty square orthogonally adjacent to any other friendly piece, anywhere on the board.',
  abilityText: 'Captures by moving one square straight forward.',
  flavor: 'I follow the army.',
  generateSpecial: generateSquireJumps,
});

function generateSquireJumps(ctx: MoveGenContext): Move[] {
  if (ctx.attacksOnly) return []; // the jump is never a capture
  const { state, from, color, definition } = ctx;
  const moves: Move[] = [];
  const seen = new Set<Square>();
  const blocked = blockedSquares(state);

  for (let square = 0; square < BOARD_SIZE; square++) {
    if (square === from) continue; // it cannot escort itself
    const friend = state.board[square];
    if (!friend || friend.color !== color) continue;

    const file = fileOf(square);
    const rank = rankOf(square);
    for (const [deltaFile, deltaRank] of ORTHOGONAL) {
      const nextFile = file + deltaFile;
      const nextRank = rank + deltaRank;
      if (!isInside(nextFile, nextRank)) continue;
      const to = makeSquare(nextFile, nextRank);
      if (to === from || seen.has(to) || state.board[to] || blocked.has(to)) continue;
      seen.add(to);
      moves.push({ from, to, piece: definition.type, color, teleport: true });
    }
  }
  return moves;
}

registerPiece({
  type: 'jester',
  name: 'Jester',
  symbol: 'é',
  notation: 'Js',
  value: 3,
  pieceClass: 'knight',
  cost: KNIGHT_CLASS_COST,
  patterns: [{ vectors: KNIGHT_LEAPS }],
  movementText: 'Moves and captures like a Knight.',
  abilityText:
    'Permanently becomes every piece it captures — and keeps transforming with each new kill.',
  flavor: 'I become whatever I defeat.',
  abilities: [{ kind: 'transform-on-capture' }],
});

registerPiece({
  type: 'ambusher',
  name: 'Ambusher',
  symbol: 'à',
  notation: 'Am',
  value: 3,
  pieceClass: 'knight',
  cost: KNIGHT_CLASS_COST,
  patterns: [{ vectors: KNIGHT_LEAPS, capture: false }],
  movementText: 'Moves like a Knight. Cannot capture normally.',
  abilityText:
    'Guards the 8 squares around it. An enemy that just moved through a guarded square may be captured: the Ambusher jumps to that square and the passer dies wherever it stopped.',
  flavor: "Step into my territory and you're dead.",
  abilities: [{ kind: 'ambush-passers' }],
  generateSpecial: generateAmbushMoves,
});

function generateAmbushMoves(ctx: MoveGenContext): Move[] {
  if (ctx.attacksOnly) return []; // reactive, never a standing threat
  const { state, from, color, definition } = ctx;
  const window = state.ambush;
  if (!window) return [];

  const victim = state.board[window.victim];
  if (!victim || victim.color === color) return [];
  if (getPieceDefinition(victim.type).royal) return []; // royals cannot be ambushed
  if ((victim.hitPoints ?? 1) > 1) return []; // armour shrugs off ambushes
  const ambusher = state.board[from];
  if (!ambusher || !captureAllowed(state, ambusher, from, victim, window.victim)) return [];

  const zone = new Set(surroundingSquares(from));
  const moves: Move[] = [];
  const blocked = blockedSquares(state);
  for (const square of window.path) {
    if (!zone.has(square) || state.board[square] || blocked.has(square)) continue;
    moves.push({
      from,
      to: square,
      piece: definition.type,
      color,
      special: 'ambush',
      teleport: true,
      captured: { type: victim.type, color: victim.color, id: victim.id, square: window.victim },
    });
  }
  return moves;
}

registerPiece({
  type: 'spy',
  name: 'Spy',
  symbol: 's',
  notation: 'Y',
  value: 3,
  pieceClass: 'knight',
  cost: KNIGHT_CLASS_COST,
  patterns: [{ vectors: KNIGHT_LEAPS, capture: false }],
  movementText: 'Moves like a Knight. Cannot capture.',
  abilityText:
    'May sacrifice itself to become any other piece type from its owner’s roster, on the same square.',
  flavor: 'I am not what I appear to be.',
  generateSpecial: generateSpyTransforms,
});

function generateSpyTransforms(ctx: MoveGenContext): Move[] {
  if (ctx.attacksOnly) return [];
  const { state, from, color, definition } = ctx;
  const moves: Move[] = [];
  for (const type of state.rosterTypes[color]) {
    if (type === definition.type) continue; // "any other piece"
    const target = getPieceDefinition(type);
    if (target.royal) continue; // it cannot fake a second King
    moves.push({
      from,
      to: from,
      piece: definition.type,
      color,
      special: 'transform',
      promotion: type,
    });
  }
  return moves;
}

registerPiece({
  type: 'assassin',
  name: 'Assassin',
  symbol: 'y',
  notation: 'U',
  value: 3,
  pieceClass: 'knight',
  cost: KNIGHT_CLASS_COST,
  patterns: [
    {
      vectors: [
        [0, 1],
        [1, 1],
        [-1, 1],
      ],
      directional: true,
    },
  ],
  movementText: 'Moves and captures one square forward or diagonally forward. Never backward.',
  abilityText: "Reaching the opponent's back row instantly wins the game.",
  flavor: "I don't need to fight your army. I just need to reach you.",
  abilities: [{ kind: 'win-on-back-rank' }],
});

registerPiece({
  type: 'double',
  name: 'Double',
  symbol: 'ø',
  notation: 'Db',
  value: 3,
  pieceClass: 'knight',
  cost: KNIGHT_CLASS_COST,
  patterns: [{ vectors: ALL_DIRECTIONS }],
  movementText: 'Moves and captures like a King.',
  abilityText:
    'Royal Swap: may exchange squares with its own King as a move — as long as the King is safe afterwards.',
  flavor: 'You never know which one is the real King.',
  generateSpecial: generateRoyalSwaps,
});

function generateRoyalSwaps(ctx: MoveGenContext): Move[] {
  if (ctx.attacksOnly) return [];
  const { state, from, color, definition } = ctx;
  const moves: Move[] = [];
  for (let square = 0; square < BOARD_SIZE; square++) {
    if (square === from) continue;
    const piece = state.board[square];
    if (!piece || piece.color !== color) continue;
    if (!getPieceDefinition(piece.type).royal) continue;
    moves.push({
      from,
      to: square,
      piece: definition.type,
      color,
      special: 'royal-swap',
      teleport: true,
    });
  }
  return moves;
}

/** Piece types that make up the current Knight-class roster options. */
export const KNIGHT_CLASS_TYPES: readonly PieceType[] = [
  'knight',
  'squire',
  'jester',
  'ambusher',
  'spy',
  'assassin',
  'double',
];
