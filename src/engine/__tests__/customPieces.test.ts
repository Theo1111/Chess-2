import { describe, expect, it } from 'vitest';
import '../customPieces'; // registers the Queen-class definitions
import { parseSquareName, squareName } from '../board';
import { createStateFromFen, applyMove, skipBonusMove } from '../game';
import {
  findLegalMove,
  generateLegalMoves,
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
 * Custom piece FEN letters: archbishop a, trapper t, revolutionary v,
 * duelist d, chariot c, champion h, avenger e, general g, diplomat m,
 * infiltrator i, warrior w.
 */

describe('Archbishop', () => {
  const FEN = '9/k8/9/9/4R4/3A5/9/9/4K4 w - - 0 1';

  it('moves and captures one square diagonally', () => {
    expect(targets(createStateFromFen('9/k8/9/9/9/3A5/9/9/4K4 w - - 0 1'), 'd4')).toEqual([
      'c3', 'c5', 'e3', 'e5',
    ]);
  });

  it('grants Bishop movement to diagonally adjacent friendly pieces', () => {
    const reach = targets(createStateFromFen(FEN), 'e5');
    // The rook on e5 touches the Archbishop on d4 and gains the diagonals.
    expect(reach).toEqual(expect.arrayContaining(['f6', 'g7', 'h8', 'd6', 'c7', 'b8', 'f4', 'h2']));
    // Its own rook movement is untouched.
    expect(reach).toEqual(expect.arrayContaining(['e6', 'e4', 'a5']));
  });

  it('does not grant movement to pieces that are not diagonally adjacent', () => {
    // The rook on a1 is nowhere near the Archbishop on d4.
    const state = createStateFromFen('9/k8/9/9/9/3A5/9/9/R3K4 w - - 0 1');
    expect(targets(state, 'a1')).not.toEqual(expect.arrayContaining(['b2', 'c3']));
  });

  it('granted movement gives real check', () => {
    // Rook on b7 is diagonally adjacent to the Archbishop on a6 and so checks
    // the king on f3 along the b7-f3 diagonal.
    const state = createStateFromFen('9/9/1R7/A8/9/9/5k3/9/4K4 b - - 0 1');
    expect(isInCheck(state, 'black')).toBe(true);
  });
});

describe('Trapper', () => {
  it('moves like a Queen but cannot capture', () => {
    const state = createStateFromFen('9/k8/9/9/3r5/3T5/9/9/4K4 w - - 0 1');
    const reach = targets(state, 'd4');
    expect(reach).toEqual(expect.arrayContaining(['d3', 'a4', 'h4', 'g7']));
    expect(reach).not.toContain('d5'); // the enemy rook cannot be taken
  });

  it('immobilizes adjacent enemy pieces', () => {
    const state = createStateFromFen('9/k8/9/9/3r5/3T5/9/9/4K4 b - - 0 1');
    expect(targets(state, 'd5')).toEqual([]);
    expect(generateLegalMoves(state).every((move) => move.from !== sq('d5'))).toBe(true);
  });

  it('leaves enemy pieces that are not adjacent alone', () => {
    const state = createStateFromFen('9/k8/9/3r5/9/3T5/9/9/4K4 b - - 0 1');
    expect(targets(state, 'd6').length).toBeGreaterThan(0);
  });

  it('does not immobilize an enemy Trapper', () => {
    const state = createStateFromFen('9/k8/9/9/3t5/3T5/9/9/4K4 b - - 0 1');
    expect(targets(state, 'd5').length).toBeGreaterThan(0);
  });

  it('a trapped piece no longer gives check', () => {
    // The rook on e4 would check the king on e1, but the Trapper on d4 holds it.
    const trapped = createStateFromFen('9/k8/9/9/9/3Tr4/9/9/4K4 w - - 0 1');
    expect(isInCheck(trapped, 'white')).toBe(false);
    const free = createStateFromFen('9/k8/9/9/9/4r4/9/9/4K4 w - - 0 1');
    expect(isInCheck(free, 'white')).toBe(true);
  });
});

describe('Revolutionary', () => {
  const FEN = '4k4/1V7/9/9/9/9/9/9/4K4 w - - 0 1';

  it('moves like a Knight', () => {
    expect(targets(createStateFromFen(FEN), 'b8')).toEqual(['a6', 'c6', 'd7', 'd9']);
  });

  it("offers a sacrifice-and-swap variant on the opponent's back row", () => {
    const state = createStateFromFen(FEN);
    const toBackRow = legalMovesBetween(state, sq('b8'), sq('d9'));
    expect(toBackRow).toHaveLength(2);
    expect(toBackRow.some((move) => move.special === 'defect')).toBe(true);

    const elsewhere = legalMovesBetween(state, sq('b8'), sq('d7'));
    expect(elsewhere).toHaveLength(1);
  });

  it('swapping sides trades both armies and removes the Revolutionary', () => {
    const state = createStateFromFen('4k2r1/1V7/9/9/9/9/9/6P2/4K4 w - - 0 1');
    const defect = legalMovesBetween(state, sq('b8'), sq('d9')).find((m) => m.special === 'defect');
    const after = applyMove(state, defect!);

    expect(pieceAt(after, 'd9')).toBeNull(); // sacrificed
    expect(pieceAt(after, 'e9')).toMatchObject({ type: 'king', color: 'white' });
    expect(pieceAt(after, 'h9')).toMatchObject({ type: 'rook', color: 'white' });
    expect(pieceAt(after, 'e1')).toMatchObject({ type: 'king', color: 'black' });
    expect(pieceAt(after, 'g2')).toMatchObject({ type: 'pawn', color: 'black' });
    expect(after.turn).toBe('black');
  });
});

describe('Duelist', () => {
  const FEN = '9/4k4/9/9/9/9/9/3D5/4K4 w - - 0 1';

  it('moves like a King', () => {
    expect(targets(createStateFromFen(FEN), 'd2')).toEqual([
      'c1', 'c2', 'c3', 'd1', 'd3', 'e2', 'e3',
    ]);
  });

  it('grants a free follow-up move that only it may play', () => {
    const state = play(createStateFromFen(FEN), 'e1', 'f1');
    expect(state.phase).toBe('bonus');
    expect(state.turn).toBe('white'); // still White's turn
    const bonus = generateLegalMoves(state);
    expect(bonus.length).toBeGreaterThan(0);
    expect(bonus.every((move) => move.piece === 'duelist' && move.bonus)).toBe(true);
  });

  it('can move twice in one turn', () => {
    let state = play(createStateFromFen(FEN), 'd2', 'd3'); // main move
    expect(state.phase).toBe('bonus');
    state = play(state, 'd3', 'd4'); // free move
    expect(state.phase).toBe('main');
    expect(state.turn).toBe('black');
    expect(pieceAt(state, 'd4')).toMatchObject({ type: 'duelist' });
    expect(state.history).toHaveLength(2);
  });

  it('lets the player decline the free move', () => {
    const state = skipBonusMove(play(createStateFromFen(FEN), 'e1', 'f1'));
    expect(state.phase).toBe('main');
    expect(state.turn).toBe('black');
  });

  it('free moves still obey legality — a pinned Duelist stays on the pin line', () => {
    const state = play(createStateFromFen('9/3rk4/9/9/9/9/9/3D2P2/3K5 w - - 0 1'), 'g2', 'g3');
    expect(state.phase).toBe('bonus');
    const files = generateLegalMoves(state).map((move) => squareName(move.to)[0]);
    expect(files.length).toBeGreaterThan(0);
    expect(files.every((file) => file === 'd')).toBe(true); // never off the d-file
  });

  it('offers no bonus phase when the Duelist has no legal free move', () => {
    // The Duelist in the corner is completely boxed in by its own army.
    const state = play(createStateFromFen('9/4k4/9/9/9/9/9/PP5P1/DK7 w - - 0 1'), 'h2', 'h3');
    expect(state.phase).toBe('main');
    expect(state.turn).toBe('black');
  });

  it('does not delay checkmate', () => {
    // Back-rank mate while a Duelist is also on the board: the game ends,
    // no free move is offered.
    const state = play(createStateFromFen('8k/7pp/9/9/9/9/9/3D5/R5K2 w - - 0 1'), 'a1', 'a9');
    expect(state.status).toBe('checkmate');
    expect(state.phase).toBe('main');
  });
});

describe('Chariot', () => {
  const base = createStateFromFen('9/4k4/9/9/9/9/9/9/3CK4 w - - 0 1');
  const withReserve: GameState = { ...base, reserves: { white: ['pawn'], black: [] } };

  it('moves like a Rook', () => {
    expect(targets(base, 'd1')).toEqual(expect.arrayContaining(['a1', 'd8', 'd4']));
  });

  it('offers no return when there are no captured pawns to return', () => {
    expect(legalMovesBetween(base, sq('d1'), sq('d4'))).toHaveLength(1);
  });

  it('offers a return variant when a captured pawn is available', () => {
    const options = legalMovesBetween(withReserve, sq('d1'), sq('d4'));
    expect(options).toHaveLength(2);
    expect(options.some((move) => move.returns?.type === 'pawn')).toBe(true);
  });

  it('returns the pawn to the square it left and spends the reserve', () => {
    const move = legalMovesBetween(withReserve, sq('d1'), sq('d4')).find((m) => m.returns);
    const after = applyMove(withReserve, move!);
    expect(pieceAt(after, 'd4')).toMatchObject({ type: 'chariot', color: 'white' });
    expect(pieceAt(after, 'd1')).toMatchObject({ type: 'pawn', color: 'white' });
    expect(after.reserves.white).toEqual([]);
  });

  it('captured pieces land in their owner’s reserves', () => {
    const state = createStateFromFen('9/4k4/9/9/9/3r5/9/9/3CK4 w - - 0 1');
    const after = play(state, 'd1', 'd4');
    expect(after.reserves.black).toEqual(['rook']);
    expect(after.captured.white).toEqual(['rook']);
  });
});

describe('Champion', () => {
  const FEN = '9/4k4/9/9/9/3r5/9/9/3HK4 b - - 0 1';

  it('starts with two hit points', () => {
    expect(pieceAt(createStateFromFen(FEN), 'd1')).toMatchObject({ type: 'champion', hitPoints: 2 });
  });

  it('survives the first attack and destroys the attacker', () => {
    const state = createStateFromFen(FEN);
    const attack = legalMovesBetween(state, sq('d4'), sq('d1'))[0];
    expect(attack?.repelled).toBe(true);

    const after = applyMove(state, attack!);
    expect(pieceAt(after, 'd1')).toMatchObject({ type: 'champion', hitPoints: 1 });
    expect(pieceAt(after, 'd4')).toBeNull();
    expect(after.captured.white).toEqual(['rook']); // white's Champion took the rook
  });

  it('falls to the second attack', () => {
    const damaged = createStateFromFen('9/4k4/9/9/9/3r5/9/9/3HK4 b - - 0 1');
    const wounded: GameState = {
      ...damaged,
      board: damaged.board.map((piece) =>
        piece?.type === 'champion' ? { ...piece, hitPoints: 1 } : piece,
      ),
    };
    const attack = legalMovesBetween(wounded, sq('d4'), sq('d1'))[0];
    expect(attack?.repelled).toBeUndefined();
    expect(attack?.captured?.type).toBe('champion');

    const after = applyMove(wounded, attack!);
    expect(pieceAt(after, 'd1')).toMatchObject({ type: 'rook', color: 'black' });
  });

  it('a King may not attack a Champion that would survive', () => {
    // Kd2xd1 would destroy the king itself, so it is not a legal move.
    const state = createStateFromFen('9/4k4/9/9/9/9/9/3K5/3h5 w - - 0 1');
    expect(targets(state, 'd2')).not.toContain('d1');
  });
});

describe('Avenger', () => {
  const FEN = '9/4k4/9/9/9/9/9/3N3r1/3EK4 b - - 0 1';

  it('cannot move while no friendly piece has been lost', () => {
    expect(targets(createStateFromFen(FEN), 'd1')).toEqual([]);
  });

  it('inherits the movement of friendly pieces as they are captured', () => {
    const state = play(createStateFromFen(FEN), 'h2', 'd2'); // black rook takes the knight
    expect(state.captured.black).toEqual(['knight']);
    // The Avenger now moves like a Knight.
    expect(targets(state, 'd1')).toEqual(['b2', 'c3', 'e3', 'f2']);
  });

  it('accumulates movement from every lost piece type', () => {
    const state = createStateFromFen('9/4k4/9/9/9/9/9/9/3EK4 w - - 0 1');
    const withLosses: GameState = {
      ...state,
      captured: { white: [], black: ['knight', 'bishop'] },
    };
    const reach = targets(withLosses, 'd1');
    expect(reach).toEqual(expect.arrayContaining(['b2', 'c3', 'e3', 'a4', 'h5']));
  });
});

describe('General', () => {
  const FEN = '9/4k4/9/9/9/3R5/9/6G2/4K4 w - - 0 1';

  it('moves like a King', () => {
    expect(targets(createStateFromFen(FEN), 'g2')).toEqual([
      'f1', 'f2', 'f3', 'g1', 'g3', 'h1', 'h2', 'h3',
    ]);
  });

  it('lets every friendly piece also step like a King', () => {
    const reach = targets(createStateFromFen(FEN), 'd4');
    expect(reach).toEqual(expect.arrayContaining(['c3', 'c5', 'e3', 'e5']));
  });

  it('the granted King step cannot capture', () => {
    // A black rook on e5 is diagonally adjacent to the white rook on d4.
    const state = createStateFromFen('9/4k4/9/9/4r4/3R5/9/6G2/4K4 w - - 0 1');
    expect(targets(state, 'd4')).not.toContain('e5');
  });

  it('the aura disappears when the General leaves the board', () => {
    const state = createStateFromFen('9/4k4/9/9/9/3R5/9/9/4K4 w - - 0 1');
    expect(targets(state, 'd4')).not.toContain('c3');
  });
});

describe('Diplomat', () => {
  it('jumps exactly two squares in the eight directions', () => {
    const state = createStateFromFen('9/4k4/9/9/9/3M5/9/9/4K4 w - - 0 1');
    expect(targets(state, 'd4')).toEqual(['b2', 'b4', 'b6', 'd2', 'd6', 'f2', 'f4', 'f6']);
  });

  it('converts the enemy piece it jumps over', () => {
    const state = createStateFromFen('9/4k4/9/9/9/9/3r5/3M5/4K4 w - - 0 1');
    const jump = legalMovesBetween(state, sq('d2'), sq('d4'))[0];
    expect(jump?.converts).toEqual([sq('d3')]);

    const after = applyMove(state, jump!);
    expect(pieceAt(after, 'd3')).toMatchObject({ type: 'rook', color: 'white' });
    expect(pieceAt(after, 'd4')).toMatchObject({ type: 'diplomat', color: 'white' });
  });

  it('leaves friendly pieces and Kings alone', () => {
    const overKing = createStateFromFen('9/9/9/9/9/9/3k5/3M5/4K4 w - - 0 1');
    expect(legalMovesBetween(overKing, sq('d2'), sq('d4'))[0]?.converts).toBeUndefined();

    const overFriend = createStateFromFen('9/4k4/9/9/9/9/3R5/3M5/4K4 w - - 0 1');
    expect(legalMovesBetween(overFriend, sq('d2'), sq('d4'))[0]?.converts).toBeUndefined();
  });
});

describe('Infiltrator', () => {
  it('moves like a Rook or a King', () => {
    const reach = targets(createStateFromFen('9/4k4/9/9/9/3I5/9/9/4K4 w - - 0 1'), 'd4');
    expect(reach).toEqual(expect.arrayContaining(['d8', 'a4', 'c3', 'e5', 'c5', 'e3']));
  });

  it('slides straight through friendly pieces', () => {
    const state = createStateFromFen('9/4k4/9/9/9/9/9/3R5/3IK4 w - - 0 1');
    expect(targets(state, 'd1')).toEqual(expect.arrayContaining(['d3', 'd4', 'd8']));
    expect(targets(state, 'd1')).not.toContain('d2'); // it cannot land on its own rook
  });

  it('is still blocked by enemy pieces', () => {
    const state = createStateFromFen('9/4k4/9/9/9/9/3r5/3R5/3IK4 w - - 0 1');
    const reach = targets(state, 'd1');
    expect(reach).toContain('d3'); // may capture the blocker
    expect(reach).not.toContain('d4'); // but not pass through it
  });
});

describe('Warrior', () => {
  it('moves like a Queen or a Knight', () => {
    const reach = targets(createStateFromFen('9/4k4/9/9/9/3W5/9/9/4K4 w - - 0 1'), 'd4');
    expect(reach).toEqual(expect.arrayContaining(['d8', 'a4', 'a7', 'g7', 'c6', 'e6', 'b5', 'i9']));
    expect(reach.length).toBe(30 + 8); // queen reach on the 9×9 board + knight leaps
  });

  it('cannot move on two consecutive turns', () => {
    let state = createStateFromFen('9/4k4/9/9/9/3W5/9/9/4K4 w - - 0 1');
    state = play(state, 'd4', 'd5');
    state = play(state, 'e8', 'f8'); // black replies
    expect(targets(state, 'd5')).toEqual([]);
  });

  it('is free to move again one turn later', () => {
    let state = createStateFromFen('9/4k4/9/9/9/3W5/9/9/4K4 w - - 0 1');
    state = play(state, 'd4', 'd5');
    state = play(state, 'e8', 'f8');
    state = play(state, 'e1', 'e2'); // white moves something else
    state = play(state, 'f8', 'e8');
    expect(targets(state, 'd5').length).toBeGreaterThan(0);
  });
});
