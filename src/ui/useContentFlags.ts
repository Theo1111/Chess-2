import { useEffect, useSyncExternalStore } from 'react';
import {
  contentFlags,
  setContentFlags,
  setSecretsUnlocked,
  subscribeToContentFlags,
  type ContentFlags,
} from '../roster';
import { fetchDisabledContent } from '../cloud/content';

/**
 * React's view of the published content config.
 *
 * The config itself lives in the roster layer (`availability.ts`) because the
 * catalog is what consults it; this is only the subscription that makes a
 * change re-render the builder. Components that list content should use the
 * returned snapshot as a memo dependency so their pools rebuild when an admin
 * switches something on or off.
 */
export function useContentFlags(): ContentFlags {
  return useSyncExternalStore(subscribeToContentFlags, contentFlags, contentFlags);
}

/**
 * Loads the config once at startup, and keeps the secret catalog in step with
 * who is signed in. Called by the app root, so a game started without ever
 * opening the menu still respects both. A failed load leaves the shipped
 * catalog in place — see `fetchDisabledContent`.
 */
export function useContentFlagSync(isAdmin: boolean): void {
  useEffect(() => {
    setSecretsUnlocked(isAdmin);
  }, [isAdmin]);

  useEffect(() => {
    let cancelled = false;
    void fetchDisabledContent().then((result) => {
      if (cancelled) return;
      if (result.error) {
        console.warn('content config unavailable:', result.error);
        return;
      }
      setContentFlags({ pieces: result.pieces, cards: result.cards });
    });
    return () => {
      cancelled = true;
    };
  }, []);
}
