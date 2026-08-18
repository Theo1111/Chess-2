/**
 * Legal army generation for simulations.
 *
 * Everything is drawn from the live registries — `draftablePieces()` for
 * units, `availableSpellCards()` / `availableTrapCards()` for decks — so a
 * newly registered piece or card is picked up with no changes here. All
 * validation is delegated to the roster module; this file only *chooses*,
 * it never re-implements legality.
 *
 * Generators return fully placed, fully carded WHITE rosters. Use
 * `mirrorRoster(army, 'black')` for the black copy of the same army, or
 * generate a second army for asymmetric matchups.
 */

import type { PieceClass, PieceType } from '../engine';
import {
  SPELL_LOADOUT_SIZE,
  TRAP_LOADOUT_SIZE,
  addUnit,
  availableSpellCards,
  availableTrapCards,
  canAfford,
  createRoster,
  describeErrors,
  draftablePieces,
  DEFAULT_ROSTER_BUDGET,
  isMandatory,
  placeUnit,
  removeUnit,
  startingSquares,
  toggleSpellCard,
  toggleTrapCard,
  validateRoster,
  type Roster,
} from '../roster';
import type { SeededRng } from '../sim/seededRandom';

export type ArmyMode =
  | { readonly kind: 'random' }
  | { readonly kind: 'class-heavy'; readonly pieceClass: PieceClass }
  | { readonly kind: 'piece-heavy'; readonly piece: PieceType }
  | { readonly kind: 'preset'; readonly pieces: readonly PieceType[] };

export interface ArmyOptions {
  readonly budget?: number;
  readonly mode?: ArmyMode;
}

/** Random 5+5 card decks from whatever the registry currently offers. */
function randomLoadout(roster: Roster, rng: SeededRng): Roster {
  let next = roster;
  for (const card of rng.shuffle(availableSpellCards()).slice(0, SPELL_LOADOUT_SIZE)) {
    next = toggleSpellCard(next, card.id);
  }
  for (const card of rng.shuffle(availableTrapCards()).slice(0, TRAP_LOADOUT_SIZE)) {
    next = toggleTrapCard(next, card.id);
  }
  return next;
}

/** Random legal deployment across the colour's two starting ranks. */
function randomPlacement(roster: Roster, rng: SeededRng): Roster {
  const squares = rng.shuffle(startingSquares(roster.color));
  let next = roster;
  roster.units.forEach((unit, index) => {
    next = placeUnit(next, unit.id, squares[index]!);
  });
  return next;
}

/** One weighted purchase pass; `preferred` biases but never forces overspend. */
function buyUnits(
  roster: Roster,
  rng: SeededRng,
  preferred: (type: PieceType) => boolean,
  preferenceStrength: number,
): Roster {
  const capacity = startingSquares(roster.color).length;
  let next = roster;
  for (;;) {
    if (next.units.length >= capacity) break;
    const affordable = draftablePieces().filter((piece) => canAfford(next, piece.type));
    if (affordable.length === 0) break;
    const favourites = affordable.filter((piece) => preferred(piece.type));
    const pool =
      favourites.length > 0 && rng.next() < preferenceStrength ? favourites : affordable;
    next = addUnit(next, rng.pick(pool).type);
  }
  return next;
}

/** A complete random legal army (placed, carded, validated). */
export function generateArmy(rng: SeededRng, options: ArmyOptions = {}): Roster {
  const budget = options.budget ?? DEFAULT_ROSTER_BUDGET;
  const mode = options.mode ?? { kind: 'random' };
  let roster = createRoster('white', budget);

  switch (mode.kind) {
    case 'random':
      roster = buyUnits(roster, rng, () => false, 0);
      break;
    case 'class-heavy':
      roster = buyUnits(
        roster,
        rng,
        (type) => draftablePieces().some((p) => p.type === type && p.pieceClass === mode.pieceClass),
        0.85,
      );
      break;
    case 'piece-heavy':
      roster = buyUnits(roster, rng, (type) => type === mode.piece, 0.85);
      break;
    case 'preset':
      for (const type of mode.pieces) roster = addUnit(roster, type);
      break;
  }

  roster = randomLoadout(randomPlacement(roster, rng), rng);
  assertValid(roster);
  return roster;
}

/**
 * Evolutionary step: drop one or two random purchases, refill randomly, and
 * reshuffle the freed squares. Cards survive unless the rng swaps one.
 */
export function mutateArmy(roster: Roster, rng: SeededRng): Roster {
  const removable = roster.units.filter((unit) => !isMandatory(unit));
  let next = roster;
  const removals = Math.min(removable.length, 1 + rng.int(2));
  for (const unit of rng.shuffle(removable).slice(0, removals)) {
    next = removeUnit(next, unit.id);
  }
  next = buyUnits(next, rng, () => false, 0);

  // Occasionally trade one spell for one outside the deck.
  if (rng.next() < 0.3) {
    const outside = availableSpellCards().filter((card) => !next.spellIds.includes(card.id));
    if (outside.length > 0 && next.spellIds.length > 0) {
      next = toggleSpellCard(next, rng.pick(next.spellIds));
      next = toggleSpellCard(next, rng.pick(outside).id);
    }
  }

  next = randomPlacement(next, rng);
  assertValid(next);
  return next;
}

function assertValid(roster: Roster): void {
  const result = validateRoster(roster, { requirePlacement: true, requireLoadout: true });
  if (!result.valid) {
    throw new Error(`Generated an invalid army: ${describeErrors(result.errors)}`);
  }
}
