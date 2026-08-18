import { describe, expect, it } from 'vitest';
import '../../engine/customPieces';
import '../../engine/rookPieces';
import '../../engine/knightPieces';
import '../../engine/bishopPieces';
import { createRng } from '../../sim/seededRandom';
import { partitionPairings, runParallelTournament } from '../../sim/parallel';
import { runTournament } from '../../sim/tournament';
import { buildAgents } from '../../ai/agentFactory';
import { generateArmy } from '../armies';
import { FuzzAggregator } from '../fuzz';
import { compareRuns, type RunArtifacts } from '../compare';
import { buildReport, renderConsoleReport } from '../report';

const armies = [generateArmy(createRng(61)), generateArmy(createRng(62))];

describe('partitionPairings', () => {
  it('covers every pairing exactly once, any worker count', () => {
    for (const workers of [1, 2, 3, 7]) {
      const partitions = partitionPairings(23, workers);
      const seen = partitions.flat().sort((a, b) => a - b);
      expect(seen).toEqual(Array.from({ length: 23 }, (_, i) => i));
    }
    expect(partitionPairings(2, 8).length).toBe(2); // no empty hands
  });
});

describe('runParallelTournament (in-process reference path)', () => {
  it('workers=1 equals a direct runTournament', async () => {
    const direct = runTournament({
      games: 6,
      agents: buildAgents([{ kind: 'random' }]),
      armies,
      seed: 5,
      maxPlies: 60,
    });
    const viaParallel = await runParallelTournament({
      games: 6,
      seed: 5,
      agents: [{ kind: 'random' }],
      armies,
      workers: 1,
      maxPlies: 60,
    });
    expect(JSON.stringify(viaParallel.records)).toBe(JSON.stringify(direct.records));
    expect([...viaParallel.armyElo.entries()]).toEqual([...direct.armyElo.entries()]);
  });
});

describe('fuzz aggregation', () => {
  it('counts terminations, coverage and cap hits from streamed records', () => {
    const result = runTournament({
      games: 8,
      agents: buildAgents([{ kind: 'random' }]),
      armies,
      seed: 11,
      maxPlies: 40,
    });
    const aggregator = new FuzzAggregator();
    for (const record of result.records) aggregator.record(record);
    const report = aggregator.finish(result.failures.length);

    expect(report.label).toBe('engine-stress-test-not-balance-evidence');
    expect(report.games).toBe(8);
    expect(Object.values(report.reasons).reduce((a, b) => a + b, 0)).toBe(8);
    expect(report.maxTurnGames).toBe(report.reasons['max-plies'] ?? 0);
    expect(report.minPlies).toBeGreaterThan(0);
    expect(report.maxPlies).toBeLessThanOrEqual(40);
    // Two small armies cannot exercise the whole registry — holes must be flagged.
    expect(report.underExercised.pieces.length).toBeGreaterThan(0);
  });
});

describe('report + compare', () => {
  const makeRun = (
    name: string,
    seed: number,
    config: Partial<RunArtifacts['config']>,
  ): RunArtifacts => {
    const result = runTournament({
      games: 8,
      agents: buildAgents([{ kind: 'random' }]),
      armies,
      seed,
      maxPlies: 60,
    });
    return {
      name,
      config: { seed, games: 8, bot: 'random', ...config },
      report: buildReport(result),
    };
  };

  it('report renders limitations, first-move section and health, and is JSON-safe', () => {
    const run = makeRun('base', 5, { contentFingerprint: 'aaa' });
    const text = renderConsoleReport(run.report, {
      runName: 'base',
      seed: 5,
      workers: 2,
      contentFingerprint: 'aaa',
      overrides: { champion: { from: 9, to: 10 } },
    });
    expect(text).toContain('FIRST-MOVE ADVANTAGE');
    expect(text).toContain('MODELING LIMITATIONS');
    expect(text).toContain('reconnaissance');
    expect(text).toContain('smoke-screen');
    expect(text).toContain('BALANCE OVERRIDES ACTIVE');
    expect(text).toContain('Champion: 9 → 10');
    expect(text).toContain('Max-turn terminations');
    // The whole report must survive JSON round-tripping (report.json).
    const roundTripped = JSON.parse(JSON.stringify(run.report)) as typeof run.report;
    expect(roundTripped.analysisLimitations.reconHiddenState).toBe(true);
    expect(roundTripped.pieces.length).toBe(run.report.pieces.length);
  });

  it('compare warns on fingerprint drift and reports overrides + deltas', () => {
    const baseline = makeRun('baseline', 5, { contentFingerprint: 'aaa' });
    const experiment = makeRun('experiment', 6, {
      contentFingerprint: 'bbb',
      overrides: { champion: 10 },
      costs: { champion: 10 },
    });
    const text = compareRuns(baseline, experiment);
    expect(text).toContain('WARNING: GAMEPLAY REGISTRY DIFFERS');
    expect(text).toContain('COST OVERRIDES');
    expect(text).toContain('champion');
    expect(text).toContain('GLOBAL');
    expect(text).toContain('Draw rate');
  });

  it('compare recognizes override-only fingerprint differences', () => {
    const baseline = makeRun('baseline', 5, {
      contentFingerprint: 'aaa',
      baselineContentFingerprint: 'aaa',
    });
    const experiment = makeRun('experiment', 5, {
      contentFingerprint: 'bbb',
      baselineContentFingerprint: 'aaa',
      overrides: { champion: 10 },
    });
    const text = compareRuns(baseline, experiment);
    expect(text).toContain('differ ONLY by the declared cost overrides');
    expect(text).not.toContain('WARNING: GAMEPLAY REGISTRY DIFFERS');
  });

  it('compare switches to cross-bot replication when bots differ', () => {
    const greedy = makeRun('greedy-run', 5, { bot: 'greedy', contentFingerprint: 'aaa' });
    const search = makeRun('search-run', 5, { bot: 'alphabeta', contentFingerprint: 'aaa' });
    const text = compareRuns(greedy, search);
    expect(text).toContain('CROSS-BOT REPLICATION');
    expect(text).toContain('agree:');
  });
});
