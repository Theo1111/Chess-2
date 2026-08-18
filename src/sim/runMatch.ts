/**
 * The headless match runner.
 *
 * Drives two agents through one full game using only the engine's public
 * transitions. No React, no DOM, no timers, no global randomness: the outcome
 * is a pure function of (initial state, agents, seed).
 *
 * Safety properties enforced here rather than trusted:
 *  - an agent may only play an action from the legal list (checked by key);
 *  - a runaway game is cut off at `maxPlies` and scored by the draw policy;
 *  - any exception is wrapped in a `MatchSimulationError` carrying the seed,
 *    ply, FEN and action log needed to reproduce it.
 */

import { isDraw, isGameOver, toFen, type Color, type GameState } from '../engine';
import {
  actionKey,
  applyGameAction,
  generateLegalActions,
  getObservationForPlayer,
  type GameAction,
} from '../ai/actions';
import type { Chess2Agent } from '../ai/agent';
import { createRng } from './seededRandom';
import { TelemetryCollector, type MatchTelemetry } from './telemetry';

export type MatchOutcome = 'white' | 'black' | 'draw';

export interface MatchConfig {
  readonly whiteAgent: Chess2Agent;
  readonly blackAgent: Chess2Agent;
  readonly initialState: GameState;
  readonly seed: number;
  /** Hard stop, counted in plies (half-turns). */
  readonly maxPlies?: number;
  /** Skip per-event telemetry for raw-speed runs (result stats stay). */
  readonly collectTelemetry?: boolean;
}

export interface MatchResult {
  readonly winner: MatchOutcome;
  /** Engine status, or 'max-plies' when the draw policy cut the game off. */
  readonly reason: string;
  readonly plies: number;
  readonly seed: number;
  readonly whiteAgentId: string;
  readonly blackAgentId: string;
  readonly actions: readonly GameAction[];
  readonly finalState: GameState;
  readonly telemetry: MatchTelemetry | null;
}

export const DEFAULT_MAX_PLIES = 400;

/** Everything needed to reproduce a crashed simulation. */
export class MatchSimulationError extends Error {
  readonly seed: number;
  readonly ply: number;
  readonly fen: string;
  readonly actions: readonly GameAction[];

  constructor(message: string, details: {
    seed: number;
    ply: number;
    fen: string;
    actions: readonly GameAction[];
    cause?: unknown;
  }) {
    super(message, details.cause !== undefined ? { cause: details.cause } : undefined);
    this.name = 'MatchSimulationError';
    this.seed = details.seed;
    this.ply = details.ply;
    this.fen = details.fen;
    this.actions = details.actions;
  }
}

export function runMatch(config: MatchConfig): MatchResult {
  const maxPlies = config.maxPlies ?? DEFAULT_MAX_PLIES;
  const rng = createRng(config.seed);
  const agentRng: Record<Color, ReturnType<typeof createRng>> = {
    white: rng.child('white'),
    black: rng.child('black'),
  };

  let state = config.initialState;
  const played: GameAction[] = [];
  const collect = config.collectTelemetry ?? true;
  const telemetry = collect ? new TelemetryCollector(state) : null;

  const fail = (message: string, ply: number, cause?: unknown): never => {
    throw new MatchSimulationError(message, {
      seed: config.seed,
      ply,
      fen: safeFen(state),
      actions: played,
      ...(cause !== undefined ? { cause } : {}),
    });
  };

  let ply = 0;
  try {
    while (!isGameOver(state) && ply < maxPlies) {
      const legal = generateLegalActions(state);
      if (legal.length === 0) {
        // The engine says the game is live but offers nothing to do — a
        // contract violation worth a loud failure, not a silent draw.
        fail(`No legal actions in a non-terminal state (status=${state.status})`, ply);
      }

      const color = state.turn;
      const agent = color === 'white' ? config.whiteAgent : config.blackAgent;
      const observation = getObservationForPlayer(state, color);
      const action = agent.chooseAction(observation, legal, {
        color,
        rng: agentRng[color],
        ply,
      });

      // Membership check: agents may only return an action they were offered.
      const key = actionKey(action);
      if (!legal.some((candidate) => actionKey(candidate) === key)) {
        fail(`Agent ${agent.id} returned an illegal action (${key})`, ply);
      }

      const next = applyGameAction(state, action);
      telemetry?.record(ply, state, action, next);
      played.push(action);
      state = next;
      ply++;
    }
  } catch (error) {
    if (error instanceof MatchSimulationError) throw error;
    fail(error instanceof Error ? error.message : String(error), ply, error);
  }

  const finished = isGameOver(state);
  const winner: MatchOutcome = finished
    ? state.winner ?? 'draw'
    : 'draw'; // draw policy: hitting the ply cap scores as a draw
  const reason = finished ? state.status : 'max-plies';

  return {
    winner: finished && isDraw(state) ? 'draw' : winner,
    reason,
    plies: ply,
    seed: config.seed,
    whiteAgentId: config.whiteAgent.id,
    blackAgentId: config.blackAgent.id,
    actions: played,
    finalState: state,
    telemetry: telemetry?.finish(state, ply) ?? null,
  };
}

function safeFen(state: GameState): string {
  try {
    return toFen(state);
  } catch {
    return '<unserializable state>';
  }
}
