import { useCallback, useState } from 'react';
import type { Color } from '../engine';
import {
  DEFAULT_ROSTER_BUDGET,
  createRoster,
  mirrorRoster,
  type Roster,
} from '../roster';
import { DEFAULT_TIME_CONTROL, type TimeControlId } from './timeControls';

/**
 * Top-level app flow:
 *
 *   menu → build (white) → place (white) → build (black) → place (black) → game
 *
 * Both players draft locally in sequence, so the flow walks through each
 * colour's build + place before starting. "Mirror" lets player two reuse
 * player one's army.
 */
export type AppScreen =
  | { kind: 'menu' }
  | { kind: 'build'; color: Color }
  | { kind: 'place'; color: Color }
  | { kind: 'game' }
  | { kind: 'history' }
  | { kind: 'online' }
  | { kind: 'admin' };

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
  /** Chosen on the menu, applied to whichever game is started next. */
  const [timeControl, setTimeControl] = useState<TimeControlId>(DEFAULT_TIME_CONTROL);

  const updateRoster = useCallback((color: Color, roster: Roster) => {
    setDraft((current) => ({ ...current, [color]: roster }));
  }, []);

  const startDraft = useCallback(() => {
    setDraft(freshDraft());
    setScreen({ kind: 'build', color: 'white' });
  }, []);

  const toPlacement = useCallback((color: Color) => setScreen({ kind: 'place', color }), []);

  const backToBuild = useCallback((color: Color) => setScreen({ kind: 'build', color }), []);

  /** After white places: black builds. After black places: the match begins. */
  const finishPlacement = useCallback((color: Color) => {
    if (color === 'white') setScreen({ kind: 'build', color: 'black' });
    else setScreen({ kind: 'game' });
  }, []);

  /** Black copies white's army, mirrored, and goes straight to placement review. */
  const mirrorFromWhite = useCallback(() => {
    setDraft((current) => ({ ...current, black: mirrorRoster(current.white, 'black') }));
    setScreen({ kind: 'place', color: 'black' });
  }, []);

  const toMenu = useCallback(() => setScreen({ kind: 'menu' }), []);

  const toHistory = useCallback(() => setScreen({ kind: 'history' }), []);

  const toOnline = useCallback(() => setScreen({ kind: 'online' }), []);

  const toAdmin = useCallback(() => setScreen({ kind: 'admin' }), []);

  return {
    screen,
    draft,
    timeControl,
    setTimeControl,
    updateRoster,
    startDraft,
    toPlacement,
    backToBuild,
    finishPlacement,
    mirrorFromWhite,
    toMenu,
    toHistory,
    toOnline,
    toAdmin,
  };
}

export type AppFlow = ReturnType<typeof useAppFlow>;
