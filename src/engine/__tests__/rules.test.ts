import { describe, expect, it } from 'vitest';
import { parseSquareName, squareName } from '../board';
import { START_FEN, toFen } from '../fen';
import { applyMove, createInitialState, createStateFromFen, isGameOver, playMove } from '../game';
import { attackersOf } from '../attacks';
import { findLegalMove, generateLegalMoves, generateLegalMovesFrom, isInCheck } from '../moveGeneration';
import type { GameState, PieceType } from '../types';

const sq = (name: string): number => {
  const square = parseSquareName(name);
  if (square === null) throw new Error(`bad square ${name}`);
  return square;
};

/** Destination squares (sorted) available to the piece on `from`. */
const targets = (state: GameState, from: string): string[] =>
  [...new Set(generateLegalMovesFrom(state, sq(from)).map((move) => squareName(move.to)))].sort();

/** Plays a move by coordinates, failing the test if it is illegal. */
const move = (state: GameState, from: string, to: string, promotion?: PieceType): GameState => {
  const next = playMove(state, sq(from), sq(to), promotion);
  expect(next, `expected ${from}${to} to be legal`).not.toBeNull();
  return next!;
};

const isLegal = (state: GameState, from: string, to: string, promotion?: PieceType): boolean =>
  findLegalMove(state, sq(from), sq(to), promotion) !== null;

/** Plays a list of "e2e4" style moves from the initial position. */
const playAll = (moves: string[], fen = START_FEN): GameState => {
  let state = createStateFromFen(fen);
  for (const text of moves) {
    state = move(state, text.slice(0, 2), text.slice(2, 4));
  }
  return state;
};

describe('piece movement', () => {
  it('pawns push one or two squares from the start rank, one after', () => {
    const start = createInitialState();
    expect(targets(start, 'e2')).toEqual(['e3', 'e4']);
    const after = move(start, 'e2', 'e4');
    expect(targets(after, 'd8')).toEqual(['d6', 'd7']);
    // Pawns block face to face once the files meet.
    const blocked = move(move(after, 'e8', 'e6'), 'e4', 'e5');
    expect(targets(blocked, 'e6')).toEqual([]);
  });

  it('pawns capture diagonally but not forwards', () => {
    const state = createStateFromFen('9/4k4/9/9/3p1p3/4P4/9/9/4K4 w - - 0 1');
    expect(targets(state, 'e4')).toEqual(['d5', 'e5', 'f5']);
    const blocked = createStateFromFen('9/4k4/9/9/9/3ppp3/4P4/9/4K4 w - - 0 1');
    expect(targets(blocked, 'e3')).toEqual(['d4', 'f4']);
  });

  it('a pawn cannot jump over a piece on its double push', () => {
    const state = createStateFromFen('9/4k4/9/9/9/9/4n4/4P4/4K4 w - - 0 1');
    expect(targets(state, 'e2')).toEqual([]);
  });

  it('knights leap over pieces', () => {
    expect(targets(createInitialState(), 'h1')).toEqual(['g3', 'i3']);
    const open = createStateFromFen('9/4k4/9/9/9/4N4/9/9/4K4 w - - 0 1');
    expect(targets(open, 'e4')).toEqual(['c3', 'c5', 'd2', 'd6', 'f2', 'f6', 'g3', 'g5']);
  });

  it('bishops slide diagonally and stop at blockers', () => {
    // The friendly pawn on c5 blocks the a7 diagonal at d4.
    const state = createStateFromFen('9/4k4/9/9/2P6/9/4B4/9/4K4 w - - 0 1');
    expect(targets(state, 'e3')).toEqual(['c1', 'd2', 'd4', 'f2', 'f4', 'g1', 'g5', 'h6', 'i7']);
  });

  it('rooks slide orthogonally and can capture the blocker', () => {
    const state = createStateFromFen('9/4k4/9/9/9/2r1R1P2/9/9/4K4 w - - 0 1');
    expect(targets(state, 'e4')).toEqual([
      'c4', 'd4', 'e2', 'e3', 'e5', 'e6', 'e7', 'e8', 'f4',
    ]);
  });

  it('queens combine rook and bishop movement', () => {
    const state = createStateFromFen('9/4k4/9/9/9/3Q5/9/9/4K4 w - - 0 1');
    expect(targets(state, 'd4')).toHaveLength(30); // 8 + 8 + 14 diagonal squares on 9×9
  });

  it('kings move one square and may not step next to the enemy king', () => {
    const state = createStateFromFen('9/9/9/9/3k5/9/3K5/9/9 w - - 0 1');
    expect(targets(state, 'd3')).toEqual(['c2', 'c3', 'd2', 'e2', 'e3']);
  });
});

describe('check', () => {
  it('detects check and marks the status', () => {
    // Qi4–i5 lands on the i5–e9 diagonal: check on the king at e9.
    const state = move(createStateFromFen('4k4/9/9/9/9/8Q/9/9/4K4 w - - 0 1'), 'i4', 'i5');
    expect(isInCheck(state)).toBe(true);
    expect(state.status).toBe('check');
    expect(state.history.at(-1)?.san).toBe('Qi5+');
  });

  it('forces the player to answer check', () => {
    // The a9 pawn's quiet advance does not address the check, so it is
    // barred; the rook may interpose on f8.
    const state = move(
      createStateFromFen('4k4/p8/9/5r3/9/8Q/9/9/4K4 w - - 0 1'),
      'i4',
      'i5',
    );
    const legal = generateLegalMoves(state).map((m) => squareName(m.from) + squareName(m.to));
    expect(legal).toContain('f6f8'); // the rook interposes on the check diagonal
    expect(legal.every((text) => !text.startsWith('a8'))).toBe(true); // the pawn cannot help
  });

  it('a king may not capture a defended piece', () => {
    // The rook on d2 is defended by the bishop on a5.
    const state = createStateFromFen('9/4k4/9/9/b8/9/9/3r5/3K5 w - - 0 1');
    expect(isLegal(state, 'd1', 'd2')).toBe(false);
    expect(targets(state, 'd1')).toEqual(['c1', 'e1']);
  });
});

describe('illegal moves that expose the king', () => {
  it('a pinned piece cannot leave the pin line', () => {
    // Knight on e2 is pinned to the king on e1 by the rook on e8.
    const state = createStateFromFen('9/4r4/k8/9/9/9/9/4N4/4K4 w - - 0 1');
    expect(targets(state, 'e2')).toEqual([]);
  });

  it('a pinned piece may still move along the pin line', () => {
    const state = createStateFromFen('9/4r4/k8/9/9/9/9/4R4/4K4 w - - 0 1');
    expect(targets(state, 'e2')).toEqual(['e3', 'e4', 'e5', 'e6', 'e7', 'e8']);
  });

  it('a move that opens a discovered attack on its own king is illegal', () => {
    // Moving the bishop off the e-file would expose the king to the rook.
    const state = createStateFromFen('9/4r4/k8/9/9/9/4B4/9/4K4 w - - 0 1');
    expect(targets(state, 'e3')).toEqual([]);
  });

  it('en passant is illegal when it would expose the king', () => {
    // White king h5, black rook a5: capturing en passant clears two pawns
    // off the fifth rank and leaves the king in check.
    const state = createStateFromFen('9/9/9/9/K1Pp3r1/9/9/9/7k1 w - d6 0 1');
    expect(isLegal(state, 'c5', 'd6')).toBe(false);
  });

  it('double check can only be answered by a king move', () => {
    // Nf6+ checks directly and discovers the rook on the e-file: two attackers,
    // so blocking or capturing cannot help.
    const state = createStateFromFen('9/4k4/9/9/9/4N4/9/9/4R1K2 w - - 0 1');
    const discovered = move(state, 'e4', 'd6');
    expect(isInCheck(discovered)).toBe(true);
    expect(attackersOf(discovered, sq('e8'), 'white')).toHaveLength(2);
    const replies = generateLegalMoves(discovered);
    expect(replies.length).toBeGreaterThan(0);
    expect(replies.every((reply) => reply.piece === 'king')).toBe(true);
  });
});

describe('castling', () => {
  const CASTLE_FEN = 'r3k3r/ppppqpppp/9/9/9/9/9/PPPPQPPPP/R3K3R w KQkq - 0 1';

  it('castles kingside, moving king and rook', () => {
    const state = move(createStateFromFen(CASTLE_FEN), 'e1', 'g1');
    expect(state.board[sq('g1')]?.type).toBe('king');
    expect(state.board[sq('f1')]?.type).toBe('rook');
    expect(state.board[sq('i1')]).toBeNull();
    expect(state.history.at(-1)?.san).toBe('O-O');
    expect(state.castling.whiteKingside).toBe(false);
    expect(state.castling.whiteQueenside).toBe(false);
  });

  it('castles queenside, moving king and rook', () => {
    const state = move(createStateFromFen(CASTLE_FEN), 'e1', 'c1');
    expect(state.board[sq('c1')]?.type).toBe('king');
    expect(state.board[sq('d1')]?.type).toBe('rook');
    expect(state.history.at(-1)?.san).toBe('O-O-O');
  });

  it('cannot castle through an occupied square', () => {
    const state = createStateFromFen('r3k3r/9/9/9/9/9/9/9/R2QK1N1R w KQkq - 0 1');
    expect(isLegal(state, 'e1', 'g1')).toBe(false);
    expect(isLegal(state, 'e1', 'c1')).toBe(false);
  });

  it('castles freely when nothing attacks the king’s path', () => {
    const state = createStateFromFen('r3k3r/9/9/9/9/9/9/9/R3K3R w KQkq - 0 1');
    expect(isLegal(state, 'e1', 'g1')).toBe(true);
    expect(isLegal(state, 'e1', 'c1')).toBe(true);
  });

  it('cannot castle through check', () => {
    const state = createStateFromFen('4kr3/9/9/9/9/9/9/9/R3K3R w KQ - 0 1'); // rook eyes f1
    expect(isLegal(state, 'e1', 'g1')).toBe(false);
    expect(isLegal(state, 'e1', 'c1')).toBe(true);
  });

  it('cannot castle into check', () => {
    const state = createStateFromFen('4k1r2/9/9/9/9/9/9/9/R3K3R w KQ - 0 1'); // rook eyes g1
    expect(isLegal(state, 'e1', 'g1')).toBe(false);
    expect(isLegal(state, 'e1', 'c1')).toBe(true);
  });

  it('cannot castle out of check', () => {
    const state = createStateFromFen('k3r4/9/9/9/9/9/9/9/R3K3R w KQ - 0 1'); // rook eyes e1
    expect(isInCheck(state)).toBe(true);
    expect(isLegal(state, 'e1', 'g1')).toBe(false);
    expect(isLegal(state, 'e1', 'c1')).toBe(false);
  });

  it('queenside castling is allowed when only b1 is attacked', () => {
    // The rook passes over b1; only the king's squares must be safe.
    const state = createStateFromFen('4k4/9/9/9/9/9/n8/9/R3K3R w KQ - 0 1');
    expect(isLegal(state, 'e1', 'c1')).toBe(true);
  });

  it('loses castling rights once the king moves', () => {
    let state = createStateFromFen('r3k3r/9/9/9/9/9/9/9/R3K3R w KQkq - 0 1');
    state = move(state, 'e1', 'e2');
    expect(state.castling.whiteKingside).toBe(false);
    expect(state.castling.whiteQueenside).toBe(false);
    expect(state.castling.blackKingside).toBe(true);
  });

  it('loses castling rights on the side whose rook moves', () => {
    let state = createStateFromFen('r3k3r/9/9/9/9/9/9/9/R3K3R w KQkq - 0 1');
    state = move(state, 'i1', 'h1');
    expect(state.castling.whiteKingside).toBe(false);
    expect(state.castling.whiteQueenside).toBe(true);
  });

  it('loses castling rights when the rook is captured on its home square', () => {
    let state = createStateFromFen('r3k3r/7b1/9/9/9/9/9/9/R3K3R b KQkq - 0 1');
    state = move(state, 'h8', 'a1' /* Bxa1 */);
    expect(state.castling.whiteQueenside).toBe(false);
    expect(state.castling.whiteKingside).toBe(true);
  });
});

describe('en passant', () => {
  it('captures the passing pawn', () => {
    let state = playAll(['e2e4', 'a8a7', 'e4e5', 'a7a6', 'e5e6', 'd8d6']);
    expect(state.enPassant).toBe(sq('d7'));
    state = move(state, 'e6', 'd7');
    expect(state.board[sq('d7')]?.type).toBe('pawn');
    expect(state.board[sq('d6')]).toBeNull();
    expect(state.history.at(-1)?.san).toBe('exd7');
    expect(state.captured.white).toEqual(['pawn']);
  });

  it('is only available on the very next move', () => {
    let state = playAll(['e2e4', 'a8a7', 'e4e5', 'a7a6', 'e5e6', 'd8d6']);
    state = move(state, 'h1', 'g3');
    state = move(state, 'a6', 'a5');
    expect(state.enPassant).toBeNull();
    expect(isLegal(state, 'e6', 'd7')).toBe(false);
  });

  it('is not recorded when no pawn can legally take', () => {
    const state = playAll(['e2e4']);
    expect(state.enPassant).toBeNull();
    expect(toFen(state).split(' ')[3]).toBe('-');
  });
});

describe('promotion', () => {
  it('offers all four promotion pieces', () => {
    const state = createStateFromFen('4k4/P8/9/9/9/9/9/9/4K4 w - - 0 1');
    const promotions = generateLegalMovesFrom(state, sq('a8')).map((m) => m.promotion);
    expect(promotions.sort()).toEqual(['bishop', 'knight', 'queen', 'rook']);
  });

  it('promotes to the chosen piece', () => {
    const state = move(createStateFromFen('4k4/P8/9/9/9/9/9/9/4K4 w - - 0 1'), 'a8', 'a9', 'knight');
    expect(state.board[sq('a9')]?.type).toBe('knight');
    expect(state.history.at(-1)?.san).toBe('a9=N');
  });

  it('promotes with a capture and records check', () => {
    const state = move(createStateFromFen('1r2k4/P8/9/9/9/9/9/9/4K4 w - - 0 1'), 'a8', 'b9', 'queen');
    expect(state.history.at(-1)?.san).toBe('axb9=Q+');
    expect(state.status).toBe('check');
    expect(state.captured.white).toEqual(['rook']);
  });

  it('a promotion can deliver checkmate', () => {
    const state = move(createStateFromFen('8k/6KP1/9/9/9/9/9/9/9 w - - 0 1'), 'h8', 'h9', 'queen');
    expect(state.status).toBe('checkmate');
    expect(state.winner).toBe('white');
    expect(state.history.at(-1)?.san).toBe('h9=Q#');
  });
});

describe('game endings', () => {
  it('detects checkmate delivered by a move', () => {
    // A rook lift to a9 corners the smothered king on i9.
    const state = move(createStateFromFen('8k/7pp/9/9/9/9/9/9/R3K4 w - - 0 1'), 'a1', 'a9');
    expect(state.status).toBe('checkmate');
    expect(state.winner).toBe('white');
    expect(isGameOver(state)).toBe(true);
    expect(generateLegalMoves(state)).toHaveLength(0);
    expect(state.history.at(-1)?.san).toBe('Ra9#');
  });

  it('detects back-rank mate', () => {
    const state = move(createStateFromFen('7k1/6ppp/9/9/9/9/9/9/R6K1 w - - 0 1'), 'a1', 'a9');
    expect(state.status).toBe('checkmate');
    expect(state.history.at(-1)?.san).toBe('Ra9#');
  });

  it('detects stalemate', () => {
    // Qg8 seals the i9 corner without giving check.
    const state = move(createStateFromFen('8k/9/9/9/9/9/9/6Q2/K8 w - - 0 1'), 'g2', 'g8');
    expect(state.status).toBe('stalemate');
    expect(state.winner).toBeNull();
    expect(isInCheck(state)).toBe(false);
    expect(generateLegalMoves(state)).toHaveLength(0);
  });

  it('rejects any move once the game is over', () => {
    const mate = move(createStateFromFen('8k/7pp/9/9/9/9/9/9/R3K4 w - - 0 1'), 'a1', 'a9');
    expect(playMove(mate, sq('e1'), sq('f2'))).toBeNull();
  });

  it('detects insufficient material', () => {
    // ...Nxa1 strips the last rook: king + knight vs king can never mate.
    const state = move(createStateFromFen('9/4k4/9/9/9/9/1n7/9/R3K4 b - - 0 1'), 'b3', 'a1');
    expect(state.status).toBe('draw-insufficient-material');
    expect(isGameOver(state)).toBe(true);
  });

  it('detects the fifty-move rule', () => {
    const state = move(createStateFromFen('9/4k4/9/9/9/9/9/R8/4K4 w - - 99 60'), 'a2', 'a3');
    expect(state.status).toBe('draw-fifty-move');
  });

  it('detects threefold repetition', () => {
    const state = playAll([
      'h1g3', 'h9g7', 'g3h1', 'g7h9',
      'h1g3', 'h9g7', 'g3h1', 'g7h9',
    ]);
    expect(state.status).toBe('draw-threefold-repetition');
    expect(isGameOver(state)).toBe(true);
  });
});

describe('state bookkeeping', () => {
  it('alternates turns and counts moves', () => {
    const state = playAll(['e2e4', 'e8e6', 'h1g3']);
    expect(state.turn).toBe('black');
    expect(state.fullmoveNumber).toBe(2);
    expect(state.history).toHaveLength(3);
    expect(state.history.map((entry) => entry.san)).toEqual(['e4', 'e6', 'Ng3']);
  });

  it('tracks captured pieces per side', () => {
    // 1.e4 d6 2.h3 d5 3.exd5 Qxd5 4.Nc3 Qxa2 5.Rxa2
    const state = playAll([
      'e2e4', 'd8d6', 'h2h3', 'd6d5', 'e4d5', 'd9d5', 'b1c3', 'd5a2', 'a1a2',
    ]);
    expect(state.captured.white).toEqual(['pawn', 'queen']);
    expect(state.captured.black).toEqual(['pawn', 'pawn']);
  });

  it('resets the halfmove clock on pawn moves and captures', () => {
    let state = playAll(['h1g3', 'h9g7']);
    expect(state.halfmoveClock).toBe(2);
    state = move(state, 'e2', 'e4');
    expect(state.halfmoveClock).toBe(0);
  });

  it('disambiguates SAN by file, rank and full square', () => {
    const twoRooks = createStateFromFen('9/6k2/9/9/9/4K4/9/9/R6R1 w - - 0 1');
    expect(applyMove(twoRooks, findLegalMove(twoRooks, sq('a1'), sq('d1'))!).history.at(-1)?.san)
      .toBe('Rad1');

    const sameFile = createStateFromFen('9/R8/9/9/7k1/9/9/9/R3K4 w - - 0 1');
    expect(applyMove(sameFile, findLegalMove(sameFile, sq('a1'), sq('a4'))!).history.at(-1)?.san)
      .toBe('R1a4');

    const threeQueens = createStateFromFen('9/9/1k7/9/9/Q6Q1/9/9/Q3K4 w - - 0 1');
    expect(applyMove(threeQueens, findLegalMove(threeQueens, sq('a4'), sq('d4'))!).history.at(-1)?.san)
      .toBe('Qa4d4');
  });

  it('serializes to FEN and back without losing the position', () => {
    const state = playAll(['e2e4', 'e8e6', 'h1g3', 'b9c7', 'f1b5', 'a8a7']);
    const fen = toFen(state);
    const restored = createStateFromFen(fen);
    expect(toFen(restored)).toBe(fen);
    expect(generateLegalMoves(restored)).toHaveLength(generateLegalMoves(state).length);
  });

  it('keeps every previous position in the history for replay', () => {
    const state = playAll(['e2e4', 'e8e6', 'h1g3']);
    expect(state.history[0]?.fenBefore).toBe(START_FEN);
    expect(createStateFromFen(state.history[2]!.fenBefore).turn).toBe('white');
  });

  it('round-trips through JSON', () => {
    const state = playAll(['e2e4', 'e8e6']);
    const clone = JSON.parse(JSON.stringify(state)) as GameState;
    expect(toFen(clone)).toBe(toFen(state));
    expect(generateLegalMoves(clone).length).toBe(generateLegalMoves(state).length);
  });
});

describe('castling partners', () => {
  const sqr = (name: string) => {
    const square = parseSquareName(name);
    if (square === null) throw new Error(`bad square ${name}`);
    return square;
  };

  it('any friendly piece on the corner may be swung around the King', () => {
    // A Queen on i1 stands in for the Rook; the FEN grants kingside rights.
    const state = createStateFromFen('4k4/9/9/9/9/9/9/9/4K3Q w Kk - 0 1');
    const castle = generateLegalMovesFrom(state, sqr('e1')).find(
      (move) => move.special === 'castle-kingside',
    );
    expect(castle).toBeDefined();

    const after = applyMove(state, castle!);
    expect(after.board[sqr('g1')]).toMatchObject({ type: 'king' });
    expect(after.board[sqr('f1')]).toMatchObject({ type: 'queen' });
  });

  it('a frozen partner cannot castle', () => {
    const state = createStateFromFen('4k4/9/9/9/9/9/9/9/4K3Q w Kk - 0 1');
    const partner = state.board[sqr('i1')]!;
    const frozen = {
      ...state,
      effects: [
        {
          id: 'freeze:test',
          kind: 'freeze' as const,
          caster: 'black' as const,
          targetPieceId: partner.id,
          expiresAtTurnStartOf: 'black' as const,
        },
      ],
    };
    expect(
      generateLegalMovesFrom(frozen, sqr('e1')).some((move) => move.special === 'castle-kingside'),
    ).toBe(false);
  });
});
