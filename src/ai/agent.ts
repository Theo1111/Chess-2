/**
 * The agent contract every Chess 2 bot implements.
 *
 * An agent is a pure decision function: given the state it is allowed to see
 * and the legal actions, return one of those actions. All chance must come
 * from the injected RNG so matches replay deterministically from a seed.
 */

import type { Color, GameState } from '../engine';
import type { SeededRng } from '../sim/seededRandom';
import type { GameAction } from './actions';

export interface AgentContext {
  /** The colour this agent is playing. */
  readonly color: Color;
  /** Per-match, per-agent random stream. The only allowed source of chance. */
  readonly rng: SeededRng;
  /** Plies played so far in this match (0 on the first decision). */
  readonly ply: number;
}

export interface Chess2Agent {
  /** Stable identifier used in ratings, telemetry and reports. */
  readonly id: string;

  /**
   * Choose one of `legalActions` (guaranteed non-empty). `state` is the
   * observation for this agent's colour — hidden opponent information has
   * already been removed; see getObservationForPlayer.
   */
  chooseAction(
    state: GameState,
    legalActions: readonly GameAction[],
    context: AgentContext,
  ): GameAction;
}
