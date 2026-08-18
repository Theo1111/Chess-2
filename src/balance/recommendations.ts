/**
 * Point-cost investigation suggestions, derived from evidence tiers.
 *
 * Only pieces at INVESTIGATE or BALANCE CANDIDATE produce a suggestion, and
 * the wording stays "suggested investigation" — this system never changes a
 * cost itself; the designer decides. WATCH-tier signals appear in the report
 * but never as recommendations.
 */

import type { EvidenceTier } from './evidence';

export interface PointRecommendation {
  readonly piece: string;
  readonly currentCost: number;
  readonly suggestedInvestigation: number;
  readonly tier: Exclude<EvidenceTier, 'watch'>;
  /** Heuristic 0..1 flag strength — not a probability. */
  readonly confidence: number;
  readonly reason: string;
}

export interface RecommendationInput {
  readonly piece: string;
  readonly cost: number;
  readonly effectPp: number;
  readonly effectLowPp: number;
  readonly effectHighPp: number;
  readonly games: number;
  readonly tier: EvidenceTier | null;
}

export function pointRecommendations(
  entries: readonly RecommendationInput[],
): PointRecommendation[] {
  const recommendations: PointRecommendation[] = [];
  for (const entry of entries) {
    if (entry.tier !== 'investigate' && entry.tier !== 'balance-candidate') continue;

    const direction = entry.effectPp > 0 ? 1 : -1;
    const suggested = Math.max(1, entry.cost + direction);
    if (suggested === entry.cost) continue;

    // How far the interval sits from neutral, tempered by tier.
    const clearance = Math.min(Math.abs(entry.effectLowPp), Math.abs(entry.effectHighPp));
    const base = Math.min(0.95, clearance / 10 + 0.4);
    const confidence = Number(
      (entry.tier === 'balance-candidate' ? base : base * 0.8).toFixed(2),
    );

    recommendations.push({
      piece: entry.piece,
      currentCost: entry.cost,
      suggestedInvestigation: suggested,
      tier: entry.tier,
      confidence,
      reason:
        `Adjusted marginal effect ${entry.effectPp >= 0 ? '+' : ''}${entry.effectPp.toFixed(1)}pp ` +
        `[${entry.effectLowPp.toFixed(1)}, ${entry.effectHighPp.toFixed(1)}] over ${entry.games} games — ` +
        (direction > 0 ? 'may be underpriced.' : 'may be overpriced.'),
    });
  }
  return recommendations.sort((a, b) => b.confidence - a.confidence);
}
