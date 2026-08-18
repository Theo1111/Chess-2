import { describe, expect, it } from 'vitest';
import '../customPieces'; // registers Queen-class (Champion needed for interactions)
import '../rookPieces'; // registers the Rook-class definitions
import { parseSquareName, squareName } from '../board';
import { applyMove, createStateFromFen } from '../game';
import {
  findLegalMove,
  generateLegalMovesFrom,
  isInCheck,
  legalMovesBetween,
} from '../moveGeneration';
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
 * Rook-class FEN letters: berserker z, leper l, archer f, battering-ram x,
 * catapult o, jouster j. (Queen-class letters as in customPieces.test.)
 */

describe('Berserker', () => {
  it('cannot make a non-capturing move', () => {
    const state = createStateFromFen('9/k8/9/9/9/3Z5/9/9/4K4 w - - 0 1');
    expect(targets(state, 'd4')).toEqual([]);
  });

  it('captures like a Queen', () => {
    // Enemy rook up the file, enemy pawn on a diagonal, enemy knight off-line.
    const state = createStateFromFen('9/k8/9/3r5/4p4/3Z5/1n7/9/4K4 w - - 0 1');
    expect(targets(state, 'd4')).toEqual(['d6', 'e5']);
  });

  it('is blocked like a Queen', () => {
    // Pawn on d5 shields the rook on d6.
    const state = createStateFromFen('9/k8/9/3r5/3p5/3Z5/9/9/4K4 w - - 0 1');
    expect(targets(state, 'd4')).toContain('d5');
    expect(targets(state, 'd4')).not.toContain('d6');
  });

  it('can capture friendly pieces, recorded as a loss rather than a capture', () => {
    const state = createStateFromFen('9/k8/9/9/4P4/3Z5/9/9/4K4 w - - 0 1');
    expect(targets(state, 'd4')).toContain('e5');

    const after = play(state, 'd4', 'e5');
    expect(pieceAt(after, 'e5')).toMatchObject({ type: 'berserker', color: 'white' });
    expect(after.captured.white).toEqual([]); // no capture credited to anyone
    expect(after.captured.black).toEqual([]);
    expect(after.reserves.white).toEqual(['pawn']); // but the pawn is lost
  });

  it('cannot capture its own King', () => {
    const state = createStateFromFen('9/k8/9/9/9/9/9/3K5/3Z5 w - - 0 1');
    expect(targets(state, 'd1')).not.toContain('d2');
  });

  it('cannot expose its own King', () => {
    // Berserker on e2 is pinned by the rook on e8; the pawn on d3 is bait.
    const state = createStateFromFen('9/k3r4/9/9/9/9/3p5/4Z4/4K4 w - - 0 1');
    expect(targets(state, 'e2')).toEqual(['e8']); // may only capture along the pin
  });
});

describe('Leper', () => {
  it('moves and captures like a Queen when isolated', () => {
    const state = createStateFromFen('9/k8/9/9/9/3L5/9/9/7K1 w - - 0 1');
    // 30 queen squares minus g1, which is adjacent to the friendly king on h1.
    const reach = targets(state, 'd4');
    expect(reach).toHaveLength(29);
    expect(reach).toContain('a1');
    expect(reach).toContain('h8');
    expect(reach).not.toContain('g1');
  });

  it('captures at range', () => {
    const state = createStateFromFen('9/k8/9/9/9/3L3r1/9/9/7K1 w - - 0 1');
    expect(targets(state, 'd4')).toContain('h4');
  });

  it('cannot end adjacent to a friendly piece', () => {
    // White pawn f6: every square around it is forbidden ground.
    const state = createStateFromFen('9/k8/9/5P3/9/3L5/9/9/7K1 w - - 0 1');
    const reach = targets(state, 'd4');
    expect(reach).not.toContain('e5'); // adjacent to f6
    expect(reach).not.toContain('g7'); // adjacent to f6
    expect(reach).toContain('d5'); // not adjacent
    expect(reach).toContain('c4');
  });

  it('counts its own King as a friendly piece', () => {
    const state = createStateFromFen('9/k8/9/9/9/3L5/9/9/K8 w - - 0 1');
    expect(targets(state, 'd4')).not.toContain('b2'); // adjacent to Ka1
    expect(targets(state, 'd4')).toContain('c3');
  });

  it('may pass through forbidden squares as long as it does not stop there', () => {
    // Own king on d5: e4/e5/e6 are forbidden ground, but the e-file run from
    // e1 continues straight through them to e7 and e8.
    const state = createStateFromFen('9/k8/9/9/3K5/9/9/9/4L4 w - - 0 1');
    const reach = targets(state, 'e1');
    expect(reach).toContain('e2');
    expect(reach).toContain('e3');
    expect(reach).not.toContain('e4');
    expect(reach).not.toContain('e5');
    expect(reach).not.toContain('e6');
    expect(reach).toContain('e7');
    expect(reach).toContain('e8');
  });

  it('still respects King safety', () => {
    // Leper on e2 pinned by the rook on e8 must stay on the e-file.
    const state = createStateFromFen('9/4r4/k8/9/9/9/9/4L4/4K4 w - - 0 1');
    const reach = targets(state, 'e2');
    expect(reach.every((name) => name[0] === 'e')).toBe(true);
    expect(reach).not.toContain('e1'); // own king there
  });
});

describe('Archer', () => {
  it('moves like a King', () => {
    const state = createStateFromFen('9/k8/9/9/9/3F5/9/9/7K1 w - - 0 1');
    expect(targets(state, 'd4')).toEqual(['c3', 'c4', 'c5', 'd3', 'd5', 'e3', 'e4', 'e5']);
  });

  it('captures at Queen range but never adjacent', () => {
    // Enemy rook 3 squares up, enemy pawn adjacent.
    const state = createStateFromFen('9/k8/9/3r5/9/3F5/2p6/9/7K1 w - - 0 1');
    const reach = targets(state, 'd4');
    expect(reach).toContain('d6'); // distant capture
    expect(reach).not.toContain('c3'); // adjacent enemy: neither capture nor step
  });

  it('an adjacent piece blocks the line behind it', () => {
    // Enemy pawn on d5 stands in front of the rook on d7.
    const state = createStateFromFen('9/k8/9/3r5/3p5/3F5/9/9/7K1 w - - 0 1');
    const reach = targets(state, 'd4');
    expect(reach).not.toContain('d5');
    expect(reach).not.toContain('d6');
    expect(reach).not.toContain('d7');
  });

  it('does not give check to an adjacent King', () => {
    const adjacent = createStateFromFen('9/9/9/9/9/3Fk4/9/9/7K1 b - - 0 1');
    expect(isInCheck(adjacent, 'black')).toBe(false);
    const distant = createStateFromFen('9/9/9/9/9/3F2k2/9/9/7K1 b - - 0 1');
    expect(isInCheck(distant, 'black')).toBe(true);
  });

  it('still respects King safety', () => {
    // Archer pinned on e2: it may step up the pin line or shoot the pinner,
    // but never leave the e-file.
    const state = createStateFromFen('9/4r4/k8/9/9/9/9/4F4/4K4 w - - 0 1');
    expect(targets(state, 'e2')).toEqual(['e3', 'e8']);
  });
});

describe('Battering Ram', () => {
  it('moves exactly two squares orthogonally', () => {
    const state = createStateFromFen('9/k8/9/9/9/3X5/9/9/7K1 w - - 0 1');
    expect(targets(state, 'd4')).toEqual(['b4', 'd2', 'd6', 'f4']);
  });

  it('has no moves that would land off the board', () => {
    const state = createStateFromFen('9/k8/9/9/9/9/9/9/X6K1 w - - 0 1');
    expect(targets(state, 'a1')).toEqual(['a3', 'c1']);
  });

  it('captures the piece on its destination', () => {
    const state = createStateFromFen('9/k8/9/9/9/3X1r3/9/9/7K1 w - - 0 1');
    const after = play(state, 'd4', 'f4');
    expect(pieceAt(after, 'f4')).toMatchObject({ type: 'battering-ram' });
    expect(after.captured.white).toEqual(['rook']);
  });

  it('crushes the piece it passes through', () => {
    const state = createStateFromFen('9/k8/9/9/9/3Xr4/9/9/7K1 w - - 0 1');
    const move = legalMovesBetween(state, sq('d4'), sq('f4'))[0];
    expect(move?.extraCaptures).toHaveLength(1);
    expect(move?.captured).toBeUndefined();

    const after = applyMove(state, move!);
    expect(pieceAt(after, 'e4')).toBeNull();
    expect(pieceAt(after, 'f4')).toMatchObject({ type: 'battering-ram' });
    expect(after.captured.white).toEqual(['rook']);
    expect(after.history.at(-1)?.san).toBe('Xxf4');
  });

  it('can destroy two pieces in one move', () => {
    const state = createStateFromFen('9/k8/9/9/9/3Xrn3/9/9/7K1 w - - 0 1');
    const after = play(state, 'd4', 'f4');
    expect(pieceAt(after, 'e4')).toBeNull();
    expect(pieceAt(after, 'f4')).toMatchObject({ type: 'battering-ram' });
    expect(after.captured.white).toEqual(expect.arrayContaining(['rook', 'knight']));
  });

  it('destroys friendly pieces as losses, not captures', () => {
    const state = createStateFromFen('9/k8/9/9/9/3XP4/9/9/7K1 w - - 0 1');
    const after = play(state, 'd4', 'f4');
    expect(pieceAt(after, 'e4')).toBeNull();
    expect(after.captured.white).toEqual([]);
    expect(after.reserves.white).toEqual(['pawn']);
  });

  it('threatens both squares of its path for check purposes', () => {
    // King two squares away: in check. King adjacent (path continues): in check.
    expect(isInCheck(createStateFromFen('9/9/9/9/9/3X1k3/9/9/7K1 b - - 0 1'), 'black')).toBe(true);
    expect(isInCheck(createStateFromFen('9/9/9/9/9/3Xk4/9/9/7K1 b - - 0 1'), 'black')).toBe(true);
    // Diagonal: never.
    expect(isInCheck(createStateFromFen('9/9/9/9/4k4/3X5/9/9/7K1 b - - 0 1'), 'black')).toBe(false);
    // Adjacent, but the two-square destination is off the board: safe.
    expect(isInCheck(createStateFromFen('9/9/9/9/9/7Xk/9/9/K8 b - - 0 1'), 'black')).toBe(false);
  });

  it('cannot crush its own King', () => {
    const state = createStateFromFen('9/k8/9/9/9/9/9/3K5/3X5 w - - 0 1');
    expect(targets(state, 'd1')).not.toContain('d3');
  });
});

describe('Catapult', () => {
  it('moves like a Rook but cannot capture directly', () => {
    // Enemy rook straight ahead with nothing between: unreachable.
    const state = createStateFromFen('9/k8/9/3r5/9/3O5/9/9/7K1 w - - 0 1');
    const reach = targets(state, 'd4');
    expect(reach).toContain('d5');
    expect(reach).not.toContain('d6'); // no screen, no capture
    expect(reach).toContain('a4');
    expect(reach).not.toContain('e5'); // no diagonals
  });

  it('captures by launching over one screen piece', () => {
    // Screen on d5 (own pawn), enemy rook on d7.
    const state = createStateFromFen('9/k8/3r5/9/3P5/3O5/9/9/7K1 w - - 0 1');
    const after = play(state, 'd4', 'd7');
    expect(pieceAt(after, 'd7')).toMatchObject({ type: 'catapult' });
    expect(pieceAt(after, 'd5')).toMatchObject({ type: 'pawn' }); // screen untouched
    expect(after.captured.white).toEqual(['rook']);
  });

  it('an enemy piece can serve as the screen', () => {
    const state = createStateFromFen('9/k8/3r5/9/3p5/3O5/9/9/7K1 w - - 0 1');
    expect(targets(state, 'd4')).toContain('d7');
    expect(targets(state, 'd4')).not.toContain('d5'); // blocked for quiet movement
  });

  it('cannot capture a friendly piece beyond the screen', () => {
    const state = createStateFromFen('9/k8/3P5/9/3p5/3O5/9/9/7K1 w - - 0 1');
    expect(targets(state, 'd4')).not.toContain('d7');
  });

  it('only the first piece beyond the screen can be taken', () => {
    // Screen d5, enemy knight d6, enemy rook d7: only the knight is in reach.
    const state = createStateFromFen('9/k8/3r5/3n5/3P5/3O5/9/9/7K1 w - - 0 1');
    const reach = targets(state, 'd4');
    expect(reach).toContain('d6');
    expect(reach).not.toContain('d7');
  });

  it('gives check over a screen and respects King safety', () => {
    const overScreen = createStateFromFen('9/3k5/9/9/3p5/3O5/9/9/7K1 b - - 0 1');
    expect(isInCheck(overScreen, 'black')).toBe(true);
    const noScreen = createStateFromFen('9/3k5/9/9/9/3O5/9/9/7K1 b - - 0 1');
    expect(isInCheck(noScreen, 'black')).toBe(false);
  });
});

describe('Jouster', () => {
  it('has exactly one destination per direction on an empty board', () => {
    const state = createStateFromFen('9/9/9/9/9/3J5/9/9/K6k1 w - - 0 1');
    // Terminals on the 9×9 board: edges d9/d1/a4/i4, diagonal edges i9/a7/g1,
    // and b2 — halting just before the friendly king on a1.
    expect(targets(state, 'd4')).toEqual(['d9', 'd1', 'a4', 'i4', 'a7', 'i9', 'b2', 'g1'].sort());
  });

  it('cannot stop voluntarily', () => {
    const state = createStateFromFen('9/9/9/9/9/3J5/9/9/K6k1 w - - 0 1');
    expect(targets(state, 'd4')).not.toContain('d5'); // mid-line squares unreachable
    expect(targets(state, 'd4')).not.toContain('e4');
  });

  it('halts just before a friendly piece', () => {
    const state = createStateFromFen('9/9/3P5/9/9/3J5/9/9/K6k1 w - - 0 1');
    const reach = targets(state, 'd4');
    expect(reach).toContain('d6'); // stops short of the pawn on d7
    expect(reach).not.toContain('d7');
    expect(reach).not.toContain('d8');
  });

  it('has no move in a direction where a friendly piece is adjacent', () => {
    const state = createStateFromFen('9/9/9/9/3P5/3J5/9/9/K6k1 w - - 0 1');
    expect(targets(state, 'd4').every((name) => name !== 'd5')).toBe(true);
  });

  it('captures the first enemy in its path and cannot pass through it', () => {
    const state = createStateFromFen('9/3r5/9/3n5/9/3J5/9/9/K6k1 w - - 0 1');
    const reach = targets(state, 'd4');
    expect(reach).toContain('d6'); // captures the knight
    expect(reach).not.toContain('d5'); // cannot stop early
    expect(reach).not.toContain('d7'); // cannot fly past it
    expect(reach).not.toContain('d8');

    const after = play(state, 'd4', 'd6');
    expect(pieceAt(after, 'd6')).toMatchObject({ type: 'jouster' });
    expect(after.captured.white).toEqual(['knight']);
  });

  it('attacks like a Queen for check purposes', () => {
    // The king is the first enemy piece along the file: it is in check even
    // though the jouster "cannot stop" elsewhere on that line.
    const state = createStateFromFen('9/3k5/9/9/9/3J5/9/9/K8 b - - 0 1');
    expect(isInCheck(state, 'black')).toBe(true);
  });

  it('still respects King safety', () => {
    // Jouster on e2 is pinned: leaving the e-file is illegal, and along the
    // file its forced destination is the pinning rook itself.
    const state = createStateFromFen('9/4r4/k8/9/9/9/9/4J4/4K4 w - - 0 1');
    expect(targets(state, 'e2')).toEqual(['e8']);
  });
});

describe('Rook (standard, as a Rook-class pick)', () => {
  it('keeps standard rook behaviour', () => {
    const state = createStateFromFen('9/k8/9/9/9/2r1R1P2/9/9/4K4 w - - 0 1');
    expect(targets(state, 'e4')).toEqual([
      'c4', 'd4', 'e2', 'e3', 'e5', 'e6', 'e7', 'e8', 'e9', 'f4',
    ]);
  });
});

describe('interactions with Queen-class pieces', () => {
  it('a Berserker attacking a Champion is repelled by its armour', () => {
    const state = createStateFromFen('9/k8/9/9/9/3Z3h1/9/9/4K4 w - - 0 1');
    const attack = legalMovesBetween(state, sq('d4'), sq('h4'))[0];
    expect(attack?.repelled).toBe(true);

    const after = applyMove(state, attack!);
    expect(pieceAt(after, 'h4')).toMatchObject({ type: 'champion', hitPoints: 1 });
    expect(pieceAt(after, 'd4')).toBeNull();
    expect(after.captured.black).toEqual(['berserker']);
  });

  it('a Berserker destroying its own Champion is repelled without crediting anyone', () => {
    const state = createStateFromFen('9/k8/9/9/9/3Z3H1/9/9/4K4 w - - 0 1');
    const attack = legalMovesBetween(state, sq('d4'), sq('h4'))[0];
    expect(attack?.repelled).toBe(true);

    const after = applyMove(state, attack!);
    expect(pieceAt(after, 'h4')).toMatchObject({ type: 'champion', hitPoints: 1, color: 'white' });
    expect(after.captured.white).toEqual([]);
    expect(after.captured.black).toEqual([]);
    expect(after.reserves.white).toEqual(['berserker']);
  });

  it('a Ram crushing a friendly pawn feeds the Chariot reserve', () => {
    const state = createStateFromFen('9/k8/9/9/9/3XP4/9/9/2C4K1 w - - 0 1');
    const after = play(state, 'd4', 'f4');
    expect(after.reserves.white).toEqual(['pawn']);
    // The Chariot can now offer to return that pawn when it moves.
    const options = legalMovesBetween(after, sq('c1'), sq('c4'));
    expect(options).toHaveLength(2);
    expect(options.some((option) => option.returns?.type === 'pawn')).toBe(true);
  });
});
