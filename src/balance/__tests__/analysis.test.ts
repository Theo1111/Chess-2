import { describe, expect, it } from 'vitest';
import type { MatchRecord } from '../../sim/tournament';
import type { MatchTelemetry } from '../../sim/telemetry';
import { classifyEvidence, DEFAULT_THRESHOLDS } from '../evidence';
import { fitBalanceModel, pieceEfficiency, predict } from '../model';
import { pairSynergies } from '../synergy';
import { pointRecommendations } from '../recommendations';
import { cardStats, firstMoveAdvantage, matchupMatrix, pieceStats, wilson } from '../stats';

/** Minimal synthetic record factory. */
function record(overrides: {
  index: number;
  winner: 'white' | 'black' | 'draw';
  whitePieces: Record<string, number>;
  blackPieces: Record<string, number>;
  whiteId?: string;
  blackId?: string;
  whiteSpells?: string[];
  blackSpells?: string[];
  pairing?: number;
  seed?: number;
  telemetry?: MatchTelemetry | null;
}): MatchRecord {
  return {
    index: overrides.index,
    pairing: overrides.pairing ?? overrides.index,
    seed: overrides.seed ?? overrides.index,
    whiteAgent: 'a',
    blackAgent: 'a',
    white: {
      id: overrides.whiteId ?? `army-w${overrides.index}`,
      composition: overrides.whitePieces,
      spells: overrides.whiteSpells ?? [],
      traps: [],
    },
    black: {
      id: overrides.blackId ?? `army-b${overrides.index}`,
      composition: overrides.blackPieces,
      spells: overrides.blackSpells ?? [],
      traps: [],
    },
    winner: overrides.winner,
    reason: 'checkmate',
    plies: 40,
    telemetry: overrides.telemetry ?? null,
  };
}

describe('wilson interval', () => {
  it('behaves sanely at the extremes', () => {
    expect(wilson(0, 0)).toEqual({ rate: 0, games: 0, low: 0, high: 1 });
    const half = wilson(50, 100);
    expect(half.rate).toBeCloseTo(0.5);
    expect(half.low).toBeGreaterThan(0.4);
    expect(half.high).toBeLessThan(0.6);
    const tiny = wilson(2, 2);
    expect(tiny.low).toBeLessThan(0.5); // two games prove nothing
  });
});

describe('pieceStats', () => {
  it('aggregates selection, wins and color-adjusted rates', () => {
    const records = [
      // champion always on the winning side, once as white, once as black.
      record({ index: 0, winner: 'white', whitePieces: { king: 1, champion: 2 }, blackPieces: { king: 1, rook: 2 } }),
      record({ index: 1, winner: 'black', whitePieces: { king: 1, rook: 2 }, blackPieces: { king: 1, champion: 2 } }),
    ];
    const stats = pieceStats(records);
    const champion = stats.get('champion')!;
    expect(champion.gamesSelected).toBe(2);
    expect(champion.wins).toBe(2);
    expect(champion.colorAdjustedWinRate).toBe(1);
    expect(champion.averageCopies).toBe(2);

    const rook = stats.get('rook')!;
    expect(rook.losses).toBe(2);
    expect(rook.colorAdjustedWinRate).toBe(0);
  });
});

describe('balance model', () => {
  it('learns that the stacked piece wins and prices it above the filler', () => {
    // 300 synthetic games: armies with "strong" beat armies with "weak" 90%.
    const records: MatchRecord[] = [];
    for (let i = 0; i < 300; i++) {
      const strongIsWhite = i % 2 === 0;
      // Decoupled from colour parity: consecutive pairs share the outcome, so
      // the 90% strength signal cannot masquerade as first-move advantage.
      const strongWins = (i >> 1) % 10 !== 9; // 90%
      const winner = strongIsWhite === strongWins ? 'white' : 'black';
      records.push(
        record({
          index: i,
          winner,
          whitePieces: strongIsWhite ? { king: 1, strong: 2 } : { king: 1, weak: 2 },
          blackPieces: strongIsWhite ? { king: 1, weak: 2 } : { king: 1, strong: 2 },
        }),
      );
    }
    const model = fitBalanceModel(records);
    expect(model.pieces.get('strong')!).toBeGreaterThan(model.pieces.get('weak')!);

    // Alternating colours: no first-move signal to learn.
    expect(Math.abs(model.intercept)).toBeLessThan(0.2);

    const efficiency = pieceEfficiency(model, () => 5);
    expect(efficiency[0]!.piece).toBe('strong');

    // Predictions follow the learned ordering.
    const probe = record({
      index: 999,
      winner: 'draw',
      whitePieces: { king: 1, strong: 2 },
      blackPieces: { king: 1, weak: 2 },
    });
    expect(predict(model, probe)).toBeGreaterThan(0.7);
  });

  it('absorbs first-move advantage into the intercept', () => {
    // Identical armies, white wins 70% — only the intercept can explain it.
    const records: MatchRecord[] = [];
    for (let i = 0; i < 200; i++) {
      records.push(
        record({
          index: i,
          winner: i % 10 < 7 ? 'white' : 'black',
          whitePieces: { king: 1, same: 3 },
          blackPieces: { king: 1, same: 3 },
        }),
      );
    }
    const model = fitBalanceModel(records);
    expect(model.intercept).toBeGreaterThan(0.3);
    expect(Math.abs(model.pieces.get('same') ?? 0)).toBeLessThan(0.05);
  });
});

describe('synergy', () => {
  it('flags a pair that beats its parts', () => {
    const records: MatchRecord[] = [];
    for (let i = 0; i < 400; i++) {
      const together = i % 2 === 0;
      // Individually mediocre pieces; together they win 85% as white.
      const winner = together ? (i % 20 < 17 ? 'white' : 'black') : i % 2 === 1 && i % 4 === 1 ? 'white' : 'black';
      records.push(
        record({
          index: i,
          winner,
          whitePieces: together ? { king: 1, alpha: 1, beta: 1 } : { king: 1, alpha: 1, gamma: 1 },
          blackPieces: { king: 1, gamma: 2 },
        }),
      );
    }
    const model = fitBalanceModel(records);
    const synergies = pairSynergies(records, model, { minGames: 50, includeCards: false });
    const pair = synergies.find((entry) => entry.a === 'alpha' && entry.b === 'beta');
    expect(pair).toBeDefined();
    expect(pair!.games).toBe(200);
    expect(pair!.reliable).toBe(true);
  });
});

describe('evidence tiers', () => {
  const strong = {
    games: 2000,
    appearances: 20,
    effectPp: 6,
    effectLowPp: 3.5,
    effectHighPp: 8.5,
    fidelity: 'full' as const,
  };

  it('classifies synthetic findings into the three tiers', () => {
    // Full evidence + cross-bot agreement → candidate.
    expect(classifyEvidence({ ...strong, crossBotAgreement: true })).toBe('balance-candidate');
    // No cross-bot data yet → capped at investigate.
    expect(classifyEvidence({ ...strong, crossBotAgreement: null })).toBe('investigate');
    // The other bot disagrees → likely exploits weak play → watch.
    expect(classifyEvidence({ ...strong, crossBotAgreement: false })).toBe('watch');
    // Small sample → watch.
    expect(classifyEvidence({ ...strong, games: 60, crossBotAgreement: true })).toBe('watch');
    // Interval crossing neutral → watch.
    expect(
      classifyEvidence({ ...strong, effectLowPp: -1, crossBotAgreement: true }),
    ).toBe('watch');
    // Limited fidelity caps everything → watch.
    expect(
      classifyEvidence({
        ...strong,
        fidelity: 'limited-hidden-information',
        crossBotAgreement: true,
      }),
    ).toBe('watch');
    // Nothing notable → no finding at all.
    expect(
      classifyEvidence({
        ...strong,
        effectPp: 0.5,
        effectLowPp: -1,
        effectHighPp: 2,
      }),
    ).toBeNull();
  });

  it('cross-bot replication can be made optional', () => {
    expect(
      classifyEvidence(
        { ...strong, crossBotAgreement: null },
        { ...DEFAULT_THRESHOLDS, requireCrossBotReplication: false },
      ),
    ).toBe('balance-candidate');
  });
});

describe('recommendations', () => {
  it('only tiers above WATCH produce suggestions, conservatively worded', () => {
    const recommendations = pointRecommendations([
      { piece: 'hot', cost: 3, effectPp: 6, effectLowPp: 3, effectHighPp: 9, games: 2000, tier: 'investigate' },
      { piece: 'cold', cost: 9, effectPp: -5, effectLowPp: -8, effectHighPp: -2, games: 1500, tier: 'balance-candidate' },
      { piece: 'watched', cost: 5, effectPp: 7, effectLowPp: 1, effectHighPp: 13, games: 90, tier: 'watch' },
      { piece: 'quiet', cost: 5, effectPp: 0.2, effectLowPp: -1, effectHighPp: 1.4, games: 5000, tier: null },
    ]);
    const pieces = recommendations.map((entry) => entry.piece);
    expect(pieces).toContain('hot');
    expect(pieces).toContain('cold');
    expect(pieces).not.toContain('watched');
    expect(pieces).not.toContain('quiet');

    const hot = recommendations.find((entry) => entry.piece === 'hot')!;
    expect(hot.suggestedInvestigation).toBe(4);
    expect(hot.reason).toContain('may be underpriced');
    const cold = recommendations.find((entry) => entry.piece === 'cold')!;
    expect(cold.suggestedInvestigation).toBe(8);
    expect(cold.confidence).toBeGreaterThan(hot.confidence - 1); // both bounded
    expect(recommendations.every((entry) => entry.confidence < 1)).toBe(true);
  });
});

describe('raw-vs-adjusted confounding', () => {
  it('does not credit a passenger piece with its partner’s strength', () => {
    // 'carry' is genuinely strong; 'passenger' rides along in the same army
    // half the time but adds nothing. Raw win rate makes passenger look
    // great; the adjusted model must not.
    const records: MatchRecord[] = [];
    for (let i = 0; i < 600; i++) {
      const carryIsWhite = i % 2 === 0;
      const carryWins = (i >> 1) % 10 !== 0; // 90%
      const withPassenger = i % 4 < 2; // half of carry armies
      const carrySide: Record<string, number> = withPassenger
        ? { king: 1, carry: 1, passenger: 1 }
        : { king: 1, carry: 1, filler: 1 };
      const other: Record<string, number> = { king: 1, filler: 2 };
      records.push(
        record({
          index: i,
          winner: carryIsWhite === carryWins ? 'white' : 'black',
          whitePieces: carryIsWhite ? carrySide : other,
          blackPieces: carryIsWhite ? other : carrySide,
        }),
      );
    }
    const model = fitBalanceModel(records);
    const stats = pieceStats(records);

    // Raw: the passenger LOOKS like a winner (it always rides with carry).
    expect(stats.get('passenger')!.colorAdjustedWinRate).toBeGreaterThanOrEqual(0.75);
    // Adjusted: the model gives the credit to the carry, not the passenger.
    expect(model.pieces.get('carry')!).toBeGreaterThan(0.5);
    expect(model.pieces.get('passenger')!).toBeLessThan(model.pieces.get('carry')! / 2);
  });
});

describe('model standard errors', () => {
  it('shrink with sample size and gate the interval', () => {
    const make = (count: number): MatchRecord[] => {
      const records: MatchRecord[] = [];
      for (let i = 0; i < count; i++) {
        const strongIsWhite = i % 2 === 0;
        const strongWins = (i >> 1) % 5 !== 0; // 80%
        records.push(
          record({
            index: i,
            winner: strongIsWhite === strongWins ? 'white' : 'black',
            whitePieces: strongIsWhite ? { king: 1, s: 2 } : { king: 1, w: 2 },
            blackPieces: strongIsWhite ? { king: 1, w: 2 } : { king: 1, s: 2 },
          }),
        );
      }
      return records;
    };
    const small = fitBalanceModel(make(80));
    const large = fitBalanceModel(make(800));
    const smallSe = small.standardErrors.get('p:s')!;
    const largeSe = large.standardErrors.get('p:s')!;
    expect(Number.isFinite(smallSe)).toBe(true);
    expect(largeSe).toBeLessThan(smallSe);
  });
});

describe('matchups and first-move report', () => {
  it('builds the matrix and separates mirrored evidence', () => {
    const records = [
      record({ index: 0, pairing: 0, seed: 7, winner: 'white', whiteId: 'army-A', blackId: 'army-B', whitePieces: { king: 1 }, blackPieces: { king: 1 } }),
      record({ index: 1, pairing: 0, seed: 7, winner: 'white', whiteId: 'army-B', blackId: 'army-A', whitePieces: { king: 1 }, blackPieces: { king: 1 } }),
      record({ index: 2, pairing: 1, seed: 8, winner: 'draw', whiteId: 'army-A', blackId: 'army-B', whitePieces: { king: 1 }, blackPieces: { king: 1 } }),
    ];
    const matrix = matchupMatrix(records);
    const aVersusB = matrix.get('army-A')!.get('army-B')!;
    expect(aVersusB.games).toBe(3);
    expect(aVersusB.score).toBe(1.5); // win + loss + draw from A's side

    const firstMove = firstMoveAdvantage(records);
    expect(firstMove.games).toBe(3);
    expect(firstMove.mirroredGames).toBe(2);
    expect(firstMove.mirroredWhiteScore.rate).toBe(1); // both mirrored games went to white
  });
});

describe('cardStats', () => {
  it('tracks pick, use and trap lifecycle rates', () => {
    const telemetry: MatchTelemetry = {
      plies: 30,
      captures: [],
      cardsPlayed: [
        { ply: 4, by: 'white', card: 'shield', trap: false },
        { ply: 6, by: 'white', card: 'tripwire', trap: true },
      ],
      traps: [
        { card: 'tripwire', owner: 'white', placedPly: 6, resolvedPly: 12, triggered: true, revealed: true },
      ],
      survivors: { white: {}, black: {} },
      initial: { white: {}, black: {} },
    };
    const records = [
      record({
        index: 0,
        winner: 'white',
        whitePieces: { king: 1 },
        blackPieces: { king: 1 },
        whiteSpells: ['shield', 'freeze'],
        telemetry,
      }),
    ];
    const { spells, traps } = cardStats(records);
    const shield = spells.get('shield')!;
    expect(shield.gamesSelected).toBe(1);
    expect(shield.useRate).toBe(1);
    expect(shield.averagePlyUsed).toBe(4);
    const freeze = spells.get('freeze')!;
    expect(freeze.useRate).toBe(0);

    const tripwire = traps.get('tripwire')!;
    expect(tripwire.gamesPlaced).toBe(1);
    expect(tripwire.triggerRate).toBe(1);
    expect(tripwire.revealRate).toBe(1);
    expect(tripwire.averagePlyTriggered).toBe(12);
  });
});
