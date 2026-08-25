import { describe, expect, it } from 'vitest';
import '../../engine/customPieces';
import '../../engine/rookPieces';
import '../../engine/knightPieces';
import '../../engine/bishopPieces';
import {
  applyMove,
  castSpell,
  createStateFromFen,
  findLegalMove,
  parseSquareName,
  type Color,
  type GameState,
  type Square,
} from '../../engine';
import { cardActivationsBetween, type CardActivation } from '../useCardActivations';

const sq = (name: string): Square => {
  const square = parseSquareName(name);
  if (square === null) throw new Error(`bad square ${name}`);
  return square;
};

const cast = (state: GameState, color: Color, spell: string, ...names: string[]): GameState => {
  const next = castSpell(state, { spell, color, targets: names.map(sq) });
  expect(next, `expected ${spell} to be legal`).not.toBeNull();
  return next!;
};

const play = (state: GameState, from: string, to: string): GameState => {
  const move = findLegalMove(state, sq(from), sq(to));
  expect(move, `expected ${from}${to} to be legal`).not.toBeNull();
  return applyMove(state, move!);
};

/** Ids only need to be unique; the sequence keeps assertions readable. */
const ids = () => {
  let next = 0;
  return () => ++next;
};

const between = (before: GameState, after: GameState) =>
  cardActivationsBetween(before, after, ids());

/**
 * What the event says about itself. Each one also carries `before` — the
 * position it happened to, which the board's own spectacle renders — and that
 * whole state is not what these assertions are about.
 */
const announced = (event: CardActivation) => ({
  id: event.id,
  kind: event.kind,
  spell: event.spell,
  color: event.color,
});

describe('cardActivationsBetween', () => {
  it('announces an openly cast spell, face up', () => {
    const before = createStateFromFen('9/k8/9/9/9/9/9/9/K2R5 w - - 0 1');
    const after = cast(before, 'white', 'shield', 'd1');

    expect(between(before, after).map(announced)).toEqual([
      { id: 1, kind: 'cast', spell: 'shield', color: 'white' },
    ]);
  });

  it('a trap being set stays face down — the card is never named', () => {
    const before = createStateFromFen('9/k8/9/9/9/9/9/9/K2R5 w - - 0 1');
    const after = cast(before, 'white', 'tripwire', 'd5');

    const events = between(before, after).map(announced);
    expect(events).toEqual([{ id: 1, kind: 'set', spell: null, color: 'white' }]);
    // Belt and braces: the trap's identity must not leak through the event.
    expect(JSON.stringify(events)).not.toContain('tripwire');
  });

  it('turns the card face up only when the trap actually fires', () => {
    // White buries a wire on d5; black's rook then runs down that file.
    const armed = cast(createStateFromFen('3r5/k8/9/9/9/9/9/9/K8 w - - 0 1'), 'white', 'tripwire', 'd5');
    const tripped = play(armed, 'd9', 'd1');

    // The rook is stopped on the wire, and only now is the card named.
    expect(tripped.board[sq('d5')]?.type).toBe('rook');
    expect(between(armed, tripped).map(announced)).toEqual([
      { id: 1, kind: 'trigger', spell: 'tripwire', color: 'white' },
    ]);
  });

  it('says nothing about an ordinary move', () => {
    const before = createStateFromFen('9/k8/9/9/9/9/9/9/K2R5 w - - 0 1');
    expect(between(before, play(before, 'd1', 'd3'))).toEqual([]);
  });
});
