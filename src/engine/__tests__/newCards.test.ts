import { describe, expect, it } from 'vitest';
import '../customPieces';
import '../rookPieces';
import '../knightPieces';
import '../bishopPieces';
import { parseSquareName, squareName } from '../board';
import { blockedSquares, regionSquares, visibleTraps } from '../boardEffects';
import type { TrapPlacement } from '../boardEffects';
import { applyMove, createStateFromFen } from '../game';
import { findLegalMove, generateLegalMovesFrom } from '../moveGeneration';
import { castSpell, spellPrimaryTargets } from '../spells';
import type { Color, GameState, Square } from '../types';

const sq = (name: string): Square => {
  const square = parseSquareName(name);
  if (square === null) throw new Error(`bad square ${name}`);
  return square;
};

const targets = (state: GameState, from: string): string[] =>
  [...new Set(generateLegalMovesFrom(state, sq(from)).map((move) => squareName(move.to)))].sort();

const play = (state: GameState, from: string, to: string): GameState => {
  const move = findLegalMove(state, sq(from), sq(to));
  expect(move, `expected ${from}${to} to be legal`).not.toBeNull();
  return applyMove(state, move!);
};

const cast = (state: GameState, color: Color, spell: string, ...names: string[]): GameState => {
  const next = castSpell(state, { spell, color, targets: names.map(sq) });
  expect(next, `expected ${spell} by ${color} on [${names.join(',')}] to be legal`).not.toBeNull();
  return next!;
};

const tryCast = (state: GameState, color: Color, spell: string, ...names: string[]) =>
  castSpell(state, { spell, color, targets: names.map(sq) });

const pieceAt = (state: GameState, name: string) => state.board[sq(name)];

/** Hand-place a trap (already validated paths are exercised via casting too). */
const withTrap = (
  state: GameState,
  trap: TrapPlacement['trap'],
  owner: Color,
  square: string,
  extra: Partial<TrapPlacement> = {},
): GameState => ({
  ...state,
  traps: [
    ...state.traps,
    {
      id: `${trap}:${square}`,
      trap,
      owner,
      square: sq(square),
      revealed: false,
      armed: true,
      ...extra,
    },
  ],
});

describe('Smoke Screen', () => {
  it('covers a full 3×3 region, clipped at edges and corners', () => {
    expect(regionSquares(sq('d4'))).toHaveLength(9);
    expect(regionSquares(sq('a4'))).toHaveLength(6); // edge
    expect(regionSquares(sq('a1'))).toHaveLength(4); // corner
    expect(regionSquares(sq('i9'))).toHaveLength(4);
    expect(regionSquares(sq('h8'))).toHaveLength(9); // interior on the 9×9 board
  });

  it('creates the region, lasts two full rounds, and cleans up', () => {
    let state = createStateFromFen('9/k8/9/9/9/9/9/9/K2R5 w - - 0 1');
    state = cast(state, 'white', 'smoke-screen', 'd4');
    expect(state.regions).toHaveLength(1);
    expect(state.regions[0]?.kind).toBe('smoke');
    expect(state.regions[0]?.squares).toHaveLength(9);

    state = play(state, 'a8', 'b8'); // black 1
    expect(state.regions).toHaveLength(1);
    state = play(state, 'a1', 'b1'); // white 1
    expect(state.regions).toHaveLength(1);
    state = play(state, 'b8', 'a8'); // black 2
    expect(state.regions).toHaveLength(1);
    state = play(state, 'b1', 'a1'); // white 2 — the second full round ends
    expect(state.regions).toHaveLength(0); // cleaned up automatically
  });

  it('does not block movement or captures through the area', () => {
    let state = createStateFromFen('9/k2r5/9/9/9/9/9/9/K2R5 w - - 0 1');
    state = cast(state, 'white', 'smoke-screen', 'd4');
    expect(targets(state, 'd8')).toContain('d1'); // straight through the smoke
  });
});

describe('Reconnaissance', () => {
  it('reveals two of the opponent’s cards without removing them', () => {
    let state = createStateFromFen('9/k8/9/9/9/9/9/9/K2R5 w - - 0 1');
    const before = state.spells.black.available.length;
    state = cast(state, 'white', 'reconnaissance');
    const san = state.history.at(-1)?.san ?? '';
    expect(san.startsWith('Recon: ')).toBe(true);
    expect(san.split('+').length).toBe(2); // two names
    expect(state.spells.black.available).toHaveLength(before); // nothing removed
    expect(state.spells.black.revealed).toBe(false); // not a permanent reveal
  });

  it('reveals only one card when only one exists, and cannot fire on empty hands', () => {
    const base = createStateFromFen('9/k8/9/9/9/9/9/9/K2R5 w - - 0 1');
    const oneCard: GameState = {
      ...base,
      spells: { ...base.spells, black: { available: ['freeze'], used: [], revealed: false } },
    };
    const after = cast(oneCard, 'white', 'reconnaissance');
    expect(after.history.at(-1)?.san).toBe('Recon: Freeze');

    const emptyHand: GameState = {
      ...base,
      spells: { ...base.spells, black: { available: [], used: [], revealed: false } },
    };
    expect(tryCast(emptyHand, 'white', 'reconnaissance')).toBeNull();
  });
});

describe('Royal Order', () => {
  it('grants exactly one bonus pawn move after the normal move', () => {
    let state = createStateFromFen('9/k8/9/9/9/9/9/2P6/K2R5 w - - 0 1');
    state = cast(state, 'white', 'royal-order');
    expect(state.turn).toBe('white'); // the normal move is still owed
    expect(state.spells.white.used).toContain('royal-order');

    state = play(state, 'd1', 'd4'); // the normal move
    expect(state.phase).toBe('bonus');
    expect(state.pawnOrder).toEqual({ color: 'white', stage: 'active' });
    expect(targets(state, 'd4')).toEqual([]); // the rook may not use the bonus
    expect(targets(state, 'c2')).toEqual(['c3', 'c4']); // the pawn may

    state = play(state, 'c2', 'c4'); // the bonus pawn move
    expect(state.turn).toBe('black');
    expect(state.phase).toBe('main');
    expect(state.pawnOrder).toBeNull(); // exactly one
  });

  it('only permits legal pawn movement — pins and blocks are respected', () => {
    // The c2 pawn is fully blocked by the knight on c3 with nothing to
    // capture: with no legal pawn move, the bonus phase never opens.
    let blockedPawn = createStateFromFen('9/k8/9/9/9/9/2n6/2P6/K3R4 w - - 0 1');
    blockedPawn = cast(blockedPawn, 'white', 'royal-order');
    blockedPawn = play(blockedPawn, 'e1', 'e4');
    expect(blockedPawn.phase).toBe('main');
    expect(blockedPawn.turn).toBe('black');

    // A pinned pawn is offered nothing while a free pawn still qualifies.
    // Horizontal pin: rook a3 – pawn b3 – king c3 (no capture escapes it).
    let pinned = createStateFromFen('9/k8/9/9/9/9/rPK4P1/9/4R4 w - - 0 1');
    pinned = cast(pinned, 'white', 'royal-order');
    pinned = play(pinned, 'e1', 'e4');
    expect(pinned.phase).toBe('bonus');
    expect(targets(pinned, 'b3')).toEqual([]); // pinned: no legal bonus move
    expect(targets(pinned, 'h3')).toEqual(['h4']); // the free pawn may go
  });

  it('cannot be cast without a pawn, and blocks further casts until the move', () => {
    const pawnless = createStateFromFen('9/k8/9/9/9/9/9/9/K2R5 w - - 0 1');
    expect(tryCast(pawnless, 'white', 'royal-order')).toBeNull();

    let state = createStateFromFen('9/k8/9/9/9/9/9/2P6/K2R5 w - - 0 1');
    state = cast(state, 'white', 'royal-order');
    expect(tryCast(state, 'white', 'shield', 'd1')).toBeNull(); // move first
  });
});

describe('Last Stand', () => {
  it('requires being outnumbered', () => {
    const even = createStateFromFen('9/k2r5/9/9/9/9/9/9/K2R5 w - - 0 1');
    expect(tryCast(even, 'white', 'last-stand', 'd1')).toBeNull();

    const outnumbered = createStateFromFen('9/k2rr4/9/9/9/9/9/9/K2R5 w - - 0 1');
    expect(tryCast(outnumbered, 'white', 'last-stand', 'd1')).not.toBeNull();
  });

  it('prevents exactly one capture, then removes itself', () => {
    let state = createStateFromFen('9/k2rr4/9/9/9/9/9/9/K2R5 w - - 0 1');
    state = cast(state, 'white', 'last-stand', 'd1');
    expect(pieceAt(state, 'd1')?.hitPoints).toBe(2);

    // Black's capture attempt is repelled: the attacker is lost instead.
    state = play(state, 'd8', 'd1');
    expect(pieceAt(state, 'd1')).toMatchObject({ type: 'rook', color: 'white', hitPoints: 1 });
    expect(pieceAt(state, 'd8')).toBeNull();

    // The protection is spent: the next capture succeeds normally.
    state = play(state, 'a1', 'b1');
    state = play(state, 'e8', 'd8');
    state = play(state, 'b1', 'a1');
    state = play(state, 'd8', 'd1');
    expect(pieceAt(state, 'd1')).toMatchObject({ type: 'rook', color: 'black' });
  });
});

describe('Interference', () => {
  it('targets only revealed, armed, enemy traps', () => {
    let state = createStateFromFen('9/k8/9/9/9/9/9/9/K2R5 w - - 0 1');
    state = withTrap(state, 'tripwire', 'black', 'd4', { revealed: true });
    state = withTrap(state, 'web-trap', 'black', 'e4'); // hidden
    state = withTrap(state, 'sonar', 'white', 'f4', { revealed: true }); // friendly

    const options = spellPrimaryTargets(state, 'white', 'interference').map(squareName);
    expect(options).toEqual(['d4']);
    expect(tryCast(state, 'white', 'interference', 'e4')).toBeNull(); // hidden
    expect(tryCast(state, 'white', 'interference', 'f4')).toBeNull(); // friendly

    const after = cast(state, 'white', 'interference', 'd4');
    expect(after.traps.some((trap) => trap.square === sq('d4'))).toBe(false); // disabled
  });

  it('cannot be played when no revealed enemy trap exists', () => {
    const state = createStateFromFen('9/k8/9/9/9/9/9/9/K2R5 w - - 0 1');
    expect(tryCast(state, 'white', 'interference', 'd4')).toBeNull();
  });
});

describe('Null Field', () => {
  it('prevents spells from targeting the region, but not traps or movement', () => {
    let state = createStateFromFen('9/k2r5/9/9/9/3R5/9/9/K8 w - - 0 1');
    state = cast(state, 'white', 'null-field', 'd4');
    expect(state.regions[0]?.kind).toBe('null-field');

    // Black cannot freeze the rook inside the field.
    expect(spellPrimaryTargets(state, 'black', 'freeze').map(squareName)).toEqual([]);
    expect(tryCast(state, 'black', 'freeze', 'd4')).toBeNull();

    // But black may place a trap inside it (traps are not spells)…
    expect(spellPrimaryTargets(state, 'black', 'tripwire').map(squareName)).toContain('c4');
    // …and normal chess continues: the black rook slides into the region.
    expect(targets(state, 'd8')).toContain('d5');
  });

  it('expires at the caster’s next turn', () => {
    let state = createStateFromFen('9/k2r5/9/9/9/3R5/9/9/K8 w - - 0 1');
    state = cast(state, 'white', 'null-field', 'd4');
    state = play(state, 'a8', 'b8'); // black's (suppressed) turn passes
    expect(state.regions).toHaveLength(0); // white's turn: field gone
    state = play(state, 'a1', 'b1');
    expect(tryCast(state, 'black', 'freeze', 'd4')).not.toBeNull();
  });
});

describe('Sacred Ground', () => {
  it('protects whichever piece stands on the square, for one full round', () => {
    let state = createStateFromFen('9/k2r5/9/9/9/3R5/9/9/K8 w - - 0 1');
    state = cast(state, 'white', 'sacred-ground', 'd4');
    // Black cannot freeze the occupant.
    expect(tryCast(state, 'black', 'freeze', 'd4')).toBeNull();
    state = play(state, 'a8', 'b8');
    // Still consecrated during white's turn; white moves the rook away…
    state = play(state, 'd4', 'h4');
    // …and the immunity does not follow the piece.
    expect(tryCast(state, 'black', 'freeze', 'h4')).not.toBeNull();
  });

  it('covers a new piece entering the square, then expires', () => {
    let state = createStateFromFen('9/k2r5/9/9/9/9/9/9/K2R5 w - - 0 1');
    state = cast(state, 'white', 'sacred-ground', 'd4');
    state = play(state, 'd8', 'd4'); // the BLACK rook claims the holy ground
    expect(tryCast(state, 'white', 'freeze', 'd4')).toBeNull(); // works for either player

    state = play(state, 'a1', 'b1'); // white's turn passes — the round completes
    expect(state.squareStatuses).toHaveLength(0);
    state = play(state, 'a8', 'b8');
    expect(tryCast(state, 'white', 'freeze', 'd4')).not.toBeNull();
  });
});

describe('Tripwire', () => {
  const wire = (fen: string) =>
    withTrap(createStateFromFen(fen), 'tripwire', 'white', 'd4');

  it('stops a rook, bishop and queen crossing it, revealing and spending itself', () => {
    // Rook down the d-file.
    let state = wire('9/k2r5/9/9/9/9/9/9/K8 b - - 0 1');
    state = play(state, 'd8', 'd1');
    expect(pieceAt(state, 'd1')).toBeNull();
    expect(pieceAt(state, 'd4')).toMatchObject({ type: 'rook', color: 'black' });
    expect(state.traps[0]).toMatchObject({ revealed: true, armed: false });
    expect(state.history.at(-1)?.san).toContain('†');

    // Bishop across the a7–g1 diagonal (d4 lies on it).
    let diag = withTrap(createStateFromFen('9/k8/b8/9/9/9/9/9/K8 b - - 0 1'), 'tripwire', 'white', 'd4');
    diag = play(diag, 'a7', 'g1');
    expect(pieceAt(diag, 'd4')).toMatchObject({ type: 'bishop' });

    // Queen straight down.
    let q = withTrap(createStateFromFen('9/k2q5/9/9/9/9/9/9/K8 b - - 0 1'), 'tripwire', 'white', 'd4');
    q = play(q, 'd8', 'd2');
    expect(pieceAt(q, 'd4')).toMatchObject({ type: 'queen' });
  });

  it('ignores knight jumps and teleports', () => {
    let state = withTrap(createStateFromFen('9/k8/9/9/9/9/9/3n5/K8 b - - 0 1'), 'tripwire', 'white', 'd3');
    state = play(state, 'd2', 'e4'); // the L passes "over" d3 conceptually
    expect(state.traps[0]).toMatchObject({ armed: true, revealed: false });

    // Teleport from d8 to d2 crosses d4 geometrically, but nothing travels.
    let tp = withTrap(createStateFromFen('9/k2r5/9/9/9/9/9/9/K8 b - - 0 1'), 'tripwire', 'white', 'd4');
    tp = cast(tp, 'black', 'teleport', 'd8', 'd2');
    expect(pieceAt(tp, 'd2')).toMatchObject({ type: 'rook' });
    expect(tp.traps[0]).toMatchObject({ armed: true, revealed: false });
  });

  it('suppresses bonus movement for the tripped turn', () => {
    // Black owns a Duelist (normally granting a free move every turn); the
    // tripped rook forfeits the whole bonus window.
    let state = withTrap(
      createStateFromFen('9/k2r5/7d1/9/9/9/9/9/K8 b - - 0 1'),
      'tripwire',
      'white',
      'd4',
    );
    state = play(state, 'd8', 'd1');
    expect(pieceAt(state, 'd4')).toMatchObject({ type: 'rook' }); // tripped
    expect(state.phase).toBe('main'); // no duelist bonus offered
    expect(state.turn).toBe('white');

    // Control: an untripped move still opens the duelist window.
    let control = createStateFromFen('9/k2r5/7d1/9/9/9/9/9/K8 b - - 0 1');
    control = play(control, 'd8', 'd1');
    expect(control.phase).toBe('bonus');
  });

  it('never produces an illegal king state — the wire fizzles instead', () => {
    // White queen on h4 checks the black king on h8; the black rook's only
    // answer is a4×h4 along rank 4 — crossing the wire on e4. Stopping at e4
    // would leave black in check, so the capture completes; the wire is spent.
    let state = withTrap(
      createStateFromFen('9/7k1/9/9/9/r6Q1/9/9/K8 b - - 0 1'),
      'tripwire',
      'white',
      'e4',
    );
    state = play(state, 'a4', 'h4');
    expect(pieceAt(state, 'h4')).toMatchObject({ type: 'rook', color: 'black' });
    expect(state.traps[0]).toMatchObject({ armed: false, revealed: true });
  });
});

describe('Sonar', () => {
  it('scans exactly its 3×3 area, revealing without destroying', () => {
    let state = createStateFromFen('9/k2r5/9/9/9/9/9/9/K8 b - - 0 1');
    state = withTrap(state, 'sonar', 'white', 'd4');
    state = withTrap(state, 'web-trap', 'black', 'c3'); // inside the scan
    state = withTrap(state, 'dead-zone', 'black', 'e5'); // inside
    state = withTrap(state, 'tripwire', 'black', 'h8', ); // far outside

    state = play(state, 'd8', 'd4'); // black lands on the sonar
    const byId = (id: string) => state.traps.find((trap) => trap.id.startsWith(id))!;
    expect(byId('sonar')).toMatchObject({ revealed: true, armed: false }); // spent
    expect(byId('web-trap')).toMatchObject({ revealed: true, armed: true }); // detected, still live
    expect(byId('dead-zone')).toMatchObject({ revealed: true, armed: true });
    expect(byId('tripwire')).toMatchObject({ revealed: false, armed: true }); // out of range

    // Visibility: white now sees the revealed black traps.
    const seen = visibleTraps(state, 'white').map((trap) => trap.trap).sort();
    expect(seen).toEqual(['dead-zone', 'sonar', 'web-trap']);
  });
});

describe('Web Trap', () => {
  it('webs the arriving piece for one opportunity, leaving it targetable', () => {
    let state = createStateFromFen('9/k2r5/9/9/9/9/9/9/K2R2R2 b - - 0 1');
    state = withTrap(state, 'web-trap', 'white', 'd5');
    state = play(state, 'd8', 'd5'); // black rook lands in the web
    expect(state.traps[0]).toMatchObject({ revealed: true, armed: false });
    expect(state.effects.some((effect) => effect.kind === 'webbed')).toBe(true);

    // It is still fully targetable by cards — white freezes it? no: shield is
    // friendly; use freeze — wait, freeze is white targeting the webbed rook:
    expect(tryCast(state, 'white', 'freeze', 'd5')).not.toBeNull();

    state = play(state, 'a1', 'b1'); // white plays on
    // Black's next opportunity: the webbed rook cannot move…
    expect(targets(state, 'd5')).toEqual([]);
    // …but another black piece can.
    expect(targets(state, 'a8').length).toBeGreaterThan(0);
    state = play(state, 'a8', 'b8');

    // The web has expired: the rook moves freely on its following turn.
    state = play(state, 'b1', 'a1');
    expect(state.effects.some((effect) => effect.kind === 'webbed')).toBe(false);
    expect(targets(state, 'd5').length).toBeGreaterThan(0);
  });

  it('a webbed piece can still be captured', () => {
    let state = createStateFromFen('9/k2r5/9/9/9/9/9/9/K2R5 b - - 0 1');
    state = withTrap(state, 'web-trap', 'white', 'd5');
    state = play(state, 'd8', 'd5');
    const after = play(state, 'd1', 'd5');
    expect(after.captured.white).toEqual(['rook']);
    expect(after.effects).toHaveLength(0); // status died with the piece
  });
});

describe('Dead Zone', () => {
  const enter = () => {
    let state = createStateFromFen('9/k2r5/9/9/9/9/9/9/K2R3R1 b - - 0 1');
    state = withTrap(state, 'dead-zone', 'white', 'd5');
    return play(state, 'd8', 'd5'); // black rook triggers the zone
  };

  it('does not block while the triggering piece remains', () => {
    const state = enter();
    expect(state.traps[0]).toMatchObject({ revealed: true, armed: true });
    expect(state.traps[0]?.pendingPieceId).toBeDefined();
    expect(blockedSquares(state).size).toBe(0);
  });

  it('activates when the piece leaves, blocking landings and slides for one round', () => {
    let state = enter();
    state = play(state, 'a1', 'b1');
    state = play(state, 'd5', 'h5'); // the trigger departs
    expect(blockedSquares(state).has(sq('d5'))).toBe(true);

    // White may not land on it or slide through it.
    const rookReach = targets(state, 'd1');
    expect(rookReach).not.toContain('d5');
    expect(rookReach).not.toContain('d6');
    expect(rookReach).not.toContain('d8');
    expect(rookReach).toContain('d4');
    expect(tryCast(state, 'white', 'teleport', 'h1', 'd5')).toBeNull();

    state = play(state, 'b1', 'a1'); // white's blocked turn
    expect(blockedSquares(state).has(sq('d5'))).toBe(true);
    state = play(state, 'h5', 'h6'); // black's blocked turn
    expect(blockedSquares(state).size).toBe(0); // restored
    expect(targets(state, 'd1')).toContain('d5');
  });

  it('activates when the triggering piece is captured or teleported away', () => {
    const state = enter();
    const captured = play(state, 'd1', 'd5'); // white captures the trigger
    expect(blockedSquares(captured).has(sq('d5'))).toBe(true);

    let tp = enter();
    tp = play(tp, 'a1', 'b1');
    tp = cast(tp, 'black', 'teleport', 'd5', 'f7'); // d5 parity: 3+4=7; f7: 5+6=11 — both odd
    expect(blockedSquares(tp).has(sq('d5'))).toBe(true);
  });
});

describe('integration', () => {
  it('interference disables a sonar-revealed trap', () => {
    let state = createStateFromFen('9/k2r5/9/9/9/9/9/9/K8 b - - 0 1');
    state = withTrap(state, 'sonar', 'white', 'd4');
    state = withTrap(state, 'web-trap', 'black', 'c3');
    state = play(state, 'd8', 'd4'); // sonar reveals the black web trap
    // White can now interfere with it.
    const after = cast(state, 'white', 'interference', 'c3');
    expect(after.traps.some((trap) => trap.trap === 'web-trap')).toBe(false);
  });

  it('traps keep working inside a null field', () => {
    let state = createStateFromFen('9/k2r5/9/9/9/9/9/9/K8 w - - 0 1');
    state = withTrap(state, 'web-trap', 'white', 'd5');
    state = cast(state, 'white', 'null-field', 'd5');
    state = play(state, 'd8', 'd5'); // black lands inside the field, on the web
    expect(state.effects.some((effect) => effect.kind === 'webbed')).toBe(true);
  });

  it('sacred ground shields a piece from a web trap', () => {
    let state = createStateFromFen('9/k2r5/9/9/9/9/9/9/K2R5 b - - 0 1');
    state = withTrap(state, 'web-trap', 'white', 'd5');
    state = cast(state, 'black', 'sacred-ground', 'd5');
    state = play(state, 'a1', 'b1'); // white
    state = play(state, 'd8', 'd5'); // black lands on holy (and webbed) ground
    expect(state.traps[0]).toMatchObject({ armed: false }); // trap is spent…
    expect(state.effects.some((effect) => effect.kind === 'webbed')).toBe(false); // …but no web
  });

  it('sacred ground protects a mover from a tripwire, centrally', () => {
    let state = createStateFromFen('9/k2r5/9/9/9/9/9/9/K8 b - - 0 1');
    state = withTrap(state, 'tripwire', 'white', 'd4');
    state = cast(state, 'black', 'sacred-ground', 'd8'); // consecrate the rook's square
    state = play(state, 'a1', 'b1');
    state = play(state, 'd8', 'd1'); // slides across the wire, immune
    expect(pieceAt(state, 'd1')).toMatchObject({ type: 'rook' });
    expect(state.traps[0]).toMatchObject({ armed: true, revealed: false });
  });

  it('a fresh game carries no regions, statuses, traps or effects', () => {
    const state = createStateFromFen('9/k8/9/9/9/9/9/9/K8 w - - 0 1');
    expect(state.regions).toEqual([]);
    expect(state.squareStatuses).toEqual([]);
    expect(state.traps).toEqual([]);
    expect(state.effects).toEqual([]);
    expect(state.pawnOrder).toBeNull();
  });

  it('trap cards are placed hidden with a concealed history label', () => {
    let state = createStateFromFen('9/k8/9/9/9/9/9/9/K2R5 w - - 0 1');
    const options = spellPrimaryTargets(state, 'white', 'tripwire');
    expect(options).not.toContain(sq('d1')); // occupied squares excluded
    state = cast(state, 'white', 'tripwire', 'd4');
    expect(state.history.at(-1)?.san).toBe('Trap…'); // which trap, and where, stays secret
    expect(state.traps[0]).toMatchObject({ trap: 'tripwire', revealed: false, armed: true });
    expect(visibleTraps(state, 'black')).toHaveLength(0);
    expect(visibleTraps(state, 'white')).toHaveLength(1);
  });
});
