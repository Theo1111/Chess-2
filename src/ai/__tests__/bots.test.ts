import { describe, expect, it } from 'vitest';
import '../../engine/customPieces';
import '../../engine/rookPieces';
import '../../engine/knightPieces';
import '../../engine/bishopPieces';
import { applyMove, createStateFromFen } from '../../engine';
import { createRng } from '../../sim/seededRandom';
import { runMatch } from '../../sim/runMatch';
import { actionKey, generateLegalActions } from '../actions';
import { evaluatePosition, terminalScore, WIN_SCORE } from '../evaluation';
import { hashGameState } from '../hash';
import { GreedyBot } from '../greedyBot';
import { AlphaBetaBot } from '../alphaBetaBot';
import { RandomBot } from '../randomBot';

const ctx = (color: 'white' | 'black', seed = 1) => ({
  color,
  rng: createRng(seed),
  ply: 0,
});

describe('evaluation', () => {
  it('prefers material advantage', () => {
    const even = createStateFromFen();
    const upAQueen = createStateFromFen('rnb1kqbnr/ppppppppp/9/9/9/9/9/PPPPPPPPP/RNBQKQBNR w KQkq - 0 1');
    expect(evaluatePosition(upAQueen, 'white')).toBeGreaterThan(evaluatePosition(even, 'white'));
    expect(evaluatePosition(upAQueen, 'black')).toBeLessThan(evaluatePosition(even, 'black'));
  });

  it('terminal scores dominate and prefer faster wins', () => {
    const won = { ...createStateFromFen(), status: 'checkmate' as const, winner: 'white' as const };
    expect(terminalScore(won, 'white', 3)).toBe(WIN_SCORE - 3);
    expect(terminalScore(won, 'black', 3)).toBe(-WIN_SCORE + 3);
    expect(terminalScore(won, 'white', 3)).toBeGreaterThan(terminalScore(won, 'white', 5));
  });
});

describe('gameplay hash', () => {
  it('separates states FEN cannot', () => {
    const base = createStateFromFen();
    expect(hashGameState(base)).toBe(hashGameState({ ...base }));

    // Same board, different spell books.
    const spent = {
      ...base,
      spells: {
        ...base.spells,
        white: { ...base.spells.white, available: base.spells.white.available.slice(1) },
      },
    };
    expect(hashGameState(spent)).not.toBe(hashGameState(base));

    // Same board, a hidden trap on it.
    const trapped = {
      ...base,
      traps: [{ id: 'x', trap: 'mine' as const, owner: 'white' as const, square: 40, revealed: false, armed: true }],
    };
    expect(hashGameState(trapped)).not.toBe(hashGameState(base));

    // Same board, a piece with armour left.
    const board = base.board.slice();
    const pawn = board[9]!;
    board[9] = { ...pawn, hitPoints: 2 };
    expect(hashGameState({ ...base, board })).not.toBe(hashGameState(base));
  });
});

describe('GreedyBot', () => {
  it('takes a hanging queen', () => {
    // White rook can capture the undefended black queen.
    const state = createStateFromFen('4k4/9/9/9/3q5/9/9/9/3RK4 w - - 0 1');
    const bot = new GreedyBot();
    const action = bot.chooseAction(state, generateLegalActions(state), ctx('white'));
    expect(action.kind).toBe('move');
    if (action.kind === 'move') {
      expect(action.move.captured?.type).toBe('queen');
    }
  });

  it('is deterministic under the same rng seed', () => {
    const state = createStateFromFen();
    const bot = new GreedyBot();
    const actions = generateLegalActions(state);
    const a = bot.chooseAction(state, actions, ctx('white', 9));
    const b = bot.chooseAction(state, actions, ctx('white', 9));
    expect(actionKey(a)).toBe(actionKey(b));
  });
});

describe('AlphaBetaBot', () => {
  it('finds mate in one', () => {
    // Rb1→b9# is the position's only mate: the a8 rook seals rank 8.
    const state = createStateFromFen('4k4/R8/9/9/9/9/9/9/1R2K4 w - - 0 1');
    const bot = new AlphaBetaBot({ maxDepth: 2 });
    const action = bot.chooseAction(state, generateLegalActions(state), ctx('white'));
    expect(action.kind).toBe('move');
    if (action.kind === 'move') {
      expect(applyMove(state, action.move).status).toBe('checkmate');
    }
  });

  it('respects the node budget and still answers', () => {
    const state = createStateFromFen();
    const bot = new AlphaBetaBot({ maxDepth: 4, maxNodes: 500 });
    const actions = generateLegalActions(state);
    const action = bot.chooseAction(state, actions, ctx('white'));
    expect(actions.map(actionKey)).toContain(actionKey(action));
  });

  it('beats RandomBot from the standard position', { timeout: 120_000 }, () => {
    const strong = new AlphaBetaBot({ maxDepth: 2, maxNodes: 20_000 });
    const weak = new RandomBot();
    let strongWins = 0;
    for (let seed = 0; seed < 3; seed++) {
      const result = runMatch({
        whiteAgent: strong,
        blackAgent: weak,
        initialState: createStateFromFen(),
        seed,
        maxPlies: 160,
        collectTelemetry: false,
      });
      if (result.winner === 'white') strongWins++;
    }
    expect(strongWins).toBeGreaterThanOrEqual(2);
  });
});

