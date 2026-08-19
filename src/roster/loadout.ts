/**
 * Card loadouts — the Spell and Trap decks an army brings to battle.
 *
 * Cards are priced content: every spell and trap has a point cost on its
 * engine definition, drawn from the SAME budget as pieces. An army may bring
 * any allotment — all points on pieces, a card-heavy "caster" build, or
 * anything between. The only structural rules are: at most one copy of each
 * card, spells in the spell deck, traps in the trap deck, and the shared
 * budget respected (enforced by composition validation, like pieces).
 *
 * Pools are read from the live card registry (spells.ts), never from a
 * second hardcoded list.
 */

import { allSpellDefinitions, getSpellDefinition } from '../engine';
import type { SpellDefinition } from '../engine';
import { canAffordCard } from './roster';
import type { Roster, RosterError } from './types';

/** Every selectable Spell Card, in registry order. */
export function availableSpellCards(): SpellDefinition[] {
  return allSpellDefinitions().filter((definition) => !definition.isTrap);
}

/** Every selectable Trap Card, in registry order. */
export function availableTrapCards(): SpellDefinition[] {
  return allSpellDefinitions().filter((definition) => definition.isTrap === true);
}

const isKnownCard = (id: string): boolean => {
  try {
    getSpellDefinition(id);
    return true;
  } catch {
    return false;
  }
};

const isTrapCard = (id: string): boolean => isKnownCard(id) && getSpellDefinition(id).isTrap === true;

/**
 * Adds/removes a Spell Card. Removing is always allowed; adding is refused
 * (roster returned unchanged) when the card is unknown, a trap, a duplicate,
 * or beyond the remaining shared budget.
 */
export function toggleSpellCard(roster: Roster, id: string): Roster {
  if (roster.spellIds.includes(id)) {
    return { ...roster, spellIds: roster.spellIds.filter((existing) => existing !== id) };
  }
  if (!isKnownCard(id) || isTrapCard(id)) return roster;
  if (!canAffordCard(roster, id)) return roster;
  return { ...roster, spellIds: [...roster.spellIds, id] };
}

/** Adds/removes a Trap Card under the same shared-budget rules. */
export function toggleTrapCard(roster: Roster, id: string): Roster {
  if (roster.trapIds.includes(id)) {
    return { ...roster, trapIds: roster.trapIds.filter((existing) => existing !== id) };
  }
  if (!isTrapCard(id)) return roster;
  if (!canAffordCard(roster, id)) return roster;
  return { ...roster, trapIds: [...roster.trapIds, id] };
}

/**
 * Structural card problems (identity and deck membership). Budget problems
 * are composition's job — the shared pool is validated once, with pieces.
 */
export function validateLoadout(roster: Roster): RosterError[] {
  const errors: RosterError[] = [];

  const seen = new Set<string>();
  for (const id of [...roster.spellIds, ...roster.trapIds]) {
    if (!isKnownCard(id)) {
      errors.push({ code: 'invalid-card', message: `"${id}" is not a known card.` });
      continue;
    }
    if (seen.has(id)) {
      errors.push({ code: 'duplicate-card', message: `${getSpellDefinition(id).name} is selected twice.` });
    }
    seen.add(id);
  }
  for (const id of roster.spellIds) {
    if (isTrapCard(id)) {
      errors.push({
        code: 'invalid-card',
        message: `${getSpellDefinition(id).name} is a Trap Card, not a Spell.`,
      });
    }
  }
  for (const id of roster.trapIds) {
    if (isKnownCard(id) && !isTrapCard(id)) {
      errors.push({
        code: 'invalid-card',
        message: `${getSpellDefinition(id).name} is a Spell Card, not a Trap.`,
      });
    }
  }

  return errors;
}

export const isLoadoutComplete = (roster: Roster): boolean => validateLoadout(roster).length === 0;

/**
 * Upgrades an army saved before shared-budget cards existed: missing decks
 * become empty, unknown cards are dropped rather than crashing anything.
 * (Armies saved under the old free-card system may now be over budget —
 * composition validation reports that; the builder is the place to trim.)
 */
export function normalizeRoster(raw: Roster | (Omit<Roster, 'spellIds' | 'trapIds'> & Partial<Roster>)): Roster {
  const spellIds = (raw.spellIds ?? []).filter((id) => isKnownCard(id) && !isTrapCard(id));
  const trapIds = (raw.trapIds ?? []).filter((id) => isTrapCard(id));
  return { ...raw, spellIds, trapIds } as Roster;
}

/** The one book handed to the engine: this army's spells and traps together. */
export const loadoutCardIds = (roster: Roster): string[] => [
  ...roster.spellIds,
  ...roster.trapIds,
];
