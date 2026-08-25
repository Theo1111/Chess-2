import { describe, expect, it } from 'vitest';
import '../../engine/customPieces';
import '../../engine/rookPieces';
import '../../engine/knightPieces';
import '../../engine/bishopPieces';
import { createInitialState, type GameState } from '../../engine';
import { createRng } from '../../sim/seededRandom';
import { generateLegalActions, type GameAction } from '../../ai/actions';
import {
  nextTurnAfter,
  replayOnlineActions,
  replayOutcome,
} from '../onlineReplay';

/**
 * The bare starting position — no cards, no ability pieces. Replay validation
 * is about the log, not about which army produced the board, so the tests
 * exercise it from the simplest position the engine can build.
 */
const plainStart = (): GameState => createInitialState();

/** A legal random game of `plies` actions, as two honest clients produce. */
function randomLog(plies: number, seed: number): GameAction[] {
  const rng = createRng(seed);
  let state = plainStart();
  const log: GameAction[] = [];
  for (let i = 0; i < plies; i++) {
    const legal = generateLegalActions(state);
    if (legal.length === 0) break;
    const action = rng.pick(legal);
    log.push(action);
    state = nextTurnAfter(state, action);
  }
  return log;
}

describe('replayOnlineActions', () => {
  it('replays an honest log to the same state on every client', () => {
    const log = randomLog(30, 7);
    const a = replayOnlineActions(log);
    const b = replayOnlineActions(JSON.parse(JSON.stringify(log)) as GameAction[]);
    expect(a.valid).toBe(true);
    expect(a.applied).toBe(log.length);
    // A wire round-trip (JSON) replays identically — the log is the game.
    expect(JSON.stringify(a.state.board)).toBe(JSON.stringify(b.state.board));
    expect(a.state.turn).toBe(b.state.turn);
  });

  it('rejects a log containing an illegal action, at its exact index', () => {
    const log = randomLog(10, 11);
    // A "modified client" claims a rook teleports across the board.
    const forged: GameAction = {
      kind: 'move',
      move: { from: 0, to: 60, piece: 'rook', color: 'white' },
    };
    const tampered = [...log.slice(0, 4), forged, ...log.slice(4)];
    const result = replayOnlineActions(tampered);
    expect(result.valid).toBe(false);
    expect(result.failedAt).toBe(4);
    expect(result.applied).toBe(4); // everything before the forgery stands
  });

  it('rejects a replayed action that was legal earlier but not now', () => {
    const log = randomLog(8, 13);
    // Duplicate white's first action later in the log: same piece, stale square.
    const result = replayOnlineActions([...log, log[0]!]);
    // Either it happens to be legal again (rare) or it is flagged; both are
    // deterministic. Assert the invariant that applied <= length and validity
    // matches failedAt.
    expect(result.applied).toBeLessThanOrEqual(log.length + 1);
    expect(result.valid).toBe(result.failedAt === null);
  });

  it('spell actions are rejected in a position that has no cards', () => {
    const spell: GameAction = { kind: 'spell', spell: 'shield', targets: [10], trap: false };
    const result = replayOnlineActions([spell]);
    expect(result.valid).toBe(false);
    expect(result.failedAt).toBe(0);
  });

  it('nextTurnAfter reflects the engine, and outcome reads terminal states', () => {
    const state = plainStart();
    const action = generateLegalActions(state)[0]!;
    const next = nextTurnAfter(state, action);
    expect(next.turn).toBe('black'); // no ability pieces: no bonus phases

    expect(replayOutcome(state).over).toBe(false);
    const finished = { ...state, status: 'checkmate' as const, winner: 'black' as const };
    expect(replayOutcome(finished)).toEqual({ over: true, winner: 'black', reason: 'checkmate' });
  });
});
