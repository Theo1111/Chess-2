/**
 * The AI-facing action layer.
 *
 * Chess 2 turns are richer than chess moves: a turn can be a piece move, a
 * spell cast, a trap placement, or a bonus-phase decision. This module
 * normalizes all of them into one `GameAction` union so agents, search and
 * the match runner can treat "things a player may do" uniformly.
 *
 * It is strictly an ADAPTER. Legality and resolution are delegated to the
 * engine that already runs the real game:
 *
 *   moves   → generateLegalMoves / applyMove
 *   spells  → canCastSpells / spellPrimaryTargets / spellSecondaryTargets /
 *             castSpell        (trap cards are spells with isTrap)
 *   pass    → skipBonusMove    (declining a Duelist / Royal Order bonus)
 *
 * Nothing in here re-implements a rule. If the engine and this module ever
 * disagree, the engine is right and the adapter has a bug.
 */

import {
  canCastSpells,
  castSpell,
  generateLegalMoves,
  getSpellDefinition,
  isGameOver,
  isRoyalAttacked,
  applyMove,
  skipBonusMove,
  spellPrimaryTargets,
  spellSecondaryTargets,
  visibleTraps,
  type Color,
  type GameState,
  type Move,
  type SpellDefinition,
  type SpellTargeting,
  type Square,
} from '../engine';

/** A piece move — wraps the engine's own legal `Move` object untouched. */
export interface PieceMoveAction {
  readonly kind: 'move';
  readonly move: Move;
}

/**
 * A card played from the hand — spell or trap alike (the engine models traps
 * as spells with `isTrap`, and so do we; `trap: true` is exposed for
 * telemetry so it never has to re-query the registry).
 */
export interface SpellAction {
  readonly kind: 'spell';
  readonly spell: string;
  readonly targets: readonly Square[];
  readonly trap: boolean;
}

/** Declining the optional bonus move (Duelist free move / Royal Order pawn). */
export interface PassAction {
  readonly kind: 'pass';
}

export type GameAction = PieceMoveAction | SpellAction | PassAction;

const targetStageCount = (targeting: SpellTargeting): 0 | 1 | 2 => {
  if (targeting === 'none') return 0;
  if (targeting === 'friendly-piece' || targeting === 'enemy-piece' || targeting === 'square') {
    return 1;
  }
  return 2;
};

/** Every legal way the side to move may spend this turn. [] iff terminal. */
export function generateLegalActions(state: GameState): GameAction[] {
  if (isGameOver(state)) return [];

  const actions: GameAction[] = [];

  for (const move of generateLegalMoves(state)) {
    actions.push({ kind: 'move', move });
  }

  // A bonus window is optional by definition — declining is always legal.
  if (state.phase === 'bonus') {
    actions.push({ kind: 'pass' });
    return actions;
  }

  if (canCastSpells(state, state.turn)) {
    for (const spell of state.spells[state.turn].available) {
      actions.push(...spellActions(state, state.turn, spell));
    }
  }

  return actions;
}

/** All legal target combinations for one card in the caster's hand. */
function spellActions(state: GameState, caster: Color, spell: string): SpellAction[] {
  let definition: SpellDefinition;
  try {
    definition = getSpellDefinition(spell);
  } catch {
    return []; // unknown card in a book — never a legal action
  }
  if (definition.castable && !definition.castable(state, caster)) return [];

  const stages = targetStageCount(definition.targeting);
  const trap = definition.isTrap === true;

  /**
   * `castSpell` ends with a king-safety gate: a cast may never leave the
   * caster's royal attacked (which is also how casting under check is forced
   * to answer it). Probe with the very same engine calls it makes — resolve
   * the definition, then ask `isRoyalAttacked` — so the action list matches
   * the engine exactly. The round-trip test in actions.test.ts guards this
   * from drifting if castSpell grows new checks.
   */
  const leavesRoyalAttacked = (targets: readonly Square[]): boolean => {
    if (spell === 'royal-order') {
      // Royal Order changes no board state at cast time.
      return isRoyalAttacked(state, caster);
    }
    const probe: GameState = { ...state, ...definition.resolve(state, caster, targets) };
    return isRoyalAttacked(probe, caster);
  };

  const actions: SpellAction[] = [];
  const offer = (targets: readonly Square[]) => {
    if (!leavesRoyalAttacked(targets)) actions.push({ kind: 'spell', spell, targets, trap });
  };

  if (stages === 0) {
    offer([]);
    return actions;
  }
  for (const first of spellPrimaryTargets(state, caster, spell)) {
    if (stages === 1) {
      offer([first]);
      continue;
    }
    for (const second of spellSecondaryTargets(state, caster, spell, first)) {
      offer([first, second]);
    }
  }
  return actions;
}

/**
 * Plays an action produced by `generateLegalActions` and returns the next
 * state. Throws on an action the engine rejects — that always indicates a bug
 * (a stale action applied to the wrong state), never a condition to swallow.
 */
export function applyGameAction(state: GameState, action: GameAction): GameState {
  switch (action.kind) {
    case 'move':
      return applyMove(state, action.move);
    case 'spell': {
      const next = castSpell(state, {
        spell: action.spell,
        color: state.turn,
        targets: action.targets,
      });
      if (!next) {
        throw new Error(
          `Illegal spell action: ${action.spell}→[${action.targets.join(',')}] for ${state.turn}`,
        );
      }
      return next;
    }
    case 'pass': {
      if (state.phase !== 'bonus') {
        throw new Error('Illegal pass: not in a bonus phase');
      }
      return skipBonusMove(state);
    }
  }
}

/**
 * Like `applyGameAction`, but returns null instead of throwing.
 *
 * For agents planning on an OBSERVATION: an action that is legal in the real
 * game can be un-resolvable in the observed one (Recon's castability reads
 * the size of the hidden enemy hand). Such actions stay playable — the agent
 * just cannot simulate their outcome and must score them another way.
 */
export function tryApplyGameAction(state: GameState, action: GameAction): GameState | null {
  try {
    return applyGameAction(state, action);
  } catch {
    return null;
  }
}

/** Stable identity for an action — set membership, dedup, logs, replays. */
export function actionKey(action: GameAction): string {
  switch (action.kind) {
    case 'move': {
      const m = action.move;
      return [
        'm',
        m.from,
        m.to,
        m.promotion ?? '',
        m.special ?? '',
        m.repelled ? 'r' : '',
        m.captured?.square ?? '',
        m.returns ? `ret${m.returns.type}` : '',
        m.bonus ? 'b' : '',
      ].join(':');
    }
    case 'spell':
      return `s:${action.spell}:${action.targets.join(',')}`;
    case 'pass':
      return 'p';
  }
}

/**
 * What `viewer` is allowed to know — the information boundary for agents.
 *
 * The full `GameState` contains hidden information: the opponent's unplayed
 * cards (until Reveal) and their unrevealed traps. Search bots must plan on
 * this observation, never the omniscient state, so they cannot cheat.
 *
 * The viewer's own action legality is identical in both states: hidden traps
 * change what happens AFTER a move resolves, never which moves exist, and the
 * opponent's hand never constrains the viewer's turn.
 *
 * Known limitation (documented, deliberate): pieces obscured by Smoke Screen
 * remain visible here. Redacting board squares would corrupt every legality
 * probe downstream (a hidden king breaks check detection). Smoke lives for
 * two rounds, so the leak is small; a future ISMCTS agent should sample
 * plausible boards instead of reading this one.
 */
export function getObservationForPlayer(state: GameState, viewer: Color): GameState {
  const enemy: Color = viewer === 'white' ? 'black' : 'white';
  const enemyBook = state.spells[enemy];

  return {
    ...state,
    // Every trap the viewer may see (their own + revealed ones); the rest gone.
    traps: visibleTraps(state, viewer),
    spells: {
      ...state.spells,
      [enemy]: enemyBook.revealed
        ? enemyBook
        : // Hidden hand: the observation says "no castable cards" rather than
          // leaking which five the opponent drafted. `used` is public history.
          { available: [], used: enemyBook.used, revealed: false },
    },
  };
}
