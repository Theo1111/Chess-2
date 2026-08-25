/**
 * Roster validation.
 *
 * The engine validates rosters itself — the UI's restrictions are a
 * convenience, never the source of truth. Anything that reaches
 * `createGameFromRosters` is checked again before a board is built.
 */

import {
  getPieceDefinition,
  getSpellDefinition,
  hasPieceDefinition,
  squareName,
  type Square,
} from '../engine';
import { isCardOffered, isPieceEnabled } from './availability';
import { MANDATORY_PIECE, isDraftable } from './catalog';
import { validateLoadout } from './loadout';
import { isMandatory, isStartingSquare, rosterCost, startingSquares } from './roster';
import type { Roster, RosterError, RosterValidation } from './types';

export interface ValidateOptions {
  /** Also check that every unit has a legal, unique starting square. */
  readonly requirePlacement?: boolean;
  /** Also require complete 5/5 Spell and 5/5 Trap decks. */
  readonly requireLoadout?: boolean;
  /** Also reject content an admin has switched off (a builder-time rule). */
  readonly requireAvailable?: boolean;
}

/** Checks the army itself: legal pieces, a King, and within budget. */
export function validateComposition(roster: Roster): RosterError[] {
  const errors: RosterError[] = [];
  const seenIds = new Set<string>();
  let kings = 0;
  let others = 0;

  for (const unit of roster.units) {
    if (seenIds.has(unit.id)) {
      errors.push({
        code: 'duplicate-unit-id',
        message: `Duplicate unit id "${unit.id}".`,
        unitId: unit.id,
      });
    }
    seenIds.add(unit.id);

    if (!hasPieceDefinition(unit.type)) {
      errors.push({
        code: 'unknown-piece',
        message: `"${unit.type}" is not a known piece.`,
        unitId: unit.id,
      });
      continue;
    }

    const definition = getPieceDefinition(unit.type);
    if (unit.type === MANDATORY_PIECE) {
      kings++;
      continue;
    }
    if (!isDraftable(definition)) {
      errors.push({
        code: 'not-draftable',
        message: `${definition.name} cannot be drafted.`,
        unitId: unit.id,
      });
      continue;
    }
    others++;
  }

  if (kings === 0) errors.push({ code: 'missing-king', message: 'Every army must include a King.' });
  if (kings > 1) errors.push({ code: 'too-many-kings', message: 'An army may only have one King.' });
  if (others === 0) {
    errors.push({ code: 'no-units', message: 'Add at least one piece besides the King.' });
  }

  // Reachable since 1-point pieces: the budget can buy more units than the
  // two deployment ranks can physically hold.
  const capacity = startingSquares(roster.color).length;
  if (roster.units.length > capacity) {
    errors.push({
      code: 'too-many-units',
      message: `An army fields at most ${capacity} pieces (including the King) — remove ${roster.units.length - capacity}.`,
    });
  }

  // Pieces AND cards drain the same pool.
  const cost = rosterCost(roster);
  if (cost > roster.budget) {
    errors.push({
      code: 'over-budget',
      message: `Army costs ${cost} points (pieces and cards); the budget is ${roster.budget}.`,
    });
  }

  return errors;
}

/** Checks deployment: every unit on its own two ranks, one per square. */
export function validatePlacement(roster: Roster): RosterError[] {
  const errors: RosterError[] = [];
  const occupied = new Map<Square, string>();

  for (const unit of roster.units) {
    const square = roster.placement[unit.id];
    if (square === undefined) {
      errors.push({
        code: 'unplaced-unit',
        message: `${getPieceDefinition(unit.type).name} has not been placed.`,
        unitId: unit.id,
      });
      continue;
    }

    if (!isStartingSquare(roster.color, square)) {
      errors.push({
        code: 'square-outside-zone',
        message: `${squareName(square)} is outside your deployment zone.`,
        unitId: unit.id,
        square,
      });
      continue;
    }

    const taken = occupied.get(square);
    if (taken) {
      errors.push({
        code: 'placement-collision',
        message: `Two pieces are placed on ${squareName(square)}.`,
        unitId: unit.id,
        square,
      });
      continue;
    }
    occupied.set(square, unit.id);
  }

  // Placements referring to units that are no longer in the army.
  const unitIds = new Set(roster.units.map((unit) => unit.id));
  for (const id of Object.keys(roster.placement)) {
    if (!unitIds.has(id)) {
      errors.push({ code: 'unknown-piece', message: `Placement for unknown unit "${id}".`, unitId: id });
    }
  }

  return errors;
}

/**
 * Content an admin has taken out of circulation. Kept apart from
 * `validateComposition` on purpose: availability is a rule about what may be
 * DRAFTED today, not about whether an army is structurally legal, so an army
 * saved (or a game recorded) before a piece was switched off still validates
 * everywhere else in the app.
 */
export function validateAvailability(roster: Roster): RosterError[] {
  const errors: RosterError[] = [];

  const reported = new Set<string>();
  for (const unit of roster.units) {
    if (unit.type === MANDATORY_PIECE || isPieceEnabled(unit.type)) continue;
    if (reported.has(unit.type)) continue;
    reported.add(unit.type);
    const name = hasPieceDefinition(unit.type) ? getPieceDefinition(unit.type).name : unit.type;
    errors.push({
      code: 'piece-unavailable',
      message: `${name} is not available right now — remove it.`,
      unitId: unit.id,
    });
  }

  for (const id of [...roster.spellIds, ...roster.trapIds]) {
    if (isCardOffered(id)) continue;
    let name = id;
    try {
      name = getSpellDefinition(id).name;
    } catch {
      /* unknown ids are validateLoadout's problem, not this one */
    }
    errors.push({ code: 'card-unavailable', message: `${name} is not available right now — remove it.` });
  }

  return errors;
}

export function validateRoster(roster: Roster, options: ValidateOptions = {}): RosterValidation {
  const errors = [
    ...validateComposition(roster),
    ...(options.requireAvailable ? validateAvailability(roster) : []),
    ...(options.requirePlacement ? validatePlacement(roster) : []),
    ...(options.requireLoadout ? validateLoadout(roster) : []),
  ];
  return { valid: errors.length === 0, errors };
}

/** True if the army is legal, fully carded and completely deployed. */
export const isReadyToPlay = (roster: Roster): boolean =>
  validateRoster(roster, { requirePlacement: true, requireLoadout: true }).valid;

/** True if the army is legal to take into placement. */
export const isCompositionLegal = (roster: Roster): boolean => validateComposition(roster).length === 0;

/** Handy for tests and error reporting. */
export const describeErrors = (errors: readonly RosterError[]): string =>
  errors.map((error) => error.message).join(' ');

export { isMandatory };
