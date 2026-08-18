import { describe, expect, it } from 'vitest';
import '../../engine/customPieces';
import '../../engine/rookPieces';
import '../../engine/knightPieces';
import '../../engine/bishopPieces';
import {
  applyMove,
  canCastSpells,
  castSpell,
  createStateFromFen,
  generateLegalMoves,
  isGameOver,
  toFen,
  type GameState,
} from '../../engine';
import { createRng } from '../../sim/seededRandom';
import {
  actionKey,
  applyGameAction,
  generateLegalActions,
  getObservationForPlayer,
} from '../actions';

const START = createStateFromFen();

/** A state where White has a Duelist bonus move available after moving it. */
function duelistBonusState(): GameState {
  const state = createStateFromFen('4k4/9/9/9/9/9/9/9/3DK4 w - - 0 1');
  const moves = generateLegalMoves(state).filter((move) => move.piece === 'duelist');
  expect(moves.length).toBeGreaterThan(0);
  const next = applyMove(state, moves[0]!);
  expect(next.phase).toBe('bonus');
  return next;
}

describe('generateLegalActions', () => {
  it('wraps every legal move exactly once and nothing else terminal', () => {
    const actions = generateLegalActions(START);
    const moveActions = actions.filter((action) => action.kind === 'move');
    const legal = generateLegalMoves(START);
    expect(moveActions.length).toBe(legal.length);

    const keys = new Set(actions.map(actionKey));
    expect(keys.size).toBe(actions.length); // no duplicates
  });

  it('offers spell actions the engine accepts, and only those', () => {
    // Every generated spell action must round-trip through castSpell.
    const actions = generateLegalActions(START).filter((action) => action.kind === 'spell');
    expect(actions.length).toBeGreaterThan(0);
    for (const action of actions.slice(0, 250)) {
      const next = castSpell(START, {
        spell: action.spell,
        color: START.turn,
        targets: action.targets,
      });
      expect(next, `${action.spell} [${action.targets.join(',')}]`).not.toBeNull();
    }
  });

  it('never offers spells when the engine forbids casting', () => {
    const noCards: GameState = {
      ...START,
      spells: {
        white: { available: [], used: [], revealed: false },
        black: { available: [], used: [], revealed: false },
      },
    };
    expect(canCastSpells(noCards, 'white')).toBe(false);
    expect(generateLegalActions(noCards).every((action) => action.kind === 'move')).toBe(true);
  });

  it('returns [] exactly when the game is over', () => {
    // Fool's-mate-like: fabricate a checkmated state via engine play is slow;
    // instead assert the invariant on a terminal status directly.
    const done: GameState = { ...START, status: 'checkmate', winner: 'black' };
    expect(isGameOver(done)).toBe(true);
    expect(generateLegalActions(done)).toEqual([]);
  });

  it('bonus phase offers the bonus moves plus pass, never spells', () => {
    const bonus = duelistBonusState();
    const actions = generateLegalActions(bonus);
    expect(actions.some((action) => action.kind === 'pass')).toBe(true);
    expect(actions.some((action) => action.kind === 'spell')).toBe(false);
    const moves = actions.filter((action) => action.kind === 'move');
    expect(moves.length).toBe(generateLegalMoves(bonus).length);
    expect(moves.every((action) => action.move.bonus)).toBe(true);
  });
});

describe('applyGameAction', () => {
  it('matches the engine exactly for moves', () => {
    for (const action of generateLegalActions(START).filter((a) => a.kind === 'move')) {
      const viaAction = applyGameAction(START, action);
      const viaEngine = applyMove(START, action.move);
      expect(toFen(viaAction)).toBe(toFen(viaEngine));
    }
  });

  it('applies spells through castSpell and consumes the card', () => {
    const action = generateLegalActions(START).find(
      (a) => a.kind === 'spell' && a.spell === 'reveal',
    );
    expect(action).toBeDefined();
    const next = applyGameAction(START, action!);
    expect(next.spells.white.used).toContain('reveal');
    expect(next.turn).toBe('black');
  });

  it('pass ends the bonus phase', () => {
    const bonus = duelistBonusState();
    const next = applyGameAction(bonus, { kind: 'pass' });
    expect(next.turn).toBe('black');
    expect(next.phase).toBe('main');
  });

  it('throws on illegal actions instead of corrupting state', () => {
    expect(() => applyGameAction(START, { kind: 'pass' })).toThrow();
    expect(() =>
      applyGameAction(START, { kind: 'spell', spell: 'no-such-card', targets: [], trap: false }),
    ).toThrow();
  });
});

describe('getObservationForPlayer', () => {
  it('hides the enemy hand until revealed, and keeps our own', () => {
    const observed = getObservationForPlayer(START, 'white');
    expect(observed.spells.black.available).toEqual([]);
    expect(observed.spells.white.available).toEqual(START.spells.white.available);

    const revealed: GameState = {
      ...START,
      spells: { ...START.spells, black: { ...START.spells.black, revealed: true } },
    };
    expect(getObservationForPlayer(revealed, 'white').spells.black.available).toEqual(
      START.spells.black.available,
    );
  });

  it('strips hidden enemy traps but keeps our own and revealed ones', () => {
    const trapped: GameState = {
      ...START,
      traps: [
        { id: 'a', trap: 'mine', owner: 'white', square: 40, revealed: false, armed: true },
        { id: 'b', trap: 'sonar', owner: 'black', square: 41, revealed: false, armed: true },
        { id: 'c', trap: 'tripwire', owner: 'black', square: 42, revealed: true, armed: true },
      ],
    };
    const ids = getObservationForPlayer(trapped, 'white').traps.map((trap) => trap.id);
    expect(ids).toContain('a');
    expect(ids).toContain('c');
    expect(ids).not.toContain('b');
  });

  it('does not change which actions the viewer may take', () => {
    const observed = getObservationForPlayer(START, 'white');
    const realKeys = generateLegalActions(START)
      .filter((action) => action.kind === 'move')
      .map(actionKey)
      .sort();
    const observedKeys = generateLegalActions(observed)
      .filter((action) => action.kind === 'move')
      .map(actionKey)
      .sort();
    expect(observedKeys).toEqual(realKeys);
  });
});

describe('seeded rng', () => {
  it('is deterministic and label-stable', () => {
    const a = createRng(42);
    const b = createRng(42);
    expect([a.next(), a.next(), a.int(10)]).toEqual([b.next(), b.next(), b.int(10)]);
    expect(createRng(42).child('x').next()).toBe(createRng(42).child('x').next());
    expect(createRng(42).child('x').next()).not.toBe(createRng(42).child('y').next());
  });

  it('shuffle and pick draw only from the input', () => {
    const rng = createRng(7);
    const items = [1, 2, 3, 4, 5];
    expect(rng.shuffle(items).sort()).toEqual(items);
    expect(items).toContain(rng.pick(items));
  });
});
