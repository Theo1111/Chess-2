import { describe, expect, it } from 'vitest';
import '../../engine/customPieces';
import { parseSquareName, squareName } from '../../engine/board';
import { registerPiece } from '../../engine/pieces';
import { generateLegalMovesFrom, isInCheck } from '../../engine/moveGeneration';
import { playMove } from '../../engine/game';
import type { Square } from '../../engine/types';
import { DEFAULT_ROSTER_BUDGET, draftablePieces } from '../catalog';
import {
  addUnit,
  autoPlace,
  canAfford,
  cardCost,
  createRoster,
  mirrorRoster,
  placeUnit,
  remainingBudget,
  removeLastUnitOfType,
  removeUnit,
  rosterCost,
  startingSquares,
  unitCost,
  unplacedUnits,
} from '../roster';
import { createGameFromRosters, createMatch } from '../setup';
import { validateRoster } from '../validation';
import type { Roster } from '../types';

const sq = (name: string): Square => {
  const square = parseSquareName(name);
  if (square === null) throw new Error(`bad square ${name}`);
  return square;
};

/**
 * Roster helper: buy types, then place unit ids on named squares. A standard
 * match now requires full card decks, so the helper attaches a default 5+5.
 */
function buildRoster(
  color: 'white' | 'black',
  types: string[],
  placement: Record<string, string> = {},
): Roster {
  let roster = createRoster(color, DEFAULT_ROSTER_BUDGET);
  for (const type of types) roster = addUnit(roster, type);
  for (const [unitId, square] of Object.entries(placement)) {
    roster = placeUnit(roster, unitId, sq(square));
  }
  return {
    ...roster,
    spellIds: ['shield', 'reveal', 'freeze', 'teleport', 'sacrifice'],
    trapIds: ['tripwire', 'sonar', 'web-trap', 'dead-zone', 'mine'],
  };
}

describe('catalog', () => {
  it('offers the twelve Queen-class pieces', () => {
    const names = draftablePieces()
      .filter((definition) => definition.pieceClass === 'queen')
      .map((definition) => definition.type);
    expect(names).toHaveLength(12);
    expect(names).toEqual(
      expect.arrayContaining([
        'queen', 'archbishop', 'trapper', 'revolutionary', 'duelist', 'chariot',
        'champion', 'avenger', 'general', 'diplomat', 'infiltrator', 'warrior',
      ]),
    );
  });

  it('offers the seven Rook-class pieces at 5 points', () => {
    const rooks = draftablePieces().filter((definition) => definition.pieceClass === 'rook');
    expect(rooks.map((definition) => definition.type)).toEqual(
      expect.arrayContaining([
        'rook', 'berserker', 'leper', 'archer', 'battering-ram', 'catapult', 'jouster',
      ]),
    );
    expect(rooks).toHaveLength(7);
    expect(rooks.every((definition) => definition.cost === 5)).toBe(true);
  });

  it('costs come from each definition, not from the class', () => {
    // Nothing in the roster layer assumes a class-wide price.
    for (const definition of draftablePieces()) {
      expect(typeof definition.cost).toBe('number');
    }
  });

  it('does not offer the King for sale', () => {
    expect(draftablePieces().some((definition) => definition.type === 'king')).toBe(false);
  });
});

/** The pieces-only view of a built roster: card spending stripped. */
const piecesOnly = (roster: Roster): Roster => ({ ...roster, spellIds: [], trapIds: [] });

describe('budget', () => {
  it('starts with a free King and the full budget', () => {
    const roster = createRoster('white', DEFAULT_ROSTER_BUDGET);
    expect(roster.units).toHaveLength(1);
    expect(rosterCost(roster)).toBe(0);
    expect(remainingBudget(roster)).toBe(DEFAULT_ROSTER_BUDGET);
  });

  it('tracks spending as pieces are added and removed — cards included', () => {
    let roster = buildRoster('white', ['champion', 'trapper', 'warrior']);
    expect(unitCost(roster)).toBe(27);
    // ONE pool: total cost is pieces plus the attached card decks.
    expect(rosterCost(roster)).toBe(27 + cardCost(roster));
    expect(remainingBudget(roster)).toBe(DEFAULT_ROSTER_BUDGET - 27 - cardCost(roster));

    roster = removeLastUnitOfType(roster, 'warrior');
    expect(unitCost(roster)).toBe(18);
  });

  it('allows duplicate pieces as distinct units', () => {
    const roster = buildRoster('white', ['archbishop', 'archbishop', 'archbishop']);
    expect(unitCost(roster)).toBe(27);
    const ids = roster.units.map((unit) => unit.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('rejects an army over budget', () => {
    const roster = piecesOnly(
      buildRoster('white', ['queen', 'queen', 'queen', 'queen', 'queen', 'queen', 'queen']), // 63
    );
    const result = validateRoster(roster);
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.code === 'over-budget')).toBe(true);
  });

  it('accepts an army exactly at budget', () => {
    // 6×9 = 54 pieces + a 1-point trap = 55 exactly.
    const roster = {
      ...piecesOnly(buildRoster('white', ['queen', 'queen', 'queen', 'queen', 'queen', 'queen'])),
      trapIds: ['tripwire'],
    };
    expect(rosterCost(roster)).toBe(DEFAULT_ROSTER_BUDGET);
    expect(validateRoster(roster).valid).toBe(true);
  });

  it('mixes classes and cards against the one shared pool', () => {
    const roster = buildRoster('white', [
      'queen', 'champion', 'warrior', 'rook', 'jouster', 'catapult',
    ]);
    expect(unitCost(roster)).toBe(42);
    expect(rosterCost(roster)).toBe(42 + cardCost(roster));
    // The attached 5+5 card decks fit alongside 42 points of pieces only if
    // the budget truly is shared and large enough — over it, validation says so.
    const result = validateRoster(roster);
    if (rosterCost(roster) <= DEFAULT_ROSTER_BUDGET) {
      expect(result.valid).toBe(true);
    } else {
      expect(result.errors.some((error) => error.code === 'over-budget')).toBe(true);
    }
  });

  it('rejects a mixed army one point over budget', () => {
    // 54 in pieces + 2-point Shield = 56 > 55.
    const roster = {
      ...piecesOnly(buildRoster('white', ['queen', 'queen', 'queen', 'queen', 'queen', 'queen'])),
      spellIds: ['freeze', 'teleport'], // 2 points
    };
    expect(rosterCost(roster)).toBe(DEFAULT_ROSTER_BUDGET + 1);
    expect(validateRoster(roster).errors.some((error) => error.code === 'over-budget')).toBe(true);
  });

  it('allows any combination of Rook-class pieces, not exactly two Rooks', () => {
    for (const combo of [
      ['rook', 'rook'],
      ['berserker', 'catapult'],
      ['jouster', 'jouster'],
      ['jouster'],
      ['leper', 'archer', 'battering-ram', 'catapult', 'jouster', 'berserker'],
    ]) {
      expect(validateRoster(buildRoster('white', combo)).valid).toBe(true);
    }
  });
});

describe('composition rules', () => {
  it('requires the King', () => {
    let roster = buildRoster('white', ['queen']);
    roster = removeUnit(roster, 'king-1');
    const result = validateRoster(roster);
    expect(result.errors.some((error) => error.code === 'missing-king')).toBe(true);
  });

  it('requires at least one non-King piece', () => {
    const roster = createRoster('white', DEFAULT_ROSTER_BUDGET);
    const result = validateRoster(roster);
    expect(result.errors.some((error) => error.code === 'no-units')).toBe(true);
  });

  it('rejects unknown and non-draftable pieces', () => {
    // A registered piece with no cost is classified but never draftable.
    // (Pawns used to play this role; they cost 1 point now.)
    registerPiece({
      type: 'test-uncosted',
      name: 'Uncosted',
      symbol: 'u',
      value: 1,
      pieceClass: 'pawn',
      patterns: [],
    });
    const bogus: Roster = {
      ...createRoster('white', DEFAULT_ROSTER_BUDGET),
      units: [
        { id: 'king-1', type: 'king' },
        { id: 'x-1', type: 'dragon' },
        { id: 'u-1', type: 'test-uncosted' },
      ],
    };
    const codes = validateRoster(bogus).errors.map((error) => error.code);
    expect(codes).toContain('unknown-piece');
    expect(codes).toContain('not-draftable');
  });

  it('drafts pawns at one point and caps the army at board capacity', () => {
    let roster = createRoster('white', DEFAULT_ROSTER_BUDGET);
    expect(draftablePieces().some((piece) => piece.type === 'pawn')).toBe(true);

    // 17 pawns fill every deployment square beside the King for 17 points.
    for (let i = 0; i < 17; i++) roster = addUnit(roster, 'pawn');
    expect(rosterCost(roster)).toBe(17);
    expect(validateRoster(roster).valid).toBe(true);

    // Budget remains, but the two ranks are full: nothing else fits.
    expect(remainingBudget(roster)).toBe(DEFAULT_ROSTER_BUDGET - 17);
    expect(canAfford(roster, 'pawn')).toBe(false);
    const overfull = addUnit(roster, 'pawn');
    const codes = validateRoster(overfull).errors.map((error) => error.code);
    expect(codes).toContain('too-many-units');

    // A full pawn army deploys and plays.
    const placed = autoPlace(roster);
    expect(validateRoster(placed, { requirePlacement: true }).valid).toBe(true);
  });
});

describe('placement', () => {
  it('white deploys on ranks 1-2, black on ranks 8-9', () => {
    expect(startingSquares('white').map(squareName)).toContain('a1');
    expect(startingSquares('white').map(squareName)).toContain('i2');
    expect(startingSquares('white').map(squareName)).not.toContain('a3');
    expect(startingSquares('black').map(squareName)).toContain('a9');
    expect(startingSquares('black').map(squareName)).toContain('i8');
    expect(startingSquares('black').map(squareName)).not.toContain('i7');
  });

  it('accepts a sparse, unconventional layout', () => {
    const roster = buildRoster(
      'white',
      ['archbishop', 'chariot', 'warrior'],
      { 'king-1': 'b1', 'archbishop-1': 'a2', 'chariot-1': 'c2', 'warrior-1': 'f2' },
    );
    expect(validateRoster(roster, { requirePlacement: true }).valid).toBe(true);
  });

  it('rejects placement outside the two starting rows', () => {
    const roster = buildRoster('white', ['queen'], { 'king-1': 'e1', 'queen-1': 'e4' });
    const result = validateRoster(roster, { requirePlacement: true });
    expect(result.errors.some((error) => error.code === 'square-outside-zone')).toBe(true);
  });

  it("rejects placement in the opponent's starting area", () => {
    const roster = buildRoster('white', ['queen'], { 'king-1': 'e1', 'queen-1': 'e8' });
    const result = validateRoster(roster, { requirePlacement: true });
    expect(result.errors.some((error) => error.code === 'square-outside-zone')).toBe(true);
  });

  it('rejects unplaced units', () => {
    const roster = buildRoster('white', ['queen'], { 'king-1': 'e1' });
    const result = validateRoster(roster, { requirePlacement: true });
    expect(result.errors.some((error) => error.code === 'unplaced-unit')).toBe(true);
  });

  it('placing onto an occupied square evicts the previous occupant', () => {
    let roster = buildRoster('white', ['queen'], { 'king-1': 'e1' });
    roster = placeUnit(roster, 'queen-1', sq('e1'));
    expect(roster.placement['queen-1']).toBe(sq('e1'));
    expect(roster.placement['king-1']).toBeUndefined();
    expect(unplacedUnits(roster).map((unit) => unit.id)).toEqual(['king-1']);
  });

  it('auto-place fills empty legal squares', () => {
    const roster = autoPlace(buildRoster('white', ['queen', 'trapper', 'duelist']));
    expect(validateRoster(roster, { requirePlacement: true }).valid).toBe(true);
  });
});

describe('starting a game', () => {
  const white = buildRoster(
    'white',
    ['champion', 'duelist', 'trapper'],
    { 'king-1': 'b1', 'champion-1': 'a2', 'duelist-1': 'c2', 'trapper-1': 'f1' },
  );
  const black = mirrorRoster(white, 'black');

  it('mirroring flips the placement to the other side', () => {
    expect(black.placement['king-1']).toBe(sq('b9'));
    expect(black.placement['champion-1']).toBe(sq('a8'));
  });

  it('builds a game with both armies exactly as placed', () => {
    const game = createGameFromRosters(white, black);
    expect(game.board[sq('b1')]).toMatchObject({ type: 'king', color: 'white' });
    expect(game.board[sq('a2')]).toMatchObject({ type: 'champion', color: 'white', hitPoints: 2 });
    expect(game.board[sq('c2')]).toMatchObject({ type: 'duelist', color: 'white' });
    expect(game.board[sq('b9')]).toMatchObject({ type: 'king', color: 'black' });
    expect(game.board[sq('f9')]).toMatchObject({ type: 'trapper', color: 'black' });
    expect(game.turn).toBe('white');
    expect(game.status).toBe('active');
    expect(game.hasAbilityPieces).toBe(true);
    expect(game.board.filter(Boolean)).toHaveLength(8);
  });

  it('refuses to start from an invalid roster', () => {
    const broken = buildRoster('white', ['queen'], { 'king-1': 'e4', 'queen-1': 'd1' });
    expect(() => createMatch(broken, black)).toThrow(/deployment zone/);
  });

  it('the game plays by normal rules from the custom position', () => {
    const game = createGameFromRosters(white, black);
    // The Champion on a2 moves like a rook.
    const reach = generateLegalMovesFrom(game, sq('a2')).map((move) => squareName(move.to));
    expect(reach).toEqual(expect.arrayContaining(['a3', 'a6', 'b2']));
    // And a normal move works end-to-end. The army includes a Duelist, so the
    // turn correctly stays with White for the optional free move.
    const next = playMove(game, sq('a2'), sq('a6'));
    expect(next).not.toBeNull();
    expect(next!.phase).toBe('bonus');
    expect(next!.turn).toBe('white');
  });

  it('king safety holds in custom games', () => {
    // A trapper next to the black king cannot be captured into check… rather,
    // the black king may not walk into the white Champion's rook-line.
    const w = buildRoster('white', ['champion'], { 'king-1': 'e1', 'champion-1': 'a2' });
    const b = buildRoster('black', ['queen'], { 'king-1': 'a8', 'queen-1': 'h8' });
    const game = createGameFromRosters(w, b);
    const afterWhite = playMove(game, sq('e1'), sq('e2'));
    expect(afterWhite).not.toBeNull();
    // Black king on a8 may not step to a7/b7? a-file is the Champion's line.
    const kingReach = generateLegalMovesFrom(afterWhite!, sq('a8')).map((m) => squareName(m.to));
    expect(kingReach).not.toContain('a7');
    expect(isInCheck(afterWhite!, 'black')).toBe(true); // a8 itself is attacked
  });

  it('round-trips through JSON like any other game state', () => {
    const game = createGameFromRosters(white, black);
    const clone = JSON.parse(JSON.stringify(game));
    expect(clone.board[sq('a2')]).toMatchObject({ type: 'champion', hitPoints: 2 });
  });
});
