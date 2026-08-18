/**
 * Card loadouts — the Spell and Trap decks an army brings to battle.
 *
 * A standard army carries exactly five Spell Cards and five Trap Cards,
 * chosen in the Army Builder and saved with the roster. The two decks are
 * fully independent: selecting spells never consumes trap slots and vice
 * versa. The pools are read from the live card registry (spells.ts), never
 * from a second hardcoded list.
 */

import { allSpellDefinitions, getSpellDefinition } from '../engine';
import type { SpellDefinition } from '../engine';
import type { Roster, RosterError } from './types';

export const SPELL_LOADOUT_SIZE = 5;
export const TRAP_LOADOUT_SIZE = 5;

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
 * Adds/removes a Spell Card. Adding a sixth is refused (the roster is
 * returned unchanged) — the UI should offer removal instead.
 */
export function toggleSpellCard(roster: Roster, id: string): Roster {
  if (roster.spellIds.includes(id)) {
    return { ...roster, spellIds: roster.spellIds.filter((existing) => existing !== id) };
  }
  if (!isKnownCard(id) || isTrapCard(id)) return roster;
  if (roster.spellIds.length >= SPELL_LOADOUT_SIZE) return roster;
  return { ...roster, spellIds: [...roster.spellIds, id] };
}

/** Adds/removes a Trap Card, with its own independent five-card cap. */
export function toggleTrapCard(roster: Roster, id: string): Roster {
  if (roster.trapIds.includes(id)) {
    return { ...roster, trapIds: roster.trapIds.filter((existing) => existing !== id) };
  }
  if (!isTrapCard(id)) return roster;
  if (roster.trapIds.length >= TRAP_LOADOUT_SIZE) return roster;
  return { ...roster, trapIds: [...roster.trapIds, id] };
}

/** Loadout problems, phrased for the builder's feedback line. */
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

  const spellsMissing = SPELL_LOADOUT_SIZE - roster.spellIds.length;
  if (spellsMissing > 0) {
    errors.push({
      code: 'spells-incomplete',
      message: `Select ${spellsMissing} more Spell Card${spellsMissing === 1 ? '' : 's'} to complete this army.`,
    });
  }
  if (roster.spellIds.length > SPELL_LOADOUT_SIZE) {
    errors.push({ code: 'invalid-card', message: 'Too many Spell Cards selected.' });
  }

  const trapsMissing = TRAP_LOADOUT_SIZE - roster.trapIds.length;
  if (trapsMissing > 0) {
    errors.push({
      code: 'traps-incomplete',
      message: `Select ${trapsMissing} more Trap Card${trapsMissing === 1 ? '' : 's'} to complete this army.`,
    });
  }
  if (roster.trapIds.length > TRAP_LOADOUT_SIZE) {
    errors.push({ code: 'invalid-card', message: 'Too many Trap Cards selected.' });
  }

  return errors;
}

export const isLoadoutComplete = (roster: Roster): boolean => validateLoadout(roster).length === 0;

/**
 * Upgrades an army saved before card loadouts existed: missing decks become
 * empty (incomplete — the builder prompts for them), unknown cards are
 * dropped rather than crashing anything.
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
