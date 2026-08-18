/**
 * Ability descriptors.
 *
 * Abilities are *data* attached to a piece definition, not code scattered
 * through the engine. Each kind is interpreted in exactly one place:
 *
 *   grant-patterns              → auras.ts        (Archbishop, General)
 *   immobilize-adjacent-enemies → auras.ts        (Trapper)
 *   hit-points                  → setup + apply.ts (Champion)
 *   inherit-lost-patterns       → pieces.ts hook  (Avenger)
 *   extra-move                  → game.ts phases  (Duelist)
 *   return-reserve-on-move      → moveGeneration  (Chariot)
 *   defect-on-back-rank         → moveGeneration  (Revolutionary)
 *   convert-jumped-enemies      → moveGeneration  (Diplomat)
 *   no-consecutive-moves        → moveGeneration  (Warrior)
 *   transform-on-capture        → apply.ts        (Jester)
 *   ambush-passers              → game.ts + piece hook (Ambusher)
 *   win-on-back-rank            → game.ts         (Assassin)
 *   no-capture-class            → captureRules.ts (Monk)
 *   uncapturable-by-class       → captureRules.ts (Monk)
 *   shielded-from-front         → captureRules.ts (Shieldmaiden)
 *
 * Adding a new ability means adding a variant here and handling it in the one
 * module that owns that phase of the rules.
 */

import type { MovementPattern, PieceClass } from './pieces';
import type { PieceType } from './types';

/** Who an aura's granted movement applies to. */
export type GrantScope = 'diagonally-adjacent-allies' | 'all-allies';

export type PieceAbility =
  /** Give other friendly pieces extra movement patterns. */
  | { readonly kind: 'grant-patterns'; readonly scope: GrantScope; readonly patterns: readonly MovementPattern[] }
  /** Adjacent enemy pieces of a different type cannot move or capture. */
  | { readonly kind: 'immobilize-adjacent-enemies' }
  /** Survives (value - 1) captures, destroying the attacker each time. */
  | { readonly kind: 'hit-points'; readonly value: number }
  /** Moves like every friendly piece type lost so far this game. */
  | { readonly kind: 'inherit-lost-patterns' }
  /** Grants its owner an optional free move after their main move. */
  | { readonly kind: 'extra-move' }
  /** May return a reserve piece of this type to the square it vacated. */
  | { readonly kind: 'return-reserve-on-move'; readonly pieceType: PieceType }
  /** On reaching the far back rank, may sacrifice itself to swap armies. */
  | { readonly kind: 'defect-on-back-rank' }
  /** Enemy pieces jumped over change allegiance. */
  | { readonly kind: 'convert-jumped-enemies' }
  /** Cannot move on two consecutive turns of its owner. */
  | { readonly kind: 'no-consecutive-moves' }
  /** Becomes the type of every enemy piece it captures (Jester). */
  | { readonly kind: 'transform-on-capture' }
  /** May capture enemies that just passed through its guard zone (Ambusher). */
  | { readonly kind: 'ambush-passers' }
  /** Its owner instantly wins when it reaches the far back rank (Assassin). */
  | { readonly kind: 'win-on-back-rank' }
  /** May not capture pieces of the given roster class (Monk vs Pawns). */
  | { readonly kind: 'no-capture-class'; readonly pieceClass: PieceClass }
  /** Cannot be captured by pieces of the given roster class (Monk vs Pawns). */
  | { readonly kind: 'uncapturable-by-class'; readonly pieceClass: PieceClass }
  /** Cannot be captured by enemies starting on a row in front of it (Shieldmaiden). */
  | { readonly kind: 'shielded-from-front' };

export type AbilityKind = PieceAbility['kind'];

/** Narrow lookup: returns the ability of the given kind, if the piece has it. */
export function findAbility<K extends AbilityKind>(
  abilities: readonly PieceAbility[] | undefined,
  kind: K,
): Extract<PieceAbility, { kind: K }> | undefined {
  return abilities?.find((ability): ability is Extract<PieceAbility, { kind: K }> => ability.kind === kind);
}

export const hasAbility = (abilities: readonly PieceAbility[] | undefined, kind: AbilityKind): boolean =>
  Boolean(abilities?.some((ability) => ability.kind === kind));

/** Abilities that change what *other* pieces can do, so need an aura pass. */
const AURA_KINDS: readonly AbilityKind[] = ['grant-patterns', 'immobilize-adjacent-enemies'];

export const hasAuraAbility = (abilities: readonly PieceAbility[] | undefined): boolean =>
  Boolean(abilities?.some((ability) => AURA_KINDS.includes(ability.kind)));
