/**
 * Position evaluation — the shared heuristic for GreedyBot and AlphaBetaBot.
 *
 * Deliberately simple: its job is to be a stronger baseline than random, not
 * to be strong chess. Material is anchored to the pieces' actual roster costs
 * (`definition.cost`, falling back to `value`), never to standard chess
 * values, so custom pieces are priced by the same numbers the balance system
 * is investigating.
 *
 * All coefficients live in `EvaluationWeights` so experiments can re-weigh
 * without touching code.
 */

import {
  BOARD_SIZE,
  FILE_COUNT,
  RANK_COUNT,
  fileOf,
  generateLegalMoves,
  getPieceDefinition,
  isInCheck,
  rankOf,
  type Color,
  type GameState,
} from '../engine';
import { opposite } from '../engine';

export interface EvaluationWeights {
  readonly material: number;
  readonly mobility: number;
  readonly kingSafety: number;
  readonly boardControl: number;
  readonly cardAdvantage: number;
  readonly trapAdvantage: number;
  readonly hitPoints: number;
}

export const DEFAULT_WEIGHTS: EvaluationWeights = {
  material: 100,
  mobility: 2,
  kingSafety: 40,
  boardControl: 3,
  cardAdvantage: 12,
  trapAdvantage: 8,
  hitPoints: 25,
};

/** Terminal scores. A win must dwarf any positional consideration. */
export const WIN_SCORE = 1_000_000;

/** Roster-cost material value of a piece type. */
export function materialValue(type: string): number {
  const definition = getPieceDefinition(type);
  return definition.cost ?? definition.value;
}

const centerFile = (FILE_COUNT - 1) / 2;
const centerRank = (RANK_COUNT - 1) / 2;

/**
 * Static evaluation of a LIVE position from `perspective`'s point of view.
 * Terminal positions are the caller's job (they need ply distance).
 */
export function evaluatePosition(
  state: GameState,
  perspective: Color,
  weights: EvaluationWeights = DEFAULT_WEIGHTS,
): number {
  let material = 0;
  let control = 0;
  let hitPointBonus = 0;

  for (let square = 0; square < BOARD_SIZE; square++) {
    const piece = state.board[square];
    if (!piece) continue;
    const sign = piece.color === perspective ? 1 : -1;
    const definition = getPieceDefinition(piece.type);
    if (!definition.royal) {
      material += sign * (definition.cost ?? definition.value);
    }
    // Centralization: closer to the middle scores a little more.
    const distance =
      Math.abs(fileOf(square) - centerFile) + Math.abs(rankOf(square) - centerRank);
    control += sign * (centerFile + centerRank - distance);
    if ((piece.hitPoints ?? 1) > 1) hitPointBonus += sign * (piece.hitPoints! - 1);
  }

  // Mobility for the side to move only (generating for the idle side would
  // double the cost); signed so having the move while cramped still counts.
  const moverSign = state.turn === perspective ? 1 : -1;
  const mobility = moverSign * generateLegalMoves(state).length;

  const kingSafety =
    (isInCheck(state, opposite(perspective)) ? 1 : 0) - (isInCheck(state, perspective) ? 1 : 0);

  const cards =
    state.spells[perspective].available.length -
    state.spells[opposite(perspective)].available.length;

  let traps = 0;
  for (const trap of state.traps) {
    if (!trap.armed) continue;
    traps += trap.owner === perspective ? 1 : -1;
  }

  return (
    weights.material * material +
    weights.mobility * mobility +
    weights.kingSafety * kingSafety +
    weights.boardControl * control +
    weights.cardAdvantage * cards +
    weights.trapAdvantage * traps +
    weights.hitPoints * hitPointBonus
  );
}

/**
 * Score for a game that has ended, from `perspective`, preferring quick wins
 * and slow losses: each ply toward the result costs one point.
 */
export function terminalScore(state: GameState, perspective: Color, plyFromRoot: number): number {
  if (state.winner === perspective) return WIN_SCORE - plyFromRoot;
  if (state.winner !== null) return -WIN_SCORE + plyFromRoot;
  return 0; // draw
}
