/**
 * Synergy analysis: does a combination outperform the sum of its parts?
 *
 * For every pair that appears together in an army (piece×piece today;
 * piece×card and card×card ride the same machinery), compare the sides'
 * ACTUAL score against the score the marginal model PREDICTED for those
 * exact games. The model already prices each part individually, so a
 * persistent gap is the value of the combination itself:
 *
 *   delta > 0  → synergy (flag if large)
 *   delta < 0  → anti-synergy (design conflict worth a look)
 *
 * Pairs below `minGames` are reported but marked unreliable — never draw
 * conclusions from twenty games.
 */

import type { MatchRecord } from '../sim/tournament';
import { classifyEvidence, type EvidenceThresholds, type EvidenceTier } from './evidence';
import { contentFidelity, type Fidelity } from './fidelity';
import { predict, type BalanceModel } from './model';

export interface SynergyEntry {
  readonly a: string;
  readonly b: string;
  readonly games: number;
  readonly expectedScore: number;
  readonly actualScore: number;
  readonly delta: number;
  /** 95% interval on the delta (binomial approximation on the actual score). */
  readonly deltaLow: number;
  readonly deltaHigh: number;
  readonly reliable: boolean;
  /** Weakest fidelity among the pair's members. */
  readonly fidelity: Fidelity;
  readonly tier: EvidenceTier | null;
}

export interface SynergyOptions {
  readonly minGames?: number;
  /** Include piece×spell and piece×trap pairs, not just piece×piece. */
  readonly includeCards?: boolean;
  readonly thresholds?: EvidenceThresholds;
}

/** The card id inside an item key like `spell:shield`; pieces pass through. */
const memberId = (item: string): string => item.replace(/^(spell|trap):/, '');

export function pairSynergies(
  records: readonly MatchRecord[],
  model: BalanceModel,
  options: SynergyOptions = {},
): SynergyEntry[] {
  const minGames = options.minGames ?? 50;
  const includeCards = options.includeCards ?? true;

  interface Accumulator {
    games: number;
    expected: number;
    actual: number;
  }
  const pairs = new Map<string, Accumulator>();

  for (const record of records) {
    for (const side of ['white', 'black'] as const) {
      const army = side === 'white' ? record.white : record.black;
      const whiteProbability = predict(model, record);
      const expected = side === 'white' ? whiteProbability : 1 - whiteProbability;
      const actual =
        record.winner === 'draw' ? 0.5 : record.winner === side ? 1 : 0;

      const pieces = Object.keys(army.composition)
        .filter((piece) => piece !== 'king')
        .sort();
      const items: string[] = [...pieces];
      if (includeCards) {
        items.push(...army.spells.map((card) => `spell:${card}`));
        items.push(...army.traps.map((card) => `trap:${card}`));
      }

      for (let i = 0; i < pieces.length; i++) {
        for (let j = i + 1; j < items.length; j++) {
          const a = pieces[i]!;
          const b = items[j]!;
          if (a === b) continue;
          const key = `${a}|${b}`;
          const acc = pairs.get(key) ?? { games: 0, expected: 0, actual: 0 };
          acc.games++;
          acc.expected += expected;
          acc.actual += actual;
          pairs.set(key, acc);
        }
      }
    }
  }

  return [...pairs.entries()]
    .map(([key, acc]) => {
      const [a, b] = key.split('|') as [string, string];
      const expectedScore = acc.expected / acc.games;
      const actualScore = acc.actual / acc.games;
      const delta = actualScore - expectedScore;
      // Binomial-style interval on the observed score; the expectation is
      // treated as fixed. Draws-as-half makes this an approximation.
      const se = Math.sqrt(Math.max(actualScore * (1 - actualScore), 1e-9) / acc.games);
      const deltaLow = delta - 1.96 * se;
      const deltaHigh = delta + 1.96 * se;

      const fidelityOf = (item: string): 'full' | 'limited-hidden-information' | 'experimental' =>
        contentFidelity(memberId(item));
      const fidelity =
        fidelityOf(a) !== 'full' ? fidelityOf(a) : fidelityOf(b);

      const tier = classifyEvidence(
        {
          games: acc.games,
          appearances: acc.games, // pair-level army identity is not tracked
          effectPp: delta * 100,
          effectLowPp: deltaLow * 100,
          effectHighPp: deltaHigh * 100,
          fidelity,
          crossBotAgreement: null,
        },
        options.thresholds,
      );

      return {
        a,
        b,
        games: acc.games,
        expectedScore,
        actualScore,
        delta,
        deltaLow,
        deltaHigh,
        reliable: acc.games >= minGames,
        fidelity,
        tier: acc.games >= minGames ? tier : tier === null ? null : ('watch' as const),
      };
    })
    .sort((left, right) => Math.abs(right.delta) - Math.abs(left.delta));
}
