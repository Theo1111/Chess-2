import { describe, expect, it } from 'vitest';
import '../../engine/customPieces';
import '../../engine/rookPieces';
import '../../engine/knightPieces';
import '../../engine/bishopPieces';
import { applyMove, createStateFromFen, findLegalMove, parseSquareName } from '../../engine';
import { DEFAULT_ROSTER_BUDGET, addUnit, autoPlace, createRoster, rosterCost } from '../../roster';
import { buildArmyRow, buildMatchRow } from '../records';

const sq = (name: string) => {
  const square = parseSquareName(name);
  if (square === null) throw new Error(`bad square ${name}`);
  return square;
};

const play = (state: ReturnType<typeof createStateFromFen>, from: string, to: string) => {
  const move = findLegalMove(state, sq(from), sq(to));
  expect(move).not.toBeNull();
  return applyMove(state, move!);
};

describe('buildMatchRow', () => {
  it('captures moves, FENs and the engine result', () => {
    let game = createStateFromFen();
    game = play(game, 'e2', 'e4');
    game = play(game, 'e8', 'e7'); // any legal black reply

    const row = buildMatchRow({ game, timeControl: '10' });
    expect(row.mode).toBe('custom');
    expect(row.time_control).toBe('10');
    expect(row.plies).toBe(2);
    expect(row.moves).toHaveLength(2);
    expect(row.moves[0]).toBe('e4');
    expect(row.start_fen).toBe(game.history[0]!.fenBefore);
    expect(row.winner).toBeNull(); // game still live = abandoned save
    expect(row.reason).toBe('active');
    expect(row.white_army).toBeNull();
  });

  it('a fallen flag overrides the engine result', () => {
    let game = createStateFromFen();
    game = play(game, 'e2', 'e4');
    const row = buildMatchRow({
      game,
      timeControl: '5',
      override: { winner: 'black', reason: 'timeout' },
    });
    expect(row.winner).toBe('black');
    expect(row.reason).toBe('timeout');
  });

  it('draw statuses store as draws with their reason', () => {
    const drawn = { ...createStateFromFen(), status: 'draw-fifty-move' as const };
    const row = buildMatchRow({ game: drawn, timeControl: 'unlimited' });
    expect(row.winner).toBe('draw');
    expect(row.reason).toBe('draw-fifty-move');
  });

  it('matches carry both rosters and the content fingerprint', () => {
    const white = autoPlace(addUnit(createRoster('white', DEFAULT_ROSTER_BUDGET), 'rook'));
    const black = autoPlace(addUnit(createRoster('black', DEFAULT_ROSTER_BUDGET), 'rook'));
    const row = buildMatchRow({
      game: createStateFromFen(),
      timeControl: 'unlimited',
      armies: { white, black },
      contentFingerprint: 'abc123',
    });
    expect(row.white_army).toEqual(white);
    expect(row.black_army).toEqual(black);
    expect(row.content_fingerprint).toBe('abc123');
    // The row must survive JSON round-tripping (it becomes a jsonb column).
    expect(JSON.parse(JSON.stringify(row))).toEqual(row);
  });
});

describe('buildArmyRow', () => {
  it('stores the roster with its live point total', () => {
    const roster = addUnit(createRoster('white', DEFAULT_ROSTER_BUDGET), 'queen');
    const row = buildArmyRow('  My legion  ', roster, 'fp1');
    expect(row.name).toBe('My legion');
    expect(row.points).toBe(rosterCost(roster));
    expect(row.roster).toEqual(roster);
    expect(row.content_fingerprint).toBe('fp1');
  });

  it('never stores a blank name', () => {
    const roster = createRoster('white', DEFAULT_ROSTER_BUDGET);
    expect(buildArmyRow('   ', roster).name).toBe('Unnamed army');
  });
});
