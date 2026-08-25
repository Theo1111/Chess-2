/**
 * Roster operations — pure functions over a `Roster`, mirroring how the engine
 * treats game state: nothing mutates, everything returns a new value.
 */

import {
  CASTLING_RULES,
  RANK_COUNT,
  makeSquare,
  rankOf,
  type Color,
  type PieceType,
  type Square,
} from '../engine';
import { MANDATORY_PIECE, costOf, costOfCard } from './catalog';
import type { Roster, RosterUnit } from './types';

/**
 * The square the King must hold: its traditional home in the middle of the
 * back rank (e1 / e9). Everything else about an army is the player's choice,
 * but the crown keeps its seat — which is also what makes castling possible,
 * since this is the square the castling rules expect a King to stand on.
 */
export const throneSquare = (color: Color): Square => CASTLING_RULES[color][0]!.kingFrom;

/** True if this unit is the King and therefore bound to the throne. */
export const holdsThrone = (roster: Roster, unitId: string): boolean =>
  roster.units.some((unit) => unit.id === unitId && isMandatory(unit));

/** The two ranks a colour may deploy onto. */
export function startingRanks(color: Color): readonly number[] {
  return color === 'white' ? [0, 1] : [RANK_COUNT - 2, RANK_COUNT - 1];
}

export function isStartingSquare(color: Color, square: Square): boolean {
  return startingRanks(color).includes(rankOf(square));
}

/** Every square a colour may deploy onto, ordered back rank first. */
export function startingSquares(color: Color): Square[] {
  const squares: Square[] = [];
  for (const rank of startingRanks(color)) {
    for (let file = 0; file < RANK_COUNT; file++) squares.push(makeSquare(file, rank));
  }
  return squares;
}

/** Deterministic unit id — no randomness, so rosters serialize predictably. */
function nextUnitId(units: readonly RosterUnit[], type: PieceType): string {
  let index = 1;
  const taken = new Set(units.map((unit) => unit.id));
  while (taken.has(`${type}-${index}`)) index++;
  return `${type}-${index}`;
}

/** A fresh roster containing only the mandatory (free) King, already enthroned. */
export function createRoster(color: Color, budget: number): Roster {
  return {
    color,
    budget,
    units: [{ id: `${MANDATORY_PIECE}-1`, type: MANDATORY_PIECE }],
    placement: { [`${MANDATORY_PIECE}-1`]: throneSquare(color) },
    spellIds: [],
    trapIds: [],
  };
}

export function addUnit(roster: Roster, type: PieceType): Roster {
  return {
    ...roster,
    units: [...roster.units, { id: nextUnitId(roster.units, type), type }],
  };
}

export function removeUnit(roster: Roster, unitId: string): Roster {
  const placement = { ...roster.placement };
  delete placement[unitId];
  return {
    ...roster,
    units: roster.units.filter((unit) => unit.id !== unitId),
    placement,
  };
}

/** Removes the last-added unit of a type — what the builder's "−" button does. */
export function removeLastUnitOfType(roster: Roster, type: PieceType): Roster {
  const last = [...roster.units].reverse().find((unit) => unit.type === type && !isMandatory(unit));
  return last ? removeUnit(roster, last.id) : roster;
}

export const isMandatory = (unit: RosterUnit): boolean => unit.type === MANDATORY_PIECE;

/** Points spent on pieces alone. */
export const unitCost = (roster: Roster): number =>
  roster.units.reduce((total, unit) => total + costOf(unit.type), 0);

/** Points spent on the card decks alone. */
export const cardCost = (roster: Roster): number =>
  [...roster.spellIds, ...roster.trapIds].reduce((total, id) => total + costOfCard(id), 0);

/** Total points spent: pieces AND cards share the one budget. */
export const rosterCost = (roster: Roster): number => unitCost(roster) + cardCost(roster);

export const remainingBudget = (roster: Roster): number => roster.budget - rosterCost(roster);

/** True if the roster has both the points and a deployment square left. */
export const canAfford = (roster: Roster, type: PieceType): boolean =>
  costOf(type) <= remainingBudget(roster) &&
  roster.units.length < startingSquares(roster.color).length;

/** True if the card fits the remaining budget (or is already selected). */
export const canAffordCard = (roster: Roster, id: string): boolean =>
  costOfCard(id) <= remainingBudget(roster);

/** Units still waiting for a square, in purchase order. */
export const unplacedUnits = (roster: Roster): RosterUnit[] =>
  roster.units.filter((unit) => roster.placement[unit.id] === undefined);

export const unitAt = (roster: Roster, square: Square): RosterUnit | null =>
  roster.units.find((unit) => roster.placement[unit.id] === square) ?? null;

/**
 * Places a unit, evicting whatever already stood there. The King is the one
 * fixed point: it cannot be moved off its throne, and nothing else may take
 * that square from it.
 */
export function placeUnit(roster: Roster, unitId: string, square: Square): Roster {
  const throne = throneSquare(roster.color);
  // The King is already where it must be, and the throne is not on offer.
  if (holdsThrone(roster, unitId)) return roster;
  if (square === throne && enthronedId(roster) !== null) return roster;

  const placement: Record<string, Square> = {};
  for (const [id, value] of Object.entries(roster.placement)) {
    if (value !== square && id !== unitId) placement[id] = value;
  }
  placement[unitId] = square;
  return { ...roster, placement };
}

/** The King's unit id, if the army has one. */
const enthronedId = (roster: Roster): string | null =>
  roster.units.find(isMandatory)?.id ?? null;

/** Returns a unit to the tray. The King never leaves the board. */
export function unplaceUnit(roster: Roster, unitId: string): Roster {
  if (holdsThrone(roster, unitId)) return roster;
  const placement = { ...roster.placement };
  delete placement[unitId];
  return { ...roster, placement };
}

/** Clears the board back to the King alone, still on its throne. */
export function clearPlacement(roster: Roster): Roster {
  const king = enthronedId(roster);
  return {
    ...roster,
    placement: king === null ? {} : { [king]: throneSquare(roster.color) },
  };
}

/** Fills any empty starting squares in order — the builder's "auto-place". */
export function autoPlace(roster: Roster): Roster {
  // The King first, so an army restored from before this rule (or mirrored
  // from a stray placement) is put right rather than left illegal.
  let next = enthroneKing(roster);
  const free = startingSquares(next.color).filter((square) => unitAt(next, square) === null);
  let index = 0;
  for (const unit of unplacedUnits(next)) {
    const square = free[index++];
    if (square === undefined) break;
    next = placeUnit(next, unit.id, square);
  }
  return next;
}

/**
 * Puts the King on its throne, moving aside whatever was standing there.
 * Armies drafted before the rule existed pass through here on their way to
 * the board.
 */
export function enthroneKing(roster: Roster): Roster {
  const king = enthronedId(roster);
  if (king === null) return roster;
  const throne = throneSquare(roster.color);
  if (roster.placement[king] === throne) return roster;

  const placement: Record<string, Square> = {};
  for (const [id, value] of Object.entries(roster.placement)) {
    // Whoever held the throne is evicted to the tray; there is room, because
    // the King itself has just left wherever it was.
    if (id !== king && value !== throne) placement[id] = value;
  }
  placement[king] = throne;
  return { ...roster, placement };
}

/**
 * Copies an army to the other colour, mirroring the placement across the board
 * so both players start from the same shape.
 */
export function mirrorRoster(roster: Roster, color: Color): Roster {
  const placement: Record<string, Square> = {};
  for (const [id, square] of Object.entries(roster.placement)) {
    const rank = RANK_COUNT - 1 - rankOf(square);
    placement[id] = makeSquare(square % RANK_COUNT, rank);
  }
  return {
    color,
    budget: roster.budget,
    units: roster.units.map((unit) => ({ ...unit })),
    placement,
    spellIds: [...roster.spellIds],
    trapIds: [...roster.trapIds],
  };
}
