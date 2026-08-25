/**
 * Which content the draft currently offers.
 *
 * The game ships with every piece and card available; an admin may take some
 * out of circulation (see `supabase/admin.sql` and the Admin dashboard). The
 * published config is a small set of *disabled* ids that the app loads once
 * at startup and keeps here, so the catalog has exactly one place to ask.
 *
 * This is a content-availability layer, NOT a rule: the engine never sees it.
 * A game already under way — or a match being replayed from history — is
 * unaffected by a piece being switched off, because nothing in `src/engine`
 * imports this module.
 *
 * Framework-free with a subscription so React can mirror it through
 * `useSyncExternalStore` without the roster layer importing React.
 */

import { getSpellDefinition, type PieceType } from '../engine';

export interface ContentFlags {
  /** Piece types an admin has switched off. */
  readonly disabledPieces: ReadonlySet<string>;
  /** Spell/trap card ids an admin has switched off. */
  readonly disabledCards: ReadonlySet<string>;
  /**
   * Whether this client may draft `secret` cards. Set from the signed-in
   * account's admin grant — a convenience, not a security boundary: the
   * server checks the same thing when an online army is submitted.
   */
  readonly secretsUnlocked: boolean;
}

const NOTHING_DISABLED: ContentFlags = {
  disabledPieces: new Set<string>(),
  disabledCards: new Set<string>(),
  secretsUnlocked: false,
};

let current: ContentFlags = NOTHING_DISABLED;
const listeners = new Set<() => void>();

/** The live config. Stable by reference until it actually changes. */
export const contentFlags = (): ContentFlags => current;

/** Replaces the disabled sets and notifies subscribers. */
export function setContentFlags(next: {
  readonly pieces?: Iterable<string>;
  readonly cards?: Iterable<string>;
}): void {
  const disabledPieces = new Set(next.pieces ?? []);
  const disabledCards = new Set(next.cards ?? []);
  publish({ disabledPieces, disabledCards, secretsUnlocked: current.secretsUnlocked });
}

/** Opens (or closes) the secret catalog for this client. */
export function setSecretsUnlocked(unlocked: boolean): void {
  if (unlocked === current.secretsUnlocked) return;
  publish({ ...current, secretsUnlocked: unlocked });
}

function publish(next: ContentFlags): void {
  current =
    next.disabledPieces.size === 0 && next.disabledCards.size === 0 && !next.secretsUnlocked
      ? NOTHING_DISABLED
      : next;
  for (const listener of listeners) listener();
}

/** Back to the shipped default: the public catalog, nothing switched off. */
export function resetContentFlags(): void {
  publish({ ...NOTHING_DISABLED });
}

export function subscribeToContentFlags(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export const isPieceEnabled = (type: PieceType): boolean => !current.disabledPieces.has(type);

export const isCardEnabled = (id: string): boolean => !current.disabledCards.has(id);

/**
 * Whether the draft may offer this card at all: switched on by the admin
 * config, and not a secret this client has no business seeing.
 */
export function isCardOffered(id: string): boolean {
  if (!isCardEnabled(id)) return false;
  try {
    return getSpellDefinition(id).secret !== true || current.secretsUnlocked;
  } catch {
    return false; // an id no registry knows is not on offer either
  }
}
