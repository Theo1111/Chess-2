import { useEffect, useRef, useState } from 'react';
import { getSpellDefinition, type Color, type GameState } from '../engine';

/**
 * Card moments worth showing, derived from the game state alone.
 *
 * The engine never emits events, so this watches consecutive states and reads
 * off what happened between them. That keeps the animation layer honest: it
 * can only announce things the position itself already says, which is what
 * makes it safe for hidden information.
 *
 *  - `cast`    — a spell was played openly. It flips face up.
 *  - `set`     — a trap card was played. It goes face DOWN: which trap it is,
 *                and where, stays secret until it fires.
 *  - `trigger` — a hidden trap became `revealed` (it fired, or a Sonar scan
 *                exposed it). Only then does the card turn over.
 */
export interface CardActivation {
  /** Unique per occurrence, so React remounts (and replays) the animation. */
  readonly id: number;
  readonly kind: 'cast' | 'set' | 'trigger';
  /** The card, or null while it is still face down (a trap being set). */
  readonly spell: string | null;
  /** Who played it. */
  readonly color: Color;
  /**
   * The position as it stood the instant before. A spectacle that acts on the
   * board — Ruler's Authority tearing it apart — renders this, so the pieces
   * it destroys are still there to be destroyed.
   */
  readonly before: GameState;
}

/** How long each kind of moment holds the screen. Matches the CSS timings. */
export const ACTIVATION_MS: Readonly<Record<CardActivation['kind'], number>> = {
  cast: 2200,
  set: 1400,
  trigger: 2200,
};

/** Cards whose spectacle runs longer than the ordinary flip. */
const CARD_MS: Readonly<Record<string, number>> = {
  'rulers-authority': 4200,
};

/** How long this moment holds the screen. */
export const activationDuration = (activation: CardActivation): number =>
  (activation.spell !== null ? CARD_MS[activation.spell] : undefined) ??
  ACTIVATION_MS[activation.kind];

/**
 * What happened, card-wise, between two consecutive states. Pure and
 * exported so the hidden-information rules above can be tested directly.
 */
export function cardActivationsBetween(
  previous: GameState,
  next: GameState,
  nextId: () => number,
): CardActivation[] {
  const events: CardActivation[] = [];

  for (const entry of next.history.slice(previous.history.length)) {
    if (!entry.cast) continue;
    const trap = getSpellDefinition(entry.cast.spell).isTrap === true;
    events.push({
      id: nextId(),
      kind: trap ? 'set' : 'cast',
      spell: trap ? null : entry.cast.spell,
      color: entry.cast.color,
      before: previous,
    });
  }

  const wasHidden = new Set(
    previous.traps.filter((trap) => !trap.revealed).map((trap) => trap.id),
  );
  for (const trap of next.traps) {
    if (trap.revealed && wasHidden.has(trap.id)) {
      events.push({
        id: nextId(),
        kind: 'trigger',
        spell: trap.trap,
        color: trap.owner,
        before: previous,
      });
    }
  }

  return events;
}

/**
 * The card moment currently on screen, or null. Moments queue up and play one
 * at a time — a Sonar scan that exposes three traps shows all three in turn.
 */
export function useCardActivations(game: GameState): CardActivation | null {
  const previousRef = useRef<GameState | null>(null);
  const idRef = useRef(0);
  const [queue, setQueue] = useState<readonly CardActivation[]>([]);

  useEffect(() => {
    const previous = previousRef.current;
    previousRef.current = game;
    if (!previous || previous === game) return;
    // A new game (or a rewound log) has no moments to announce.
    if (game.history.length < previous.history.length) {
      setQueue([]);
      return;
    }
    const events = cardActivationsBetween(previous, game, () => ++idRef.current);
    if (events.length > 0) setQueue((current) => [...current, ...events]);
  }, [game]);

  const head = queue[0] ?? null;

  useEffect(() => {
    if (!head) return;
    const timer = window.setTimeout(
      () => setQueue((current) => current.slice(1)),
      activationDuration(head),
    );
    return () => window.clearTimeout(timer);
  }, [head]);

  return head;
}
