/**
 * The draft catalog.
 *
 * Everything here is derived from the piece registry — costs, classes, card
 * text and abilities all come from the piece definitions. Adding a Rook-class
 * piece later means registering it with `pieceClass: 'rook'`; the catalog, the
 * team builder and validation pick it up with no changes.
 */

import { allPieceDefinitions, getPieceDefinition, hasPieceDefinition } from '../engine';
import type { PieceClass, PieceDefinition, PieceType } from '../engine';

/** Default roster budget. The King is free and does not count against it. */
export const DEFAULT_ROSTER_BUDGET = 42;

/** The piece every army must field, outside the budget. */
export const MANDATORY_PIECE: PieceType = 'king';

/** Classes offered in the builder, in display order. Grows in later batches. */
export const AVAILABLE_CLASSES: readonly PieceClass[] = ['queen', 'rook', 'knight', 'bishop', 'pawn'];

export const CLASS_LABELS: Readonly<Record<PieceClass, string>> = {
  king: 'King-Class',
  queen: 'Queen-Class',
  rook: 'Rook-Class',
  bishop: 'Bishop-Class',
  knight: 'Knight-Class',
  pawn: 'Pawn-Class',
};

/** True if a piece can be bought with roster points. */
export const isDraftable = (definition: PieceDefinition): boolean =>
  definition.pieceClass !== undefined &&
  definition.cost !== undefined &&
  !definition.royal &&
  AVAILABLE_CLASSES.includes(definition.pieceClass);

/** Every piece a player may currently buy, cheapest name-sorted first. */
export function draftablePieces(): PieceDefinition[] {
  return allPieceDefinitions()
    .filter(isDraftable)
    .sort((a, b) => (a.cost ?? 0) - (b.cost ?? 0) || a.name.localeCompare(b.name));
}

export function draftablePiecesByClass(pieceClass: PieceClass): PieceDefinition[] {
  return draftablePieces().filter((definition) => definition.pieceClass === pieceClass);
}

/** Roster cost of a piece type. Unknown or free pieces cost nothing. */
export const costOf = (type: PieceType): number =>
  hasPieceDefinition(type) ? (getPieceDefinition(type).cost ?? 0) : 0;
