/**
 * Capture permissions — the one place that answers "may this piece capture
 * that piece?" beyond geometry.
 *
 * Consulted by every capture producer: the pattern walker's visitor in move
 * generation (all standard, sliding, hopping and forced-run captures), the
 * Battering Ram's crush and the Ambusher's reaction. Immunities are data on
 * the piece definitions:
 *
 *   no-capture-class       — the attacker refuses a class of targets (Monk).
 *   uncapturable-by-class  — the target ignores a class of attackers (Monk).
 *   shielded-from-front    — the target ignores attackers that start on a
 *                            row in front of it (Shieldmaiden).
 */

import { rankOf } from './board';
import { isShielded } from './effects';
import { getPieceDefinition } from './pieces';
import type { PieceClass } from './pieces';
import type { GameState, Piece, PieceType, Square } from './types';

/** Roster class of a piece type, if it has one. */
export const classOfPiece = (type: PieceType): PieceClass | undefined =>
  getPieceDefinition(type).pieceClass;

/**
 * True if `attacker`, starting on `from`, is allowed to capture (or destroy)
 * `target` standing on `targetSquare`. Geometry is assumed to already hold —
 * this is purely the permission layer. Friendly "captures" (Berserker, Ram)
 * are always permitted: immunities guard against enemies.
 */
export function captureAllowed(
  state: GameState,
  attacker: Piece,
  from: Square,
  target: Piece,
  targetSquare: Square,
): boolean {
  if (attacker.color === target.color) return true;

  // A Shield spell bars every hostile capture — normal, special, crush or
  // stab — until it expires.
  if (state.effects.length > 0 && isShielded(state.effects, target.id)) return false;

  const attackerDef = getPieceDefinition(attacker.type);
  const targetDef = getPieceDefinition(target.type);
  const targetClass = classOfPiece(target.type);
  const attackerClass = classOfPiece(attacker.type);

  for (const ability of attackerDef.abilities ?? []) {
    if (ability.kind === 'no-capture-class' && ability.pieceClass === targetClass) return false;
  }

  for (const ability of targetDef.abilities ?? []) {
    if (ability.kind === 'uncapturable-by-class' && ability.pieceClass === attackerClass) {
      return false;
    }
    if (ability.kind === 'shielded-from-front') {
      // "In front" is relative to the target's owner: the rows its shield
      // faces — toward the enemy side.
      const attackerRank = rankOf(from);
      const targetRank = rankOf(targetSquare);
      const inFront =
        target.color === 'white' ? attackerRank > targetRank : attackerRank < targetRank;
      if (inFront) return false;
    }
  }

  return true;
}
