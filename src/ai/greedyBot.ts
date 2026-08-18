/**
 * GreedyBot — one-ply lookahead over the shared evaluation.
 *
 * For each candidate action it applies the action (through the real engine)
 * and scores the resulting position; the best score wins, with seeded-random
 * tie-breaking so equal options do not collapse into first-in-list bias.
 *
 * Branch cap: spell-heavy positions can offer hundreds of near-identical
 * casts (Teleport × every empty square). Above `sampleLimit` candidates the
 * bot evaluates every MOVE but only a seeded sample of the spells — moves are
 * where tactics live, and the cap keeps a 10,000-game run affordable.
 */

import { isGameOver, type GameState } from '../engine';
import { tryApplyGameAction, type GameAction } from './actions';
import type { AgentContext, Chess2Agent } from './agent';
import {
  DEFAULT_WEIGHTS,
  evaluatePosition,
  terminalScore,
  type EvaluationWeights,
} from './evaluation';

export interface GreedyBotOptions {
  readonly id?: string;
  readonly weights?: EvaluationWeights;
  /** Max candidates fully evaluated per decision (moves are never dropped). */
  readonly sampleLimit?: number;
}

export class GreedyBot implements Chess2Agent {
  readonly id: string;
  private readonly weights: EvaluationWeights;
  private readonly sampleLimit: number;

  constructor(options: GreedyBotOptions = {}) {
    this.id = options.id ?? 'greedy';
    this.weights = options.weights ?? DEFAULT_WEIGHTS;
    this.sampleLimit = options.sampleLimit ?? 96;
  }

  chooseAction(
    state: GameState,
    legalActions: readonly GameAction[],
    context: AgentContext,
  ): GameAction {
    const candidates = this.candidates(legalActions, context);

    let best: GameAction = candidates[0]!;
    let bestScore = -Infinity;
    let ties = 0;

    for (const action of candidates) {
      const next = tryApplyGameAction(state, action);
      // Un-simulatable on our observation (hidden-info card like Recon):
      // score it as "position unchanged" so it stays playable but never
      // outranks a concretely good action.
      const score =
        next === null
          ? evaluatePosition(state, context.color, this.weights) - 1
          : isGameOver(next)
            ? terminalScore(next, context.color, 1)
            : evaluatePosition(next, context.color, this.weights);

      if (score > bestScore) {
        bestScore = score;
        best = action;
        ties = 1;
      } else if (score === bestScore) {
        // Reservoir sampling over ties keeps the choice uniform and seeded.
        ties++;
        if (context.rng.int(ties) === 0) best = action;
      }
    }
    return best;
  }

  private candidates(
    legalActions: readonly GameAction[],
    context: AgentContext,
  ): readonly GameAction[] {
    if (legalActions.length <= this.sampleLimit) return legalActions;
    const moves = legalActions.filter((action) => action.kind !== 'spell');
    const spells = legalActions.filter((action) => action.kind === 'spell');
    const room = Math.max(this.sampleLimit - moves.length, 8);
    return [...moves, ...context.rng.shuffle(spells).slice(0, room)];
  }
}
