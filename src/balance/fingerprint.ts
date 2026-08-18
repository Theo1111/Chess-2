/**
 * Army fingerprints — a stable identity for a composition.
 *
 * Two rosters that field the same pieces on the same (colour-normalized)
 * squares with the same card decks are the same army, regardless of unit ids,
 * purchase order, card order or which colour happens to play it. Ratings and
 * matchup matrices key off this.
 */

import { RANK_COUNT, fileOf, makeSquare, rankOf, type Square } from '../engine';
import type { Roster } from '../roster';

/** A placement square in white's frame of reference. */
function normalizeSquare(square: Square, color: Roster['color']): Square {
  if (color === 'white') return square;
  return makeSquare(fileOf(square), RANK_COUNT - 1 - rankOf(square));
}

/** Canonical, human-readable description string. */
export function armyDescriptor(roster: Roster): string {
  const placements = roster.units
    .map((unit) => {
      const square = roster.placement[unit.id];
      return square === undefined
        ? `${unit.type}@?`
        : `${unit.type}@${normalizeSquare(square, roster.color)}`;
    })
    .sort();
  const spells = [...roster.spellIds].sort();
  const traps = [...roster.trapIds].sort();
  return `${placements.join(',')}|s:${spells.join(',')}|t:${traps.join(',')}`;
}

/** Short stable id derived from the descriptor (FNV-1a, hex). */
export function armyFingerprint(roster: Roster): string {
  const text = armyDescriptor(roster);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `army-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

/** Composition summary for telemetry rows (types → copies). */
export function armyComposition(roster: Roster): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const unit of roster.units) {
    counts[unit.type] = (counts[unit.type] ?? 0) + 1;
  }
  return counts;
}
