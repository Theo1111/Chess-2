/**
 * Roster operations — pure functions over a `Roster`, mirroring how the engine
 * treats game state: nothing mutates, everything returns a new value.
 */

import { RANK_COUNT, makeSquare, rankOf, type Color, type PieceType, type Square } from '../engine';
import { MANDATORY_PIECE, costOf } from './catalog';
import type { Roster, RosterUnit } from './types';

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

/** A fresh roster containing only the mandatory (free) King. */
export function createRoster(color: Color, budget: number): Roster {
  return {
    color,
    budget,
    units: [{ id: `${MANDATORY_PIECE}-1`, type: MANDATORY_PIECE }],
    placement: {},
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

export const rosterCost = (roster: Roster): number =>
  roster.units.reduce((total, unit) => total + costOf(unit.type), 0);

export const remainingBudget = (roster: Roster): number => roster.budget - rosterCost(roster);

/** True if the roster has both the points and a deployment square left. */
export const canAfford = (roster: Roster, type: PieceType): boolean =>
  costOf(type) <= remainingBudget(roster) &&
  roster.units.length < startingSquares(roster.color).length;

/** Units still waiting for a square, in purchase order. */
export const unplacedUnits = (roster: Roster): RosterUnit[] =>
  roster.units.filter((unit) => roster.placement[unit.id] === undefined);

export const unitAt = (roster: Roster, square: Square): RosterUnit | null =>
  roster.units.find((unit) => roster.placement[unit.id] === square) ?? null;

/** Places a unit, evicting whatever already stood there. */
export function placeUnit(roster: Roster, unitId: string, square: Square): Roster {
  const placement: Record<string, Square> = {};
  for (const [id, value] of Object.entries(roster.placement)) {
    if (value !== square && id !== unitId) placement[id] = value;
  }
  placement[unitId] = square;
  return { ...roster, placement };
}

export function unplaceUnit(roster: Roster, unitId: string): Roster {
  const placement = { ...roster.placement };
  delete placement[unitId];
  return { ...roster, placement };
}

export function clearPlacement(roster: Roster): Roster {
  return { ...roster, placement: {} };
}

/** Fills any empty starting squares in order — the builder's "auto-place". */
export function autoPlace(roster: Roster): Roster {
  const free = startingSquares(roster.color).filter((square) => unitAt(roster, square) === null);
  let next = roster;
  let index = 0;
  for (const unit of unplacedUnits(roster)) {
    const square = free[index++];
    if (square === undefined) break;
    next = placeUnit(next, unit.id, square);
  }
  return next;
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
