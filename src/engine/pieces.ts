/**
 * Piece definitions — the data model that describes how a piece moves.
 *
 * This is the main extension point for Chess 2. A piece is *data*: a set of
 * movement patterns plus optional hooks for anything patterns can't express
 * (pawn double-push / en passant, king castling). Move generation, attack
 * detection and legality checking all read this registry, so adding a new
 * piece means registering a definition — not editing the engine.
 */

import type { PieceAbility } from './abilities';
import { expandPawnPromotions, generateCastlingMoves, generatePawnSpecialMoves } from './specialMoves';
import type { Board, Color, GameState, Move, Piece, PieceType, Square } from './types';

/** A direction as [fileDelta, rankDelta] from white's point of view. */
export type Vector = readonly [file: number, rank: number];

export interface MovementPattern {
  readonly vectors: readonly Vector[];
  /** Slide along the vector until blocked (rook/bishop/queen). */
  readonly sliding?: boolean;
  /** Maximum slide distance. Only meaningful with `sliding`; defaults to 8. */
  readonly range?: number;
  /** May move onto an enemy piece. Default true. */
  readonly capture?: boolean;
  /** May move onto an empty square. Default true. */
  readonly quiet?: boolean;
  /** Mirror the rank component for black (used by pawns). Default false. */
  readonly directional?: boolean;
  /** Slide straight through friendly pieces without being blocked (Infiltrator). */
  readonly passThroughAllies?: boolean;
  /** Minimum distance (in steps) before squares become reachable (Archer). */
  readonly minRange?: number;
  /** May capture friendly pieces as well as enemies (Berserker). */
  readonly captureFriendly?: boolean;
  /** Cannon capture: jump one screen piece, take the first enemy beyond (Catapult). */
  readonly hop?: boolean;
  /** Cannot stop voluntarily: runs until edge, ally, or first capture (Jouster). */
  readonly runUntilBlocked?: boolean;
  /**
   * Stab capture: the victim dies but the mover halts one square before it
   * (Spearman). Adjacent targets are unreachable — there is no square between.
   */
  readonly stopShort?: boolean;
}

/** Context handed to a definition's hooks during move generation. */
export interface MoveGenContext {
  readonly state: GameState;
  readonly from: Square;
  readonly color: Color;
  readonly definition: PieceDefinition;
  /** True while probing attacks; special moves that never attack are skipped. */
  readonly attacksOnly: boolean;
  /** Injected so piece hooks can ask about safety without importing the engine. */
  readonly isSquareAttacked: (square: Square, defender: Color) => boolean;
}

/**
 * Roster class. A class says which traditional slot a piece competes for, and
 * is what the team builder groups by. Adding 'rook' / 'bishop' / 'knight' /
 * 'pawn' pieces later needs no change to the builder — only new definitions.
 */
export type PieceClass = 'king' | 'queen' | 'rook' | 'bishop' | 'knight' | 'pawn';

/**
 * A piece definition is the single source of truth for a piece: how it moves,
 * what it costs, what it does, and how it reads on a card.
 *
 *   id            → `type`
 *   class         → `pieceClass`
 *   movement/capture rules → `patterns` (+ `dynamicPatterns`, `generateSpecial`)
 *   passive/active abilities → `abilities`
 *   restrictions  → `canMove` and `transformMoves`
 *   metadata      → `metadata` plus the card text fields
 */
export interface PieceDefinition {
  readonly type: PieceType;
  readonly name: string;
  /** Single lowercase character used in FEN (uppercased for white). */
  readonly symbol: string;
  /** Letter used in algebraic notation. Defaults to the uppercased symbol. */
  readonly notation?: string;
  /** Rough material value; used for capture display. */
  readonly value: number;
  /** A royal piece must not be left attacked — this is what "check" means. */
  readonly royal?: boolean;
  readonly patterns: readonly MovementPattern[];
  /** Moves patterns cannot express (castling, en passant, double push). */
  readonly generateSpecial?: (ctx: MoveGenContext) => Move[];
  /** Post-process generated moves (e.g. expand pawn moves into promotions). */
  readonly transformMoves?: (moves: readonly Move[], ctx: MoveGenContext) => Move[];

  // --- roster / Chess 2 ---------------------------------------------------
  /** Which roster slot this piece competes for. Omitted = not draftable. */
  readonly pieceClass?: PieceClass;
  /** Roster point cost. Omitted = cannot be bought (King, standard pieces). */
  readonly cost?: number;
  /** Card text. */
  readonly movementText?: string;
  readonly abilityText?: string;
  readonly flavor?: string;
  /** Data-driven abilities; see abilities.ts. */
  readonly abilities?: readonly PieceAbility[];
  /** Extra patterns derived from live game state (Avenger). */
  readonly dynamicPatterns?: (ctx: PatternContext) => readonly MovementPattern[];
  /** Blanket restriction: return false to forbid moving this piece at all. */
  readonly canMove?: (ctx: PatternContext) => boolean;
  /**
   * Filters the piece's own moves after full legality checking — for rules
   * that depend on which moves are actually legal (the Warhound must capture
   * when a legal capture exists). Never applied to other pieces' moves.
   */
  readonly restrictLegalMoves?: (moves: Move[], ctx: PatternContext) => Move[];
  /**
   * Threat squares that patterns cannot express (the Battering Ram's crush).
   * Consulted by attack detection in addition to the capture patterns, so
   * check and king safety stay correct for such pieces.
   */
  readonly attackSquares?: (board: Board, from: Square, color: Color) => Square[];
  /** Free-form extension point for future systems (art keys, sets, lore). */
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/** Context for state-dependent movement and restrictions. */
export interface PatternContext {
  readonly state: GameState;
  readonly square: Square;
  readonly piece: Piece;
}

export const ORTHOGONAL: readonly Vector[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export const DIAGONAL: readonly Vector[] = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

export const KNIGHT_LEAPS: readonly Vector[] = [
  [1, 2],
  [2, 1],
  [2, -1],
  [1, -2],
  [-1, -2],
  [-2, -1],
  [-2, 1],
  [-1, 2],
];

const definitions = new Map<PieceType, PieceDefinition>();

/** Register (or replace) a piece definition. Chess 2 pieces plug in here. */
export function registerPiece(definition: PieceDefinition): void {
  definitions.set(definition.type, definition);
}

export function getPieceDefinition(type: PieceType): PieceDefinition {
  const definition = definitions.get(type);
  if (!definition) throw new Error(`Unknown piece type: ${type}`);
  return definition;
}

export function hasPieceDefinition(type: PieceType): boolean {
  return definitions.has(type);
}

export function allPieceDefinitions(): PieceDefinition[] {
  return [...definitions.values()];
}

registerPiece({
  type: 'king',
  name: 'King',
  symbol: 'k',
  value: 0,
  royal: true,
  pieceClass: 'king',
  cost: 0,
  movementText: 'Moves one square in any direction.',
  patterns: [{ vectors: [...ORTHOGONAL, ...DIAGONAL] }],
  generateSpecial: generateCastlingMoves,
});

registerPiece({
  type: 'queen',
  name: 'Queen',
  symbol: 'q',
  value: 9,
  pieceClass: 'queen',
  cost: 9,
  movementText: 'Moves and captures any distance orthogonally or diagonally.',
  abilityText: 'No special ability.',
  flavor: 'The measure every other legend is judged against.',
  patterns: [{ vectors: [...ORTHOGONAL, ...DIAGONAL], sliding: true }],
});

registerPiece({
  type: 'rook',
  name: 'Rook',
  symbol: 'r',
  value: 5,
  pieceClass: 'rook',
  cost: 5,
  movementText: 'Moves and captures any distance orthogonally.',
  abilityText: 'No special ability.',
  flavor: 'The wall that walks.',
  patterns: [{ vectors: ORTHOGONAL, sliding: true }],
});

registerPiece({
  type: 'bishop',
  name: 'Bishop',
  symbol: 'b',
  value: 3,
  pieceClass: 'bishop',
  cost: 3,
  movementText: 'Moves and captures any distance diagonally.',
  abilityText: 'No special ability.',
  flavor: 'Faith moves in straight lines — tilted ones.',
  patterns: [{ vectors: DIAGONAL, sliding: true }],
});

registerPiece({
  type: 'knight',
  name: 'Knight',
  symbol: 'n',
  notation: 'N',
  value: 3,
  pieceClass: 'knight',
  cost: 3,
  movementText: 'Moves and captures in the standard L-shape, jumping over pieces.',
  abilityText: 'No special ability.',
  flavor: 'The oldest trick on the board.',
  patterns: [{ vectors: KNIGHT_LEAPS }],
});

registerPiece({
  type: 'pawn',
  name: 'Pawn',
  symbol: 'p',
  notation: '',
  value: 1,
  pieceClass: 'pawn',
  cost: 1,
  movementText:
    'Moves one square forward; captures one square diagonally forward. May advance two squares from its home rank (exposing it to en passant).',
  abilityText: 'Promotes to a Queen, Rook, Bishop or Knight on the far rank.',
  flavor: 'Every empire is carried on shoulders like these.',
  patterns: [
    // Single step forward: quiet only.
    { vectors: [[0, 1]], directional: true, capture: false },
    // Diagonal captures: capture only. Attack detection reads exactly this.
    {
      vectors: [
        [1, 1],
        [-1, 1],
      ],
      directional: true,
      quiet: false,
    },
  ],
  generateSpecial: generatePawnSpecialMoves,
  transformMoves: expandPawnPromotions,
});

/** The starting back-rank layout. Data, so alternate rosters can swap it. */
export const STANDARD_BACK_RANK: readonly PieceType[] = [
  'rook',
  'knight',
  'bishop',
  'queen',
  'king',
  'queen',
  'bishop',
  'knight',
  'rook',
];
