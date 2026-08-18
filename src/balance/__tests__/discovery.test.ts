/**
 * New-content automation: register a piece the balance system has never
 * heard of and prove it flows through army generation, simulation, stats and
 * the model with zero balance-side changes.
 *
 * (Vitest isolates test files, so the dummy registration cannot leak into
 * other suites.)
 */

import { describe, expect, it } from 'vitest';
import '../../engine/customPieces';
import '../../engine/rookPieces';
import '../../engine/knightPieces';
import '../../engine/bishopPieces';
import { KNIGHT_LEAPS, registerPiece } from '../../engine';
import { costOf, draftablePieces, validateRoster } from '../../roster';
import { RandomBot } from '../../ai/randomBot';
import { createRng } from '../../sim/seededRandom';
import { runTournament } from '../../sim/tournament';
import { generateArmy } from '../armies';
import { fitBalanceModel } from '../model';
import { pieceStats } from '../stats';
import { withCostOverrides } from '../overrides';

const DUMMY = 'test-dummy-piece';

registerPiece({
  type: DUMMY,
  name: 'Test Dummy',
  symbol: 'y',
  value: 3,
  pieceClass: 'knight',
  cost: 3,
  patterns: [{ vectors: KNIGHT_LEAPS }],
  movementText: 'Moves and captures like a Knight.',
  abilityText: 'None — exists to prove registry discovery.',
  flavor: 'I was registered five lines ago.',
});

describe('registry discovery', () => {
  it('the draft catalog and cost lookup see the new piece immediately', () => {
    expect(draftablePieces().some((piece) => piece.type === DUMMY)).toBe(true);
    expect(costOf(DUMMY)).toBe(3);
  });

  it('piece-heavy generation drafts it and tournaments record it', () => {
    const army = generateArmy(createRng(1), { mode: { kind: 'piece-heavy', piece: DUMMY } });
    expect(validateRoster(army, { requirePlacement: true, requireLoadout: true }).valid).toBe(true);
    expect(army.units.some((unit) => unit.type === DUMMY)).toBe(true);

    const result = runTournament({
      games: 2,
      agents: [new RandomBot()],
      armies: [army, generateArmy(createRng(2))],
      seed: 3,
      maxPlies: 40,
    });
    expect(result.failures).toEqual([]);

    const stats = pieceStats(result.records);
    expect(stats.get(DUMMY)?.gamesSelected).toBeGreaterThan(0);

    const model = fitBalanceModel(result.records);
    expect(model.pieces.has(DUMMY)).toBe(true);
  });

  it('cost overrides apply and always restore', () => {
    expect(costOf(DUMMY)).toBe(3);
    withCostOverrides({ [DUMMY]: 7 }, () => {
      expect(costOf(DUMMY)).toBe(7);
    });
    expect(costOf(DUMMY)).toBe(3);

    // Restoration survives an exception inside the experiment.
    expect(() =>
      withCostOverrides({ [DUMMY]: 9 }, () => {
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(costOf(DUMMY)).toBe(3);

    expect(() => withCostOverrides({ 'no-such-piece': 5 }, () => undefined)).toThrow();
  });
});
