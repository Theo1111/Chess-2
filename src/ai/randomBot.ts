/**
 * RandomBot — uniform choice over legal actions.
 *
 * Not built to play well. Its jobs: fuzzing the engine at scale, proving that
 * games terminate, exercising rare mechanics, and anchoring the bottom of the
 * agent rating ladder.
 */

import type { GameState } from '../engine';
import type { GameAction } from './actions';
import type { AgentContext, Chess2Agent } from './agent';

export class RandomBot implements Chess2Agent {
  readonly id: string;

  constructor(id = 'random') {
    this.id = id;
  }

  chooseAction(
    _state: GameState,
    legalActions: readonly GameAction[],
    context: AgentContext,
  ): GameAction {
    return context.rng.pick(legalActions);
  }
}
