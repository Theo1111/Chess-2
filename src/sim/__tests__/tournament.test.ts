import { describe, expect, it } from 'vitest';
import '../../engine/customPieces';
import '../../engine/rookPieces';
import '../../engine/knightPieces';
import '../../engine/bishopPieces';
import { mirrorRoster, validateRoster } from '../../roster';
import { RandomBot } from '../../ai/randomBot';
import { generateArmy, mutateArmy } from '../../balance/armies';
import { armyFingerprint } from '../../balance/fingerprint';
import { createEloTable, expectedScore, rankings, recordResult } from '../../balance/elo';
import { createRng } from '../seededRandom';
import {
  finalizeTournament,
  gamesForPairing,
  runTournament,
  runTournamentBatch,
  totalPairings,
} from '../tournament';

const bot = new RandomBot();

describe('army generation', () => {
  it('produces fully valid armies in every mode', () => {
    const rng = createRng(11);
    const modes = [
      { kind: 'random' } as const,
      { kind: 'class-heavy', pieceClass: 'rook' } as const,
      { kind: 'piece-heavy', piece: 'champion' } as const,
    ];
    for (const mode of modes) {
      for (let i = 0; i < 5; i++) {
        const army = generateArmy(rng.child(`${mode.kind}:${i}`), { mode });
        const validation = validateRoster(army, { requirePlacement: true, requireLoadout: true });
        expect(validation.valid, JSON.stringify(validation.errors)).toBe(true);
      }
    }
  });

  it('class-heavy mode actually biases toward the class', () => {
    const rng = createRng(21);
    let rookish = 0;
    let total = 0;
    for (let i = 0; i < 10; i++) {
      const army = generateArmy(rng.child(i), { mode: { kind: 'class-heavy', pieceClass: 'rook' } });
      for (const unit of army.units) {
        if (unit.type === 'king') continue;
        total++;
        if (['rook', 'berserker', 'leper', 'archer', 'battering-ram', 'catapult', 'jouster'].includes(unit.type)) {
          rookish++;
        }
      }
    }
    expect(rookish / total).toBeGreaterThan(0.5);
  });

  it('is deterministic for a given rng seed', () => {
    const a = generateArmy(createRng(77));
    const b = generateArmy(createRng(77));
    expect(armyFingerprint(a)).toBe(armyFingerprint(b));
  });

  it('mutation keeps armies legal and usually changes them', () => {
    const rng = createRng(31);
    const base = generateArmy(rng.child('base'));
    let changed = 0;
    for (let i = 0; i < 5; i++) {
      const mutant = mutateArmy(base, rng.child(`m${i}`));
      expect(validateRoster(mutant, { requirePlacement: true, requireLoadout: true }).valid).toBe(true);
      if (armyFingerprint(mutant) !== armyFingerprint(base)) changed++;
    }
    expect(changed).toBeGreaterThan(0);
  });
});

describe('army fingerprints', () => {
  it('ignore unit ids and card order, respect composition', () => {
    const army = generateArmy(createRng(41));
    const reordered = {
      ...army,
      spellIds: [...army.spellIds].reverse(),
      trapIds: [...army.trapIds].reverse(),
    };
    expect(armyFingerprint(reordered)).toBe(armyFingerprint(army));

    const mirrored = mirrorRoster(army, 'black');
    expect(armyFingerprint(mirrored)).toBe(armyFingerprint(army));
  });

  it('differ when the army differs', () => {
    const a = generateArmy(createRng(51));
    const b = generateArmy(createRng(52));
    expect(armyFingerprint(a)).not.toBe(armyFingerprint(b));
  });
});

describe('elo', () => {
  it('matches known synthetic results', () => {
    expect(expectedScore(1000, 1000)).toBeCloseTo(0.5);
    expect(expectedScore(1200, 1000)).toBeCloseTo(0.7597, 3);

    const table = createEloTable();
    recordResult(table, 'a', 'b', 1, 32);
    // Equal ratings, K=32: winner gains exactly 16.
    expect(table.get('a')!.rating).toBeCloseTo(1016);
    expect(table.get('b')!.rating).toBeCloseTo(984);
    expect(table.get('a')!.wins).toBe(1);
    expect(table.get('b')!.losses).toBe(1);

    // A dominant player converges upward.
    for (let i = 0; i < 20; i++) recordResult(table, 'a', 'b', 1);
    const ranked = rankings(table);
    expect(ranked[0]!.id).toBe('a');
    expect(ranked[0]!.rating).toBeGreaterThan(ranked[1]!.rating + 100);
  });
});

describe('runTournament', { timeout: 120_000 }, () => {
  it('plays mirrored pairs with paired seeds and is reproducible', () => {
    const armies = [generateArmy(createRng(61)), generateArmy(createRng(62))];
    const run = () =>
      runTournament({
        games: 6,
        agents: [bot],
        armies,
        seed: 5,
        mirrored: true,
        maxPlies: 60,
      });

    const first = run();
    const second = run();

    expect(first.games).toBe(6);
    expect(first.records.map((r) => `${r.seed}:${r.winner}:${r.plies}`)).toEqual(
      second.records.map((r) => `${r.seed}:${r.winner}:${r.plies}`),
    );

    // Mirrored pairs share a seed and swap armies.
    for (let i = 0; i + 1 < first.records.length; i += 2) {
      const gameA = first.records[i]!;
      const gameB = first.records[i + 1]!;
      if (gameA.pairing !== gameB.pairing) continue;
      expect(gameA.seed).toBe(gameB.seed);
      expect(gameA.white.id).toBe(gameB.black.id);
      expect(gameA.black.id).toBe(gameB.white.id);
    }

    // Aggregates line up with the records.
    const wins = first.records.filter((r) => r.winner === 'white').length;
    expect(first.whiteWins).toBe(wins);
    expect(first.totalPlies).toBe(first.records.reduce((sum, r) => sum + r.plies, 0));
    expect(first.failures).toEqual([]);
  });

  it('pairing plan is a pure function of the config', () => {
    expect(totalPairings(10, true)).toBe(5);
    expect(totalPairings(11, true)).toBe(6);
    expect(totalPairings(10, false)).toBe(10);
    expect(gamesForPairing(11, true, 4)).toBe(2);
    expect(gamesForPairing(11, true, 5)).toBe(1); // odd tail plays one side
    expect(gamesForPairing(11, true, 6)).toBe(0);
    expect(gamesForPairing(3, false, 2)).toBe(1);
    expect(gamesForPairing(3, false, 3)).toBe(0);
  });

  it('any partition of pairings reproduces the exact same tournament', () => {
    const armies = [generateArmy(createRng(81)), generateArmy(createRng(82))];
    const config = {
      games: 9, // odd: exercises the one-game tail pairing
      agents: [bot],
      armies,
      seed: 17,
      mirrored: true,
      maxPlies: 50,
    };

    const whole = runTournament(config);

    // Simulate 3 executors taking interleaved pairing subsets — the same
    // partitioning the worker pool uses — then merge.
    const pairingCount = totalPairings(config.games, true);
    const batches = [0, 1, 2].map((worker) => {
      const subset: number[] = [];
      for (let p = worker; p < pairingCount; p += 3) subset.push(p);
      return runTournamentBatch(config, subset);
    });
    const merged = finalizeTournament(
      batches.flatMap((batch) => batch.records),
      batches.flatMap((batch) => batch.failures),
    );

    expect(JSON.stringify(merged.records)).toBe(JSON.stringify(whole.records));
    expect(merged.games).toBe(whole.games);
    expect([...merged.armyElo.entries()]).toEqual([...whole.armyElo.entries()]);
    expect([...merged.agentElo.entries()]).toEqual([...whole.agentElo.entries()]);
    expect(merged.whiteWins).toBe(whole.whiteWins);
    expect(merged.totalPlies).toBe(whole.totalPlies);
  });

  it('rates armies and never mixes the two ladders', () => {
    const armies = [generateArmy(createRng(71)), generateArmy(createRng(72))];
    const result = runTournament({
      games: 4,
      agents: [bot],
      armies,
      seed: 9,
      maxPlies: 40,
      collectTelemetry: false,
    });
    // Self-play with one agent: the agent ladder stays empty.
    expect(result.agentElo.size).toBe(0);
    for (const id of result.armyElo.keys()) {
      expect(id.startsWith('army-')).toBe(true);
    }
  });
});
