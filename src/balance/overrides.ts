/**
 * Temporary cost overrides for balance experiments (`--override champion=10`).
 *
 * Cost is gameplay-relevant (Sacrifice pairs pieces by point value, army
 * budgets spend it), so an honest experiment must run with the override live
 * in the registry — but only inside this process, and only for the duration
 * of the experiment. `withCostOverrides` re-registers copies and ALWAYS
 * restores the untouched originals afterwards, crash or not. Production
 * definitions on disk are never modified.
 */

import { getPieceDefinition, registerPiece, type PieceDefinition } from '../engine';

export type CostOverrides = Readonly<Record<string, number>>;

export function withCostOverrides<T>(overrides: CostOverrides, run: () => T): T {
  const originals: PieceDefinition[] = [];
  for (const [type, cost] of Object.entries(overrides)) {
    const original = getPieceDefinition(type); // throws on unknown pieces
    if (!Number.isInteger(cost) || cost < 1) {
      throw new Error(`Override for ${type} must be a positive integer, got ${cost}`);
    }
    originals.push(original);
    registerPiece({ ...original, cost });
  }
  try {
    return run();
  } finally {
    for (const original of originals) registerPiece(original);
  }
}

/** Parses repeated `piece=cost` strings from the command line. */
export function parseOverrides(pairs: readonly string[]): CostOverrides {
  const overrides: Record<string, number> = {};
  for (const pair of pairs) {
    const [piece, cost] = pair.split('=');
    if (!piece || cost === undefined || cost === '' || Number.isNaN(Number(cost))) {
      throw new Error(`Bad override "${pair}" — expected piece=cost, e.g. champion=10`);
    }
    overrides[piece] = Number(cost);
  }
  return overrides;
}
