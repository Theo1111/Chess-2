/**
 * Evidence tiers — the discipline layer between statistics and conclusions.
 *
 *   WATCH             an interesting signal that does not yet justify action:
 *                     small sample, interval touching neutral, single-bot
 *                     evidence, or a known modelling limitation.
 *   INVESTIGATE       strong enough to justify running an explicit balance
 *                     experiment (paired cost override runs).
 *   BALANCE CANDIDATE strong, replicated evidence that a point-value
 *                     experiment should be seriously considered.
 *
 * A finding that clears no bar produces NO tier. "No piece clears the
 * evidence bar" is the system working, not failing — and nothing here ever
 * changes a production value.
 */

import type { Fidelity } from './fidelity';

export type EvidenceTier = 'watch' | 'investigate' | 'balance-candidate';

export interface EvidenceThresholds {
  /** Games the entity must have been fielded in. */
  readonly minimumGames: number;
  /** Distinct armies it appeared in (guards against one-army artifacts). */
  readonly minimumAppearances: number;
  /** Minimum |adjusted effect| in percentage points to be worth naming. */
  readonly minimumAdjustedEffect: number;
  /** The 95% interval must clear neutral by this many percentage points. */
  readonly minimumConfidence: number;
  /** BALANCE CANDIDATE additionally needs a second bot pointing the same way. */
  readonly requireCrossBotReplication: boolean;
}

export const DEFAULT_THRESHOLDS: EvidenceThresholds = {
  minimumGames: 500,
  minimumAppearances: 5,
  minimumAdjustedEffect: 2,
  minimumConfidence: 0,
  requireCrossBotReplication: true,
};

export interface EvidenceInput {
  readonly games: number;
  readonly appearances: number;
  /** Adjusted effect and its 95% interval, in percentage points. */
  readonly effectPp: number;
  readonly effectLowPp: number;
  readonly effectHighPp: number;
  readonly fidelity: Fidelity;
  /**
   * Cross-bot replication: true = a second bot's model agrees in direction,
   * false = it disagrees, null/undefined = no cross-bot data yet.
   */
  readonly crossBotAgreement?: boolean | null;
}

export function classifyEvidence(
  input: EvidenceInput,
  thresholds: EvidenceThresholds = DEFAULT_THRESHOLDS,
): EvidenceTier | null {
  const magnitude = Math.abs(input.effectPp);
  const excludesNeutral =
    input.effectLowPp > thresholds.minimumConfidence ||
    input.effectHighPp < -thresholds.minimumConfidence;

  // Nothing notable at all → no finding.
  if (magnitude < thresholds.minimumAdjustedEffect && !excludesNeutral) return null;

  // A modelling limitation caps everything it touches.
  if (input.fidelity !== 'full') return 'watch';

  // A second bot actively disagreeing means the signal likely exploits one
  // bot's weaknesses — keep watching, do not escalate.
  if (input.crossBotAgreement === false) return 'watch';

  if (
    input.games < thresholds.minimumGames ||
    input.appearances < thresholds.minimumAppearances ||
    !excludesNeutral ||
    magnitude < thresholds.minimumAdjustedEffect
  ) {
    return 'watch';
  }

  if (thresholds.requireCrossBotReplication && input.crossBotAgreement !== true) {
    return 'investigate';
  }
  return 'balance-candidate';
}
