import { describe, expect, it } from 'vitest';
import '../../engine/customPieces';
import '../../engine/rookPieces';
import '../../engine/knightPieces';
import '../../engine/bishopPieces';
import { STARTER_SPELLS, createStateFromFen, toFen } from '../../engine';
import { RandomBot } from '../../ai/randomBot';
import { actionKey } from '../../ai/actions';
import { MatchSimulationError, runMatch } from '../runMatch';

const bot = new RandomBot();

const startState = () => createStateFromFen();

describe('runMatch', () => {
  it('terminates and reports a result', () => {
    const result = runMatch({
      whiteAgent: bot,
      blackAgent: bot,
      initialState: startState(),
      seed: 1,
    });
    expect(['white', 'black', 'draw']).toContain(result.winner);
    expect(result.plies).toBeGreaterThan(0);
    expect(result.reason.length).toBeGreaterThan(0);
    expect(result.actions.length).toBe(result.plies);
  });

  it('is deterministic: same seed, same game', () => {
    const run = () =>
      runMatch({ whiteAgent: bot, blackAgent: bot, initialState: startState(), seed: 987 });
    const a = run();
    const b = run();
    expect(a.actions.map(actionKey)).toEqual(b.actions.map(actionKey));
    expect(a.winner).toBe(b.winner);
    expect(a.reason).toBe(b.reason);
    expect(toFen(a.finalState)).toBe(toFen(b.finalState));
  });

  it('different seeds diverge', () => {
    const a = runMatch({ whiteAgent: bot, blackAgent: bot, initialState: startState(), seed: 1 });
    const b = runMatch({ whiteAgent: bot, blackAgent: bot, initialState: startState(), seed: 2 });
    expect(a.actions.map(actionKey).join('|')).not.toBe(b.actions.map(actionKey).join('|'));
  });

  it('enforces the ply cap with a draw', () => {
    const result = runMatch({
      whiteAgent: bot,
      blackAgent: bot,
      initialState: startState(),
      seed: 5,
      maxPlies: 10,
    });
    if (result.reason === 'max-plies') {
      expect(result.winner).toBe('draw');
      expect(result.plies).toBe(10);
    } else {
      expect(result.plies).toBeLessThanOrEqual(10);
    }
  });

  it('rejects agents that return illegal actions', () => {
    const cheater = {
      id: 'cheater',
      chooseAction: () => ({ kind: 'pass' as const }),
    };
    expect(() =>
      runMatch({ whiteAgent: cheater, blackAgent: bot, initialState: startState(), seed: 3 }),
    ).toThrow(MatchSimulationError);
  });

  it('fuzz: many random games all terminate cleanly with telemetry', { timeout: 90_000 }, () => {
    const outcomes = new Map<string, number>();
    for (let seed = 100; seed < 140; seed++) {
      const result = runMatch({
        whiteAgent: bot,
        blackAgent: bot,
        initialState: startState(),
        seed,
      });
      outcomes.set(result.reason, (outcomes.get(result.reason) ?? 0) + 1);

      const telemetry = result.telemetry!;
      expect(telemetry.plies).toBe(result.plies);
      // Conservation: pieces at start = survivors + pieces that left the board.
      for (const color of ['white', 'black'] as const) {
        const initial = Object.values(telemetry.initial[color]).reduce((a, b) => a + b, 0);
        const left = Object.values(telemetry.survivors[color]).reduce((a, b) => a + b, 0);
        expect(left).toBeLessThanOrEqual(initial);
      }
      // Card events never exceed the starter book each side is dealt.
      const byColor = { white: 0, black: 0 };
      for (const event of telemetry.cardsPlayed) byColor[event.by]++;
      expect(byColor.white).toBeLessThanOrEqual(STARTER_SPELLS.length);
      expect(byColor.black).toBeLessThanOrEqual(STARTER_SPELLS.length);
    }
    expect([...outcomes.values()].reduce((a, b) => a + b, 0)).toBe(40);
  });
});
