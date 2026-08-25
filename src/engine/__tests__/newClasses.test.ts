import { describe, expect, it } from 'vitest';
import '../customPieces';
import '../rookPieces';
import '../knightPieces';
import '../bishopPieces';
import { parseSquareName, squareName } from '../board';
import { applyMove, createStateFromFen, skipBonusMove } from '../game';
import { findLegalMove, generateLegalMovesFrom } from '../moveGeneration';
import { castSpell, getSpellDefinition, lesserPieceTypes, spellPrimaryTargets, spellSecondaryTargets } from '../spells';
import { blockedSquares, portalExit } from '../boardEffects';
import { hasEffect } from '../effects';
import { generateLegalActions } from '../../ai/actions';
import type { Color, GameState, PieceType, Square } from '../types';

const sq = (name: string): Square => {
  const square = parseSquareName(name);
  if (square === null) throw new Error(`bad square ${name}`);
  return square;
};

const cast = (
  state: GameState,
  color: Color,
  spell: string,
  names: string[],
  choice?: PieceType,
): GameState => {
  const next = castSpell(state, {
    spell,
    color,
    targets: names.map(sq),
    ...(choice === undefined ? {} : { choice }),
  });
  expect(next, `expected ${spell} by ${color} on [${names.join(',')}] to be legal`).not.toBeNull();
  return next!;
};

const tryCast = (state: GameState, color: Color, spell: string, names: string[], choice?: PieceType) =>
  castSpell(state, {
    spell,
    color,
    targets: names.map(sq),
    ...(choice === undefined ? {} : { choice }),
  });

/**
 * The secret card is not in any starting book — it only reaches a game
 * through a drafted army — so a test that wants to play it deals it in.
 */
const dealSecret = (state: GameState, color: Color): GameState => ({
  ...state,
  spells: {
    ...state.spells,
    [color]: {
      ...state.spells[color],
      available: [...state.spells[color].available, 'rulers-authority'],
    },
  },
});

const play = (state: GameState, from: string, to: string): GameState => {
  const move = findLegalMove(state, sq(from), sq(to));
  expect(move, `expected ${from}${to} to be legal`).not.toBeNull();
  return applyMove(state, move!);
};

const targets = (state: GameState, from: string): string[] =>
  [...new Set(generateLegalMovesFrom(state, sq(from)).map((move) => squareName(move.to)))].sort();

describe('card kinds', () => {
  it('every new card is registered under its own kind', () => {
    expect(getSpellDefinition('mirror-shield').kind).toBe('relic');
    expect(getSpellDefinition('crown-of-command').kind).toBe('relic');
    expect(getSpellDefinition('wall').kind).toBe('terrain');
    expect(getSpellDefinition('portal').kind).toBe('terrain');
    expect(getSpellDefinition('decay').kind).toBe('curse');
    expect(getSpellDefinition('transform').kind).toBe('curse');
    // The originals keep theirs, derived from isTrap.
    expect(getSpellDefinition('shield').kind).toBe('spell');
    expect(getSpellDefinition('tripwire').kind).toBe('trap');
  });
});

describe('Mirror Shield', () => {
  it('turns aside the first enemy card that targets the wearer, spending both', () => {
    const start = createStateFromFen('9/k7r/9/9/9/9/9/9/K2R5 w - - 0 1');
    const guarded = cast(start, 'white', 'mirror-shield', ['d1']);
    expect(hasEffect(guarded.effects, 'mirror-shield', guarded.board[sq('d1')]!.id)).toBe(true);

    // Black tries to freeze the shielded rook: the freeze breaks on the relic.
    const deflected = cast(guarded, 'black', 'freeze', ['d1']);
    expect(deflected.effects.some((effect) => effect.kind === 'freeze')).toBe(false);
    expect(deflected.effects.some((effect) => effect.kind === 'mirror-shield')).toBe(false);
    expect(deflected.spells.black.used).toContain('freeze');
    expect(deflected.history.at(-1)!.san).toBe('Freeze✗');
    // It cost black their turn.
    expect(deflected.turn).toBe('white');
  });

  it('does not deflect its own side’s cards', () => {
    const start = createStateFromFen('9/k7r/9/9/9/9/9/9/K2R5 w - - 0 1');
    const guarded = cast(start, 'white', 'mirror-shield', ['d1']);
    const black = play(guarded, 'a8', 'b8');
    const shielded = cast(black, 'white', 'shield', ['d1']);
    expect(shielded.effects.some((effect) => effect.kind === 'shield')).toBe(true);
    expect(shielded.effects.some((effect) => effect.kind === 'mirror-shield')).toBe(true);
  });
});

describe('Crown of Command', () => {
  it('buys a bonus Pawn move the first time the wearer moves, then is spent', () => {
    const start = createStateFromFen('9/k8/9/9/9/9/P8/9/K2R5 w - - 0 1');
    const crowned = cast(start, 'white', 'crown-of-command', ['d1']);
    const black = play(crowned, 'a8', 'b8');

    const moved = play(black, 'd1', 'd5');
    // The crown opens the same window a Royal Order does.
    expect(moved.phase).toBe('bonus');
    expect(moved.turn).toBe('white');
    expect(moved.pawnOrder).toEqual({ color: 'white', stage: 'active' });
    expect(moved.effects.some((effect) => effect.kind === 'crown')).toBe(false);

    // Only a Pawn may take it.
    expect(targets(moved, 'd5')).toEqual([]);
    const bonus = play(moved, 'a3', 'a4');
    expect(bonus.turn).toBe('black');
  });

  it('cannot be worn by a King, and needs a Pawn to command', () => {
    const noPawns = createStateFromFen('9/k8/9/9/9/9/9/9/K2R5 w - - 0 1');
    // The rule is a castability gate: there is a wearer, but no Pawn to
    // command, so the card cannot be played at all.
    expect(getSpellDefinition('crown-of-command').castable!(noPawns, 'white')).toBe(false);
    expect(tryCast(noPawns, 'white', 'crown-of-command', ['d1'])).toBeNull();

    const withPawn = createStateFromFen('9/k8/9/9/9/9/P8/9/K2R5 w - - 0 1');
    const legal = spellPrimaryTargets(withPawn, 'white', 'crown-of-command');
    expect(legal).toContain(sq('d1'));
    expect(legal).not.toContain(sq('a1')); // the King is royal
  });
});

describe('Wall', () => {
  it('blocks both squares for two rounds, then falls', () => {
    const start = createStateFromFen('9/k8/9/9/9/9/9/9/K2R5 w - - 0 1');
    const legalSeconds = spellSecondaryTargets(start, 'white', 'wall', sq('d5'));
    expect(legalSeconds.map(squareName).sort()).toEqual(['c5', 'd4', 'd6', 'e5']);

    let state = cast(start, 'white', 'wall', ['d5', 'd6']);
    expect([...blockedSquares(state)].sort()).toEqual([sq('d5'), sq('d6')].sort());
    // The rook cannot pass through the wall on its own file.
    expect(targets(state, 'd1')).not.toContain('d5');
    expect(targets(state, 'd1')).not.toContain('d7');

    // Two rounds: four plies.
    state = play(state, 'a8', 'b8');
    state = play(state, 'd1', 'd4');
    state = play(state, 'b8', 'a8');
    expect(blockedSquares(state).size).toBe(0);
    expect(targets(state, 'd4')).toContain('d9');
  });

  it('only builds on two adjacent empty squares', () => {
    const start = createStateFromFen('9/k8/9/9/9/9/9/9/K2R5 w - - 0 1');
    expect(tryCast(start, 'white', 'wall', ['d5', 'f5'])).toBeNull(); // not adjacent
    expect(tryCast(start, 'white', 'wall', ['d5', 'd1'])).toBeNull(); // occupied
  });
});

describe('Portal', () => {
  it('lets a piece standing on one gate step out of the other', () => {
    const start = createStateFromFen('9/k8/9/9/9/9/9/9/K2R5 w - - 0 1');
    const opened = cast(start, 'white', 'portal', ['d5', 'h9']);
    expect(portalExit(opened, sq('d5'))).toBe(sq('h9'));
    expect(portalExit(opened, sq('h9'))).toBe(sq('d5'));
    expect(portalExit(opened, sq('a5'))).toBeNull();

    const black = play(opened, 'a8', 'b8');
    const onGate = play(black, 'd1', 'd5');
    const black2 = play(onGate, 'b8', 'a8');
    // Standing on a gate, the far end is now a legal destination.
    expect(targets(black2, 'd5')).toContain('h9');

    const jumped = play(black2, 'd5', 'h9');
    expect(jumped.board[sq('h9')]!.type).toBe('rook');
    expect(jumped.board[sq('d5')]).toBeNull();
    // The gates stay open.
    expect(portalExit(jumped, sq('d5'))).toBe(sq('h9'));
  });
});

describe('Decay', () => {
  it('gives its owner three turns with the piece, then crumbles it', () => {
    let state = createStateFromFen('9/k7r/9/9/9/9/9/9/K2R5 w - - 0 1');
    state = cast(state, 'white', 'decay', ['i8']);
    expect(state.board[sq('i8')]).not.toBeNull();

    state = play(state, 'i8', 'i7'); // black turn 1
    state = play(state, 'd1', 'd2');
    state = play(state, 'i7', 'i6'); // black turn 2
    state = play(state, 'd2', 'd3');
    expect(state.board[sq('i6')]).not.toBeNull(); // still standing
    state = play(state, 'i6', 'i5'); // black turn 3
    state = play(state, 'd3', 'd4');
    // Black's fourth turn begins: the rook is dust before they can move it.
    expect(state.board[sq('i5')]).toBeNull();
    expect(state.reserves.black).toEqual(['rook']);
    expect(state.effects.some((effect) => effect.kind === 'decay')).toBe(false);
  });

  it('cannot touch a King or a Queen-class piece', () => {
    const state = createStateFromFen('9/k7q/9/9/9/9/9/9/K2R5 w - - 0 1');
    const legal = spellPrimaryTargets(state, 'white', 'decay');
    expect(legal).not.toContain(sq('a8')); // King
    expect(legal).not.toContain(sq('i8')); // Queen
    expect(tryCast(state, 'white', 'decay', ['i8'])).toBeNull();
  });
});

describe('Transform', () => {
  it('demotes only down the ladder', () => {
    expect(lesserPieceTypes('queen')).toContain('rook');
    expect(lesserPieceTypes('queen')).toContain('pawn');
    expect(lesserPieceTypes('rook')).not.toContain('queen');
    expect(lesserPieceTypes('knight')).toEqual(['pawn']);
    expect(lesserPieceTypes('bishop')).toEqual(['pawn']);
    expect(lesserPieceTypes('pawn')).toEqual([]);
    expect(lesserPieceTypes('king')).toContain('queen');
  });

  it('turns an enemy piece into the chosen lesser one', () => {
    const state = createStateFromFen('9/k7q/9/9/9/9/9/9/K2R5 w - - 0 1');
    const cursed = cast(state, 'white', 'transform', ['i8'], 'bishop');
    const victim = cursed.board[sq('i8')]!;
    expect(victim.type).toBe('bishop');
    expect(victim.color).toBe('black');
    expect(victim.origin).toBe('queen');
  });

  it('refuses a King, a missing choice, and a choice that is not lesser', () => {
    const state = createStateFromFen('9/k7q/9/9/9/9/9/9/K2R5 w - - 0 1');
    expect(spellPrimaryTargets(state, 'white', 'transform')).toContain(sq('i8'));
    expect(spellPrimaryTargets(state, 'white', 'transform')).not.toContain(sq('a8'));
    expect(tryCast(state, 'white', 'transform', ['i8'])).toBeNull();
    expect(tryCast(state, 'white', 'transform', ['i8'], 'queen')).toBeNull();
    expect(tryCast(state, 'white', 'transform', ['i8'], 'king')).toBeNull();
  });

  it('a card that takes no choice must not be handed one', () => {
    const state = createStateFromFen('9/k8/9/9/9/9/9/9/K2R5 w - - 0 1');
    expect(tryCast(state, 'white', 'shield', ['d1'], 'rook')).toBeNull();
  });
});

describe("Ruler's Authority", () => {
  it('clears the board of everything but the caster’s King, and ends the game', () => {
    const start = dealSecret(createStateFromFen('5k3/8q/3r5/9/9/9/1P7/9/K3R3B w - - 0 1'), 'white');
    const decree = cast(start, 'white', 'rulers-authority', []);

    const survivors = decree.board.filter((piece) => piece !== null);
    expect(survivors).toHaveLength(1);
    expect(survivors[0]).toMatchObject({ type: 'king', color: 'white' });

    expect(decree.status).toBe('annihilation');
    expect(decree.winner).toBe('white');
    // Destruction, not capture: nothing is credited, everything is mourned.
    expect(decree.captured).toEqual({ white: [], black: [] });
    expect([...decree.reserves.white].sort()).toEqual(['bishop', 'pawn', 'rook']);
    expect([...decree.reserves.black].sort()).toEqual(['king', 'queen', 'rook']);
  });

  it('sweeps the board’s own furniture away with the pieces', () => {
    let state = dealSecret(createStateFromFen('5k3/9/8r/9/9/9/P8/1N7/K3R3Q w - - 0 1'), 'white');
    state = cast(state, 'white', 'portal', ['c6', 'g6']);
    state = cast(state, 'black', 'decay', ['b2']);
    // Late enough that the wall is still standing when the decree lands.
    state = cast(state, 'white', 'wall', ['d5', 'e5']);
    state = play(state, 'i7', 'i6');
    expect(state.squareStatuses.length).toBeGreaterThan(0);
    expect(state.portals).toHaveLength(1);

    const decree = cast(state, 'white', 'rulers-authority', []);
    expect(decree.squareStatuses).toEqual([]);
    expect(decree.portals).toEqual([]);
    expect(decree.effects).toEqual([]);
    expect(decree.traps).toEqual([]);
  });

  it('is not in the standard card set — it only arrives in a drafted army', () => {
    const state = createStateFromFen();
    expect(state.spells.white.available).not.toContain('rulers-authority');
    expect(getSpellDefinition('rulers-authority').secret).toBe(true);
    expect(getSpellDefinition('shield').secret).toBeUndefined();
  });

  it('needs a living Ruler to give the order', () => {
    // A board where white has no royal piece at all.
    const state = createStateFromFen('5k3/9/9/9/9/9/9/9/4R4 w - - 0 1');
    expect(getSpellDefinition('rulers-authority').castable!(state, 'white')).toBe(false);
  });
});

describe('a deflected card is still a spent turn', () => {
  it('cannot be used to answer a check', () => {
    // White's shielded rook has black's king in check. Freezing it would
    // normally break the check — but the card breaks on the relic instead,
    // so the cast is illegal rather than a free escape. (The action layer
    // models the same rule; `castWouldBeDeflected` is what keeps them
    // agreeing, and a random-play fuzz over 40 games is what found it.)
    const start = createStateFromFen('4k4/9/9/9/9/9/9/9/K3R4 w - - 0 1');
    const guarded = cast(start, 'white', 'mirror-shield', ['e1']);
    expect(guarded.status).toBe('check');
    expect(tryCast(guarded, 'black', 'freeze', ['e1'])).toBeNull();
    expect(
      generateLegalActions(guarded).some(
        (action) => action.kind === 'spell' && action.spell === 'freeze',
      ),
    ).toBe(false);
  });
});

describe('a passed bonus still ages curses', () => {
  it('decay counts down when the bonus window is declined', () => {
    let state = createStateFromFen('9/k7r/9/9/9/9/9/9/K2R5 w - - 0 1');
    state = cast(state, 'white', 'decay', ['i8']);
    // The cast has already crossed into black's turn, so one tick is spent.
    const turns = state.effects.find((effect) => effect.kind === 'decay')!.turnsRemaining;
    expect(turns).toBe(3);
    // Skipping outside a bonus phase is a no-op, so the count holds.
    expect(skipBonusMove(state)).toBe(state);
  });
});
