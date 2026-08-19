/**
 * Deterministic replay of an online game's action log — the client side of
 * the trust model.
 *
 * The server stores actions but never runs the engine, so EVERY client
 * replays the log from the fixed classic start and validates each action
 * against `generateLegalActions` before applying it. A log that contains an
 * illegal action (a modified client, or a divergent engine version) is
 * reported as invalid at its exact index instead of being trusted — the game
 * is then shown as void rather than silently corrupted.
 *
 * Pure: no network, no React. This is what the tests exercise.
 */

import { createInitialState, isGameOver, type GameState } from '../engine';
import { createGameFromRosters, type Roster } from '../roster';
import {
  actionKey,
  applyGameAction,
  generateLegalActions,
  type GameAction,
} from '../ai/actions';

export interface ReplayResult {
  /** State after the last valid action. */
  readonly state: GameState;
  /** False when some action in the log was illegal where it appeared. */
  readonly valid: boolean;
  /** Index of the first illegal action, when invalid. */
  readonly failedAt: number | null;
  /** Actions successfully applied (equals log length when valid). */
  readonly applied: number;
}

/**
 * The starting position for an online game. Classic mode is the fixed
 * standard opening; custom mode is built from the two submitted armies, so
 * both clients derive an identical board from the same stored rosters.
 * Returns null if a custom game's armies are missing or fail roster
 * validation — the caller shows that as an unplayable game rather than
 * guessing at a position.
 */
export function createOnlineInitialState(
  mode: 'classic' | 'custom' = 'classic',
  white?: Roster | null,
  black?: Roster | null,
): GameState | null {
  if (mode === 'classic') return createInitialState();
  if (!white || !black) return null;
  try {
    return createGameFromRosters(white, black);
  } catch {
    return null;
  }
}

export function replayOnlineActions(
  actions: readonly GameAction[],
  initialState?: GameState,
): ReplayResult {
  let state = initialState ?? createInitialState();

  for (let index = 0; index < actions.length; index++) {
    const action = actions[index]!;
    const key = actionKey(action);
    const legal = generateLegalActions(state).find((candidate) => actionKey(candidate) === key);
    if (!legal) {
      return { state, valid: false, failedAt: index, applied: index };
    }
    // Apply the locally generated twin, not the wire object: identical by
    // key, but guaranteed to carry exactly the engine's own move fields.
    state = applyGameAction(state, legal);
  }

  return { state, valid: true, failedAt: null, applied: actions.length };
}

/**
 * The engine-derived side to move after playing `action` on `state` — what
 * `submit_online_action` records as the server's turn. A bonus phase keeps
 * the mover on turn, which is why this cannot be "the other colour".
 */
export function nextTurnAfter(state: GameState, action: GameAction): GameState {
  return applyGameAction(state, action);
}

/** Result summary for a finished replayed game, for the finish RPC. */
export function replayOutcome(state: GameState): {
  over: boolean;
  winner: 'white' | 'black' | 'draw' | null;
  reason: string;
} {
  if (!isGameOver(state)) return { over: false, winner: null, reason: '' };
  return {
    over: true,
    winner: state.winner ?? 'draw',
    reason: state.status,
  };
}
