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
  addUnit,
  availableSpellCards,
  availableTrapCards,
  canAfford,
  canAffordCard,
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

/**
 * Random card purchases under the SHARED budget: walk a shuffled card pool
 * and buy what fits, spending at most `maxPoints`. Card spending varies army
 * to army — exactly the selection variance the balance model needs to price
 * cards (the fixed 5+5 era left card coefficients unidentifiable).
 */
function buyCards(roster: Roster, rng: SeededRng, maxPoints: number): Roster {
  let next = roster;
  let spent = 0;
  const pool = rng.shuffle([...availableSpellCards(), ...availableTrapCards()]);
  for (const card of pool) {
    const price = card.cost ?? 0;
    if (spent + price > maxPoints) continue;
    if (!canAffordCard(next, card.id)) continue;
    const bought = card.isTrap ? toggleTrapCard(next, card.id) : toggleSpellCard(next, card.id);
    if (bought !== next) {
      next = bought;
      spent += price;
    }
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

  // Cards buy FIRST against a randomly sized reservation (0 to half the
  // budget) — piece-buying spends every remaining point, so buying cards
  // second would starve them to scraps. The spread from card-less to
  // card-heavy armies is deliberate.
  roster = buyCards(roster, rng, rng.int(Math.floor(budget / 2) + 1));

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

  // Soak leftovers: a capacity-capped army may still afford more cards.
  roster = buyCards(roster, rng, roster.budget);
  roster = randomPlacement(roster, rng);
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

  // Occasionally trade one spell for one outside the deck (budget allowing).
  if (rng.next() < 0.3) {
    const outside = availableSpellCards().filter((card) => !next.spellIds.includes(card.id));
    if (outside.length > 0 && next.spellIds.length > 0) {
      next = toggleSpellCard(next, rng.pick(next.spellIds));
      next = toggleSpellCard(next, rng.pick(outside).id);
    }
  }
  // Refill any freed points with cards, then pieces already happened above.
  next = buyCards(next, rng, next.budget);

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
