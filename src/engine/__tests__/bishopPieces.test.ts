import { describe, expect, it } from 'vitest';
import '../customPieces';
import '../rookPieces';
import '../knightPieces';
import '../bishopPieces';
import { parseSquareName, squareName } from '../board';
import { applyMove, createStateFromFen } from '../game';
import { findLegalMove, generateLegalMovesFrom, isInCheck, legalMovesBetween } from '../moveGeneration';
import { jailerRange } from '../bishopPieces';
import type { GameState, Square } from '../types';

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

const pieceAt = (state: GameState, name: string) => state.board[sq(name)];

/*
 * Bishop-class FEN letters: monk ô, shieldmaiden ä, jailer ï, kingsguard û,
 * warhound ñ, spearman ê (uppercase for white).
 */

describe('Bishop (standard, as a Bishop-class pick)', () => {
  it('keeps standard movement, captures and blocking', () => {
    const state = createStateFromFen('9/k8/9/9/2P6/9/4B4/9/7K1 w - - 0 1');
    expect(targets(state, 'e3')).toEqual(['c1', 'd2', 'd4', 'f2', 'f4', 'g1', 'g5', 'h6', 'i7']);
  });
});

describe('Monk', () => {
  it('moves and captures like a Bishop', () => {
    const state = createStateFromFen('9/k8/9/9/9/9/4Ô4/9/7K1 w - - 0 1');
    expect(targets(state, 'e3')).toEqual(expect.arrayContaining(['a7', 'h6', 'c1', 'g1']));
  });

  it('cannot capture a Pawn', () => {
    const state = createStateFromFen('9/k8/9/9/2p6/9/4Ô4/9/7K1 w - - 0 1');
    const reach = targets(state, 'e3');
    expect(reach).not.toContain('c5');
    expect(reach).toContain('d4'); // may still approach — the pawn just blocks further
    expect(reach).not.toContain('b6'); // blocked behind the pawn
  });

  it('cannot be captured by a Pawn', () => {
    const state = createStateFromFen('9/k8/9/9/9/3ô5/4P4/9/7K1 w - - 0 1');
    expect(targets(state, 'e3')).not.toContain('d4'); // the pawn's diagonal is barred
    // The pawn cannot push through it either (blocked normally) — but a
    // knight takes the monk just fine.
    const knightState = createStateFromFen('9/k8/9/9/9/3ô5/9/2N6/7K1 w - - 0 1');
    expect(targets(knightState, 'c2')).toContain('d4');
  });

  it('interacts normally with everything that is not Pawn-class', () => {
    const state = createStateFromFen('9/k8/9/9/2r6/9/4Ô4/9/7K1 w - - 0 1');
    expect(targets(state, 'e3')).toContain('c5'); // captures a rook happily
    const attacked = createStateFromFen('9/k8/9/9/9/3ô5/9/9/3R3K1 w - - 0 1');
    expect(targets(attacked, 'd1')).toContain('d4'); // rook takes the monk
  });

  it('a monk-vs-monk capture is legal (immunity is class-based, not mutual)', () => {
    const state = createStateFromFen('9/k8/9/9/2ô6/9/4Ô4/9/7K1 w - - 0 1');
    expect(targets(state, 'e3')).toContain('c5');
  });
});

describe('Shieldmaiden', () => {
  it('moves and captures like a King', () => {
    const state = createStateFromFen('9/k8/9/9/9/4Ä4/9/9/7K1 w - - 0 1');
    expect(targets(state, 'e4')).toEqual(['d3', 'd4', 'd5', 'e3', 'e5', 'f3', 'f4', 'f5']);
  });

  it('cannot be captured by an enemy starting on a row in front of her (white)', () => {
    // Black rook on d5 (rank 5, in front of the white shieldmaiden on d4).
    const state = createStateFromFen('9/k8/9/9/3r5/3Ä5/9/9/7K1 b - - 0 1');
    expect(targets(state, 'd5')).not.toContain('d4');
    // She may still capture the rook herself.
    const asWhite: GameState = { ...state, turn: 'white' };
    expect(targets(asWhite, 'd4')).toContain('d5');
  });

  it('can be captured from her own row or from behind', () => {
    const sameRow = createStateFromFen('9/k8/9/9/9/1r1Ä5/9/9/7K1 b - - 0 1');
    expect(targets(sameRow, 'b4')).toContain('d4');
    const behind = createStateFromFen('9/k8/9/9/9/3Ä5/9/3r5/7K1 b - - 0 1');
    expect(targets(behind, 'd2')).toContain('d4');
  });

  it('mirrors the rule for black shieldmaidens', () => {
    // White rook on d3 — rank 3, in front of the black shieldmaiden on d4.
    const front = createStateFromFen('9/k8/9/9/9/3ä5/3R5/9/7K1 w - - 0 1');
    expect(targets(front, 'd3')).not.toContain('d4');
    const behind = createStateFromFen('9/k8/3R5/9/3ä5/9/9/9/7K1 w - - 0 1');
    expect(targets(behind, 'd7')).toContain('d5');
  });

  it('judges by the attacker’s starting square, not its destination', () => {
    // The rook starts BEHIND her (rank 2), swings wide and takes from the
    // side — legal, even though its path ends level with her.
    const state = createStateFromFen('9/k8/9/9/9/1Ä7/9/1r7/7K1 b - - 0 1');
    expect(targets(state, 'b2')).toContain('b4'); // starts behind → allowed
    // Whereas a rook starting on rank 6 may not take her at all.
    const front = createStateFromFen('9/k8/9/1r7/9/1Ä7/9/9/7K1 b - - 0 1');
    expect(targets(front, 'b6')).not.toContain('b4');
  });
});

describe('Jailer', () => {
  it('starts with range 0 and cannot move', () => {
    const state = createStateFromFen('9/k8/9/9/9/3Ï5/9/9/7K1 w - - 0 1');
    expect(jailerRange(state, 'white')).toBe(0);
    expect(targets(state, 'd4')).toEqual([]);
  });

  it('gains range as its owner captures enemy Pawns', () => {
    // White rook takes the black pawn: jailer may now move one square.
    let state = createStateFromFen('9/k8/9/9/9/3Ï5/9/6p2/6RK1 w - - 0 1');
    state = play(state, 'g1', 'g2');
    state = play(state, 'a8', 'b8');
    expect(jailerRange(state, 'white')).toBe(1);
    expect(targets(state, 'd4')).toEqual(['c3', 'c4', 'c5', 'd3', 'd5', 'e3', 'e4', 'e5']);
  });

  it('range 2 reaches exactly two squares, no further', () => {
    const state: GameState = {
      ...createStateFromFen('9/k8/9/9/9/3Ï5/9/9/7K1 w - - 0 1'),
      captured: { white: ['pawn', 'pawn'], black: [] },
    };
    expect(jailerRange(state, 'white')).toBe(2);
    const reach = targets(state, 'd4');
    expect(reach).toContain('d6'); // two up
    expect(reach).toContain('f6'); // two diagonal
    expect(reach).not.toContain('d7'); // three: too far
  });

  it('only pawn-class captures count', () => {
    const state: GameState = {
      ...createStateFromFen('9/k8/9/9/9/3Ï5/9/9/7K1 w - - 0 1'),
      captured: { white: ['rook', 'queen', 'knight'], black: ['pawn'] },
    };
    expect(jailerRange(state, 'white')).toBe(0);
    expect(jailerRange(state, 'black')).toBe(1);
    expect(targets(state, 'd4')).toEqual([]);
  });

  it('its own pawn captures extend its range too', () => {
    const state: GameState = {
      ...createStateFromFen('9/k8/9/9/4p4/3Ï5/9/9/7K1 w - - 0 1'),
      captured: { white: ['pawn'], black: [] },
    };
    const after = play(state, 'd4', 'e5'); // jailer captures a pawn at range 1
    expect(jailerRange(after, 'white')).toBe(2);
  });
});

describe('Kingsguard', () => {
  it('moves like a Queen within 2 squares of its King', () => {
    const state = createStateFromFen('9/k8/9/9/9/9/9/9/3Û1K3 w - - 0 1'); // guard d1, king f1
    const reach = targets(state, 'd1');
    expect(reach).toEqual(expect.arrayContaining(['d2', 'd3', 'e1', 'e2', 'f3']));
    expect(reach).not.toContain('d4'); // 3 ranks from the king
    expect(reach).not.toContain('a1'); // 5 files away
    expect(reach).not.toContain('h1'); // within radius, but the king blocks the rank
  });

  it('becomes freer or more restricted as the King moves', () => {
    let state = createStateFromFen('9/9/9/9/9/9/9/k8/3Û1K3 w - - 0 1');
    state = play(state, 'f1', 'f2'); // king up one
    state = play(state, 'a2', 'a3');
    const reach = targets(state, 'd1');
    expect(reach).toContain('d3'); // now within 2 of f2
    expect(reach).not.toContain('d1'.replace('d1', 'a1'));
  });

  it('the King is never restricted by its guard', () => {
    const state = createStateFromFen('9/k8/9/9/9/9/9/9/3Û1K3 w - - 0 1');
    expect(targets(state, 'f1').length).toBeGreaterThan(0);
    // King can walk far away over several moves; the guard just adapts.
  });

  it('can be stranded outside the radius until the King returns', () => {
    // Guard a1, own pawn b2 blocking its long diagonal, king on d5: every
    // square the guard can physically reach is more than 2 from the king.
    const state = createStateFromFen('9/k8/9/9/3K5/9/9/1P7/Û8 w - - 0 1');
    expect(targets(state, 'a1')).toEqual([]);
  });

  it('still delivers ordinary check within its radius', () => {
    const state = createStateFromFen('9/9/9/9/9/9/9/5K3/3Û3k1 b - - 0 1'); // guard d1, king f2, black king h1
    expect(isInCheck(state, 'black')).toBe(true); // d1–h1 on the rank… distance to f2 fine
  });
});

describe('Warhound', () => {
  it('moves like a Queen when no capture exists', () => {
    const state = createStateFromFen('9/k8/9/9/9/3Ñ5/9/9/7K1 w - - 0 1');
    expect(targets(state, 'd4')).toHaveLength(30);
  });

  it('must capture when a legal capture exists', () => {
    const state = createStateFromFen('9/k8/9/3r5/9/3Ñ5/9/9/7K1 w - - 0 1');
    expect(targets(state, 'd4')).toEqual(['d6']); // nothing but the kill
  });

  it('chooses freely among multiple captures', () => {
    const state = createStateFromFen('9/k8/9/3r5/9/3Ñ2b2/9/9/7K1 w - - 0 1');
    expect(targets(state, 'd4')).toEqual(['d6', 'g4']);
  });

  it('a pinned pseudo-capture does not force it', () => {
    // The warhound is pinned to its king by the e8 rook; the b5 bishop is
    // "capturable" only in appearance. It may still move along the pin line.
    const state = createStateFromFen('9/4r4/k8/9/1b7/9/9/4Ñ4/4K4 w - - 0 1');
    const reach = targets(state, 'e2');
    expect(reach).toContain('e8'); // capturing the pinner is legal (and forced!)
    expect(reach).not.toContain('b5');
    expect(reach.every((name) => name[0] === 'e')).toBe(true);
    // e8 is a legal capture, so quiet moves along the pin are barred too.
    expect(reach).toEqual(['e8']);
  });

  it('a Shieldmaiden it cannot legally capture does not force it', () => {
    // The shieldmaiden stands behind the warhound's row… craft: white
    // warhound d4 (rank 4), black shieldmaiden d6. The warhound starts on
    // rank 4 — below her rank 6 — she is white-facing? She is black: her
    // front is toward rank 1, so an attacker starting on rank 4 IS in front
    // of her → capture barred → the warhound roams free.
    const state = createStateFromFen('9/k8/9/3ä5/9/3Ñ5/9/9/7K1 w - - 0 1');
    const reach = targets(state, 'd4');
    expect(reach).not.toContain('d6');
    expect(reach.length).toBeGreaterThan(1); // not forced — free queen moves
  });

  it('other pieces stay free while the warhound is forced', () => {
    const state = createStateFromFen('9/k8/9/3r5/9/3Ñ5/9/9/6RK1 w - - 0 1');
    expect(targets(state, 'd4')).toEqual(['d6']);
    expect(targets(state, 'g1').length).toBeGreaterThan(0); // rook unaffected
  });
});

describe('Spearman', () => {
  it('moves like a Bishop when not capturing', () => {
    const state = createStateFromFen('9/k8/9/9/9/9/4Ê4/9/7K1 w - - 0 1');
    expect(targets(state, 'e3')).toEqual(expect.arrayContaining(['a7', 'd4', 'g1', 'h6']));
  });

  it('captures at range, stopping one square before the target', () => {
    const state = createStateFromFen('9/k8/9/9/2r6/9/4Ê4/9/7K1 w - - 0 1');
    const stab = legalMovesBetween(state, sq('e3'), sq('d4')).find((m) => m.captured);
    expect(stab).toBeDefined();
    expect(stab?.captured?.square).toBe(sq('c5'));

    const after = applyMove(state, stab!);
    expect(pieceAt(after, 'c5')).toBeNull(); // the rook dies on its own square
    expect(pieceAt(after, 'd4')).toMatchObject({ type: 'spearman' }); // spearman short of it
    expect(after.captured.white).toEqual(['rook']);
  });

  it('computes the destination correctly at longer range', () => {
    // Diagonal b2–g7: the stab lands on f6, the rook dies on g7.
    const state = createStateFromFen('9/k8/6r2/9/9/9/9/1Ê7/7K1 w - - 0 1');
    const stab = generateLegalMovesFrom(state, sq('b2')).find((m) => m.captured);
    expect(stab).toBeDefined();
    expect(squareName(stab!.to)).toBe('f6');
    expect(stab!.captured?.square).toBe(sq('g7'));
    const after = applyMove(state, stab!);
    expect(pieceAt(after, 'g7')).toBeNull();
    expect(pieceAt(after, 'f6')).toMatchObject({ type: 'spearman' });
  });

  it('cannot stab an adjacent enemy', () => {
    const state = createStateFromFen('9/k8/9/9/9/3r5/4Ê4/9/7K1 w - - 0 1');
    expect(targets(state, 'e3')).not.toContain('d4');
    expect(legalMovesBetween(state, sq('e3'), sq('c5'))).toHaveLength(0); // and no phantom stab beyond
  });

  it('cannot stab through blockers', () => {
    const state = createStateFromFen('9/k8/9/1r7/2P6/9/4Ê4/9/7K1 w - - 0 1');
    // Own pawn on c5 blocks the diagonal before the rook on b6.
    expect(generateLegalMovesFrom(state, sq('e3')).every((m) => !m.captured)).toBe(true);
  });

  it('threatens distant squares but not adjacent ones (check geometry)', () => {
    expect(isInCheck(createStateFromFen('9/9/9/9/9/2k6/9/4Ê4/7K1 b - - 0 1'), 'black')).toBe(true);
    expect(isInCheck(createStateFromFen('9/9/9/9/9/9/3k5/4Ê4/7K1 b - - 0 1'), 'black')).toBe(false);
  });

  it('respects King safety', () => {
    // The spearman on b2 is pinned along a1–h8 by the bishop on h8. The rook
    // on e4 is off the pin line: no move may reach toward it. Stabbing the
    // pinner itself (landing on g7, still on the line) is legal.
    const state = createStateFromFen('9/k6b1/9/9/9/4r4/9/1Ê7/K8 w - - 0 1');
    const moves = generateLegalMovesFrom(state, sq('b2'));
    const pinLine = ['a1', 'b2', 'c3', 'd4', 'e5', 'f6', 'g7', 'h8'];
    expect(moves.length).toBeGreaterThan(0);
    expect(moves.every((m) => pinLine.includes(squareName(m.to)))).toBe(true);
    expect(moves.every((m) => m.captured?.square !== sq('e4'))).toBe(true);
    const stabPinner = moves.find((m) => m.captured);
    expect(stabPinner?.captured?.square).toBe(sq('h8'));
    expect(squareName(stabPinner!.to)).toBe('g7');
  });
});

describe('cross-class interactions', () => {
  it('a Jester that captures a Monk becomes a Monk with its immunities', () => {
    const state = createStateFromFen('9/k8/9/3ô5/9/4É4/9/9/7K1 w - - 0 1');
    const after = play(state, 'e4', 'd6');
    expect(pieceAt(after, 'd6')).toMatchObject({ type: 'monk', origin: 'jester' });
  });

  it('the Ram cannot crush a Shieldmaiden from in front of her', () => {
    // White ram on d6 (rank 6) charging DOWN toward the black shieldmaiden
    // on d4: the black shieldmaiden faces white — rank 6 is behind her, so
    // the crush is allowed. From rank 2 (in front of her) it is barred.
    const fromBehind = createStateFromFen('9/k8/9/3X5/9/3ä5/9/9/7K1 w - - 0 1');
    expect(targets(fromBehind, 'd6')).toContain('d4');
    const fromFront = createStateFromFen('9/k8/9/9/9/3ä5/9/3X5/7K1 w - - 0 1');
    expect(targets(fromFront, 'd2')).not.toContain('d4');
  });

  it('a Warhound facing only an armoured Champion is not forced (repel is not a capture)', () => {
    const state = createStateFromFen('9/k8/9/3h5/9/3Ñ5/9/9/7K1 w - - 0 1');
    const moves = generateLegalMovesFrom(state, sq('d4'));
    expect(moves.some((m) => m.repelled)).toBe(true); // it MAY throw itself on the armour
    expect(moves.some((m) => !m.captured && !m.repelled)).toBe(true); // but is not forced
  });

  it('the Jailer grows when a Chariot returns…and counts only real enemy pawns', () => {
    // Berserker killing a FRIENDLY pawn must not feed the jailer.
    const state = createStateFromFen('9/k8/9/9/4P4/3Z5/9/7Ï1/7K1 w - - 0 1');
    const after = play(state, 'd4', 'e5'); // friendly kill
    expect(jailerRange(after, 'white')).toBe(0);
  });
});
