/**
 * Chess 2 — Queen-class roster pieces.
 *
 * Every piece here is pure data: patterns for movement, ability descriptors
 * for everything else, plus card text for the collection UI. Nothing in this
 * file is special-cased anywhere in the engine; the ability kinds are
 * interpreted generically (see abilities.ts for the map of kind → owner).
 */

import { getPieceDefinition, registerPiece, DIAGONAL, KNIGHT_LEAPS, ORTHOGONAL } from './pieces';
import type { MovementPattern, PatternContext, Vector } from './pieces';
import type { PieceType } from './types';
import { opposite } from './types';

const ALL_DIRECTIONS: readonly Vector[] = [...ORTHOGONAL, ...DIAGONAL];

/** Two squares out in every direction, jumping whatever stands between. */
const LEAP_TWO: readonly Vector[] = ALL_DIRECTIONS.map(([file, rank]) => [file * 2, rank * 2] as Vector);

const QUEEN_PATTERN: MovementPattern = { vectors: ALL_DIRECTIONS, sliding: true };
const ROOK_PATTERN: MovementPattern = { vectors: ORTHOGONAL, sliding: true };
const BISHOP_PATTERN: MovementPattern = { vectors: DIAGONAL, sliding: true };
const KNIGHT_PATTERN: MovementPattern = { vectors: KNIGHT_LEAPS };
const KING_PATTERN: MovementPattern = { vectors: ALL_DIRECTIONS };

registerPiece({
  type: 'archbishop',
  name: 'Archbishop',
  symbol: 'a',
  notation: 'A',
  value: 9,
  pieceClass: 'queen',
  cost: 9,
  patterns: [{ vectors: DIAGONAL }],
  movementText: 'Moves and captures one square diagonally.',
  abilityText:
    'Every diagonally adjacent friendly piece may also move and capture like a Bishop.',
  flavor: 'His blessing runs along the diagonals.',
  abilities: [
    {
      kind: 'grant-patterns',
      scope: 'diagonally-adjacent-allies',
      patterns: [BISHOP_PATTERN],
    },
  ],
});

registerPiece({
  type: 'trapper',
  name: 'Trapper',
  symbol: 't',
  notation: 'T',
  value: 9,
  pieceClass: 'queen',
  cost: 9,
  // Moves like a queen but never captures: quiet-only patterns also mean the
  // Trapper never attacks, so it can never give check.
  patterns: [{ ...QUEEN_PATTERN, capture: false }],
  movementText: 'Moves like a Queen. Cannot capture.',
  abilityText:
    'Adjacent enemy pieces (orthogonally or diagonally) cannot move or capture. Enemy Trappers are unaffected.',
  flavor: 'Get near me and you are already caught.',
  abilities: [{ kind: 'immobilize-adjacent-enemies' }],
});

registerPiece({
  type: 'revolutionary',
  name: 'Revolutionary',
  symbol: 'v',
  notation: 'V',
  value: 9,
  pieceClass: 'queen',
  cost: 9,
  patterns: [KNIGHT_PATTERN],
  movementText: 'Moves and captures like a Knight.',
  abilityText:
    "On reaching the opponent's back row it may sacrifice itself: both players then swap armies.",
  flavor: 'Every throne is only ever borrowed.',
  abilities: [{ kind: 'defect-on-back-rank' }],
});

registerPiece({
  type: 'duelist',
  name: 'Duelist',
  symbol: 'd',
  notation: 'D',
  value: 9,
  pieceClass: 'queen',
  cost: 9,
  patterns: [KING_PATTERN],
  movementText: 'Moves and captures like a King.',
  abilityText: 'After your main move, the Duelist may take one free move.',
  flavor: 'Fast, precise, relentless.',
  abilities: [{ kind: 'extra-move' }],
});

registerPiece({
  type: 'chariot',
  name: 'Chariot',
  symbol: 'c',
  notation: 'C',
  value: 9,
  pieceClass: 'queen',
  cost: 9,
  patterns: [ROOK_PATTERN],
  movementText: 'Moves and captures like a Rook.',
  abilityText:
    'When it moves, you may return one of your captured Pawns to the square it left.',
  flavor: 'It advances, and brings the fallen back with it.',
  abilities: [{ kind: 'return-reserve-on-move', pieceType: 'pawn' }],
});

registerPiece({
  type: 'champion',
  name: 'Champion',
  symbol: 'h',
  notation: 'H',
  value: 9,
  pieceClass: 'queen',
  cost: 9,
  patterns: [ROOK_PATTERN],
  movementText: 'Moves and captures like a Rook.',
  abilityText:
    'Survives the first capture attempt against it and destroys the attacking piece instead.',
  flavor: 'The first blow only makes the armor stronger.',
  abilities: [{ kind: 'hit-points', value: 2 }],
});

registerPiece({
  type: 'avenger',
  name: 'Avenger',
  symbol: 'e',
  notation: 'E',
  value: 9,
  pieceClass: 'queen',
  cost: 9,
  // No movement of its own — everything is inherited from fallen allies.
  patterns: [],
  movementText: 'Moves and captures like every friendly piece lost this game.',
  abilityText:
    'Starts unable to move. Each friendly piece captured permanently adds that piece’s movement.',
  flavor: 'I become whatever my army has lost.',
  abilities: [{ kind: 'inherit-lost-patterns' }],
  dynamicPatterns: ({ state, piece }) => {
    // Pieces of this colour that were captured are exactly the pieces the
    // opponent has taken. Read live from state — never a hard-coded list.
    const lost = state.captured[opposite(piece.color)];
    const patterns: MovementPattern[] = [];
    for (const type of new Set(lost)) {
      if (type === piece.type) continue; // an Avenger cannot inherit itself
      patterns.push(...getPieceDefinition(type).patterns);
    }
    return patterns;
  },
});

registerPiece({
  type: 'general',
  name: 'General',
  symbol: 'g',
  notation: 'G',
  value: 9,
  pieceClass: 'queen',
  cost: 9,
  patterns: [KING_PATTERN],
  movementText: 'Moves and captures like a King.',
  abilityText:
    'While the General is on the board, every friendly piece may also move (but not capture) like a King.',
  flavor: 'I command everyone around me.',
  abilities: [
    {
      kind: 'grant-patterns',
      scope: 'all-allies',
      patterns: [{ vectors: ALL_DIRECTIONS, capture: false }],
    },
  ],
});

registerPiece({
  type: 'diplomat',
  name: 'Diplomat',
  symbol: 'm',
  notation: 'M',
  value: 9,
  pieceClass: 'queen',
  cost: 9,
  patterns: [{ vectors: LEAP_TWO }],
  movementText:
    'Jumps exactly two squares orthogonally or diagonally, over whatever stands between.',
  abilityText: 'Any enemy piece jumped over changes allegiance. Kings are immune.',
  flavor: 'No blade required — only terms.',
  abilities: [{ kind: 'convert-jumped-enemies' }],
});

registerPiece({
  type: 'infiltrator',
  name: 'Infiltrator',
  symbol: 'i',
  notation: 'I',
  value: 9,
  pieceClass: 'queen',
  cost: 9,
  patterns: [{ ...ROOK_PATTERN, passThroughAllies: true }, KING_PATTERN],
  movementText: 'Moves and captures like a Rook or a King.',
  abilityText: 'Slides straight through friendly pieces. Enemy pieces still block it.',
  flavor: "Walls and allies don't stop me.",
});

registerPiece({
  type: 'warrior',
  name: 'Warrior',
  symbol: 'w',
  notation: 'W',
  value: 9,
  pieceClass: 'queen',
  cost: 9,
  patterns: [QUEEN_PATTERN, KNIGHT_PATTERN],
  movementText: 'Moves and captures like a Queen or a Knight.',
  abilityText: 'Cannot move on two of your turns in a row.',
  flavor: 'I can fight almost anywhere — but not endlessly.',
  abilities: [{ kind: 'no-consecutive-moves' }],
  canMove: ({ state, square }: PatternContext) => !movedLast(state, square),
});

/** True if this square holds the piece that made its owner's previous move. */
function movedLast(state: PatternContext['state'], square: number): boolean {
  for (let index = state.history.length - 1; index >= 0; index--) {
    const entry = state.history[index];
    if (!entry) continue;
    const actor = entry.move?.color ?? entry.cast?.color;
    if (actor !== state.turn) continue;
    // A spell-cast turn means the piece did not move last turn.
    return entry.move !== undefined && entry.move.to === square;
  }
  return false;
}

/** Piece types that make up the current Queen-class roster options. */
export const QUEEN_CLASS_TYPES: readonly PieceType[] = [
  'queen',
  'archbishop',
  'trapper',
  'revolutionary',
  'duelist',
  'chariot',
  'champion',
  'avenger',
  'general',
  'diplomat',
  'infiltrator',
  'warrior',
];
