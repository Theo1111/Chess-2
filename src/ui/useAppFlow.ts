import { useCallback, useState } from 'react';
import type { Color } from '../engine';
import {
  DEFAULT_ROSTER_BUDGET,
  createRoster,
  mirrorRoster,
  type Roster,
} from '../roster';

/**
 * Top-level app flow:
 *
 *   menu → build (white) → place (white) → build (black) → place (black) → game
 *   menu → classic game
 *
 * Both players draft locally in sequence, so the flow walks through each
 * colour's build + place before starting. "Mirror" lets player two reuse
 * player one's army.
 */
export type AppScreen =
  | { kind: 'menu' }
  | { kind: 'build'; color: Color }
  | { kind: 'place'; color: Color }
  | { kind: 'game'; mode: 'classic' | 'custom' };

export interface DraftState {
  readonly white: Roster;
  readonly black: Roster;
}

const freshDraft = (): DraftState => ({
  white: createRoster('white', DEFAULT_ROSTER_BUDGET),
  black: createRoster('black', DEFAULT_ROSTER_BUDGET),
});

export function useAppFlow() {
  const [screen, setScreen] = useState<AppScreen>({ kind: 'menu' });
  const [draft, setDraft] = useState<DraftState>(freshDraft);

  const updateRoster = useCallback((color: Color, roster: Roster) => {
    setDraft((current) => ({ ...current, [color]: roster }));
  }, []);

  const startClassic = useCallback(() => setScreen({ kind: 'game', mode: 'classic' }), []);

  const startDraft = useCallback(() => {
    setDraft(freshDraft());
    setScreen({ kind: 'build', color: 'white' });
  }, []);

  const toPlacement = useCallback((color: Color) => setScreen({ kind: 'place', color }), []);

  const backToBuild = useCallback((color: Color) => setScreen({ kind: 'build', color }), []);

  /** After white places: black builds. After black places: the match begins. */
  const finishPlacement = useCallback((color: Color) => {
    if (color === 'white') setScreen({ kind: 'build', color: 'black' });
    else setScreen({ kind: 'game', mode: 'custom' });
  }, []);

  /** Black copies white's army, mirrored, and goes straight to placement review. */
  const mirrorFromWhite = useCallback(() => {
    setDraft((current) => ({ ...current, black: mirrorRoster(current.white, 'black') }));
    setScreen({ kind: 'place', color: 'black' });
  }, []);

  const toMenu = useCallback(() => setScreen({ kind: 'menu' }), []);

  return {
    screen,
    draft,
    updateRoster,
    startClassic,
    startDraft,
    toPlacement,
    backToBuild,
    finishPlacement,
    mirrorFromWhite,
    toMenu,
  };
}

export type AppFlow = ReturnType<typeof useAppFlow>;
