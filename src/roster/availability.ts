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

import type { PieceType } from '../engine';

export interface ContentFlags {
  /** Piece types an admin has switched off. */
  readonly disabledPieces: ReadonlySet<string>;
  /** Spell/trap card ids an admin has switched off. */
  readonly disabledCards: ReadonlySet<string>;
}

const NOTHING_DISABLED: ContentFlags = {
  disabledPieces: new Set<string>(),
  disabledCards: new Set<string>(),
};

let current: ContentFlags = NOTHING_DISABLED;
const listeners = new Set<() => void>();

/** The live config. Stable by reference until it actually changes. */
export const contentFlags = (): ContentFlags => current;

/** Replaces the config and notifies subscribers. */
export function setContentFlags(next: {
  readonly pieces?: Iterable<string>;
  readonly cards?: Iterable<string>;
}): void {
  const disabledPieces = new Set(next.pieces ?? []);
  const disabledCards = new Set(next.cards ?? []);
  current =
    disabledPieces.size === 0 && disabledCards.size === 0
      ? NOTHING_DISABLED
      : { disabledPieces, disabledCards };
  for (const listener of listeners) listener();
}

/** Back to the shipped default: everything available. */
export const resetContentFlags = (): void => setContentFlags({});

export function subscribeToContentFlags(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export const isPieceEnabled = (type: PieceType): boolean => !current.disabledPieces.has(type);

export const isCardEnabled = (id: string): boolean => !current.disabledCards.has(id);
