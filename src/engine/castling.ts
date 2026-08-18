/**
 * Castling geometry, expressed as data rather than branching logic so a future
 * variant (or a Chess 2 roster with a different back rank) can redefine it.
 */

import { parseSquareName } from './board';
import type { CastlingRights, Color, Square } from './types';

export type CastlingSide = 'kingside' | 'queenside';

export interface CastlingRule {
  readonly side: CastlingSide;
  readonly kingFrom: Square;
  readonly kingTo: Square;
  readonly rookFrom: Square;
  readonly rookTo: Square;
  /** Squares that must be empty. */
  readonly empty: readonly Square[];
  /** Squares the king passes through (incl. start & end) that must be safe. */
  readonly safe: readonly Square[];
  readonly rightsKey: keyof CastlingRights;
}

const sq = (name: string): Square => {
  const square = parseSquareName(name);
  if (square === null) throw new Error(`Bad square: ${name}`);
  return square;
};

export const CASTLING_RULES: Readonly<Record<Color, readonly CastlingRule[]>> = {
  white: [
    {
      side: 'kingside',
      kingFrom: sq('e1'),
      kingTo: sq('g1'),
      rookFrom: sq('i1'),
      rookTo: sq('f1'),
      empty: [sq('f1'), sq('g1'), sq('h1')],
      safe: [sq('e1'), sq('f1'), sq('g1')],
      rightsKey: 'whiteKingside',
    },
    {
      side: 'queenside',
      kingFrom: sq('e1'),
      kingTo: sq('c1'),
      rookFrom: sq('a1'),
      rookTo: sq('d1'),
      empty: [sq('b1'), sq('c1'), sq('d1')],
      safe: [sq('e1'), sq('d1'), sq('c1')],
      rightsKey: 'whiteQueenside',
    },
  ],
  black: [
    {
      side: 'kingside',
      kingFrom: sq('e9'),
      kingTo: sq('g9'),
      rookFrom: sq('i9'),
      rookTo: sq('f9'),
      empty: [sq('f9'), sq('g9'), sq('h9')],
      safe: [sq('e9'), sq('f9'), sq('g9')],
      rightsKey: 'blackKingside',
    },
    {
      side: 'queenside',
      kingFrom: sq('e9'),
      kingTo: sq('c9'),
      rookFrom: sq('a9'),
      rookTo: sq('d9'),
      empty: [sq('b9'), sq('c9'), sq('d9')],
      safe: [sq('e9'), sq('d9'), sq('c9')],
      rightsKey: 'blackQueenside',
    },
  ],
};

export const ALL_CASTLING_RULES: readonly CastlingRule[] = [
  ...CASTLING_RULES.white,
  ...CASTLING_RULES.black,
];

export const FULL_CASTLING_RIGHTS: CastlingRights = {
  whiteKingside: true,
  whiteQueenside: true,
  blackKingside: true,
  blackQueenside: true,
};

export const NO_CASTLING_RIGHTS: CastlingRights = {
  whiteKingside: false,
  whiteQueenside: false,
  blackKingside: false,
  blackQueenside: false,
};
