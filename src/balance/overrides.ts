/**
 * Temporary cost overrides for balance experiments (`--override champion=10`
 * or `--override shield=3` — pieces and cards share the point system, so
 * both are overridable by id).
 *
 * Cost is gameplay-relevant (Sacrifice pairs pieces by point value, army
 * budgets spend it), so an honest experiment must run with the override live
 * in the registry — but only inside this process, and only for the duration
 * of the experiment. `withCostOverrides` re-registers copies and ALWAYS
 * restores the untouched originals afterwards, crash or not. Production
 * definitions on disk are never modified.
 */

import {
  getPieceDefinition,
  getSpellDefinition,
  hasPieceDefinition,
  registerPiece,
  registerSpell,
} from '../engine';

export type CostOverrides = Readonly<Record<string, number>>;

export function withCostOverrides<T>(overrides: CostOverrides, run: () => T): T {
  const restores: (() => void)[] = [];
  for (const [id, cost] of Object.entries(overrides)) {
    if (!Number.isInteger(cost) || cost < 1) {
      throw new Error(`Override for ${id} must be a positive integer, got ${cost}`);
    }
    if (hasPieceDefinition(id)) {
      const original = getPieceDefinition(id);
      restores.push(() => registerPiece(original));
      registerPiece({ ...original, cost });
    } else {
      const original = getSpellDefinition(id); // throws on fully unknown ids
      restores.push(() => registerSpell(original));
      registerSpell({ ...original, cost });
    }
  }
  try {
    return run();
  } finally {
    for (const restore of restores) restore();
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
