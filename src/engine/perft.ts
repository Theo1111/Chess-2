import { advance } from './game';
import { generateLegalMoves } from './moveGeneration';
import type { GameState } from './types';

/**
 * Counts leaf nodes of the legal move tree to a given depth.
 *
 * Perft is the standard correctness harness for a chess move generator: if the
 * counts match published values, then castling, en passant, promotion, pins,
 * discovered check and double check are all being handled correctly.
 */
export function perft(state: GameState, depth: number): number {
  if (depth <= 0) return 1;
  const moves = generateLegalMoves(state);
  if (depth === 1) return moves.length;

  let nodes = 0;
  for (const move of moves) nodes += perft(advance(state, move), depth - 1);
  return nodes;
}

/** Per-move breakdown, for bisecting a mismatch against a reference engine. */
export function perftDivide(state: GameState, depth: number): Record<string, number> {
  const result: Record<string, number> = {};
  for (const move of generateLegalMoves(state)) {
    const key = `${move.from}-${move.to}${move.promotion ? `=${move.promotion}` : ''}`;
    result[key] = perft(advance(state, move), depth - 1);
  }
  return result;
}
