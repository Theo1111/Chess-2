import { describe, expect, it } from 'vitest';
import '../../engine/customPieces';
import '../../engine/rookPieces';
import '../../engine/knightPieces';
import '../../engine/bishopPieces';
import { parseSquareName } from '../../engine/board';
import { applyMove, createStateFromFen } from '../../engine/game';
import { findLegalMove } from '../../engine/moveGeneration';
import { castSpell } from '../../engine/spells';
import type { GameState, Square } from '../../engine/types';
import { DEFAULT_ROSTER_BUDGET, costOfCard } from '../catalog';
import {
  availableSpellCards,
  availableTrapCards,
  isLoadoutComplete,
  normalizeRoster,
  toggleSpellCard,
  toggleTrapCard,
  validateLoadout,
} from '../loadout';
import {
  addUnit,
  autoPlace,
  canAffordCard,
  cardCost,
  createRoster,
  mirrorRoster,
  remainingBudget,
  rosterCost,
  unitCost,
} from '../roster';
import { createMatch } from '../setup';
import { validateComposition, validateRoster } from '../validation';
import type { Roster } from '../types';

const sq = (name: string): Square => {
  const square = parseSquareName(name);
  if (square === null) throw new Error(`bad square ${name}`);
  return square;
};

const SPELLS_A = ['shield', 'smoke-screen', 'last-stand', 'null-field', 'sacred-ground'];
const TRAPS_A = ['web-trap', 'sonar', 'dead-zone', 'tripwire', 'mine'];
const SPELLS_B = ['teleport', 'royal-order', 'sacrifice', 'reconnaissance', 'interference'];

const armedRoster = (
  color: 'white' | 'black',
  spellIds: readonly string[] = SPELLS_A,
  trapIds: readonly string[] = TRAPS_A,
): Roster =>
  autoPlace({
    ...addUnit(addUnit(createRoster(color, DEFAULT_ROSTER_BUDGET), 'rook'), 'pawn-order-dummy'.replace('pawn-order-dummy', 'knight')),
    spellIds: [...spellIds],
    trapIds: [...trapIds],
  });

describe('shared-budget card pricing', () => {
  it('every card carries an engine-defined point cost', () => {
    for (const card of [...availableSpellCards(), ...availableTrapCards()]) {
      expect(card.cost, card.id).toBeGreaterThanOrEqual(1);
      expect(costOfCard(card.id)).toBe(card.cost);
    }
    // Evidence-based, not uniform: the 25k baseline priced these apart.
    expect(costOfCard('shield')).toBeGreaterThan(costOfCard('reconnaissance'));
    expect(costOfCard('mine')).toBeGreaterThan(costOfCard('tripwire'));
  });

  it('cards drain the same budget as pieces', () => {
    let roster = createRoster('white', DEFAULT_ROSTER_BUDGET);
    const before = remainingBudget(roster);
    roster = toggleSpellCard(roster, 'shield');
    expect(remainingBudget(roster)).toBe(before - costOfCard('shield'));
    roster = addUnit(roster, 'rook');
    expect(rosterCost(roster)).toBe(unitCost(roster) + cardCost(roster));
    expect(remainingBudget(roster)).toBe(
      DEFAULT_ROSTER_BUDGET - costOfCard('shield') - 5,
    );
  });

  it('refuses a card the remaining budget cannot cover', () => {
    // Tiny budget: one rook (5) leaves 1 point — Shield (4) must be refused,
    // a 1-point card still fits.
    let roster = addUnit(createRoster('white', 6), 'rook');
    expect(canAffordCard(roster, 'shield')).toBe(false);
    const refused = toggleSpellCard(roster, 'shield');
    expect(refused.spellIds).toEqual([]);
    roster = toggleSpellCard(roster, 'freeze'); // costs 1
    expect(roster.spellIds).toEqual(['freeze']);
    expect(remainingBudget(roster)).toBe(0);
  });

  it('any allotment is legal — card-less or card-heavy', () => {
    // No cards at all: perfectly valid.
    const noCards = autoPlace(addUnit(createRoster('white', DEFAULT_ROSTER_BUDGET), 'rook'));
    expect(validateRoster(noCards, { requirePlacement: true, requireLoadout: true }).valid).toBe(true);

    // Buying cards until the budget says stop is also valid. The library has
    // outgrown one budget (relics, curses and terrain took it past 55), so a
    // caster build is now a real choice rather than "take everything".
    const library = [...availableSpellCards(), ...availableTrapCards()];
    let caster = addUnit(createRoster('white', DEFAULT_ROSTER_BUDGET), 'rook');
    for (const card of library) {
      caster = card.isTrap ? toggleTrapCard(caster, card.id) : toggleSpellCard(caster, card.id);
    }
    const bought = caster.spellIds.length + caster.trapIds.length;
    expect(bought).toBeGreaterThan(10);
    expect(bought).toBeLessThan(library.length);
    expect(rosterCost(caster)).toBeLessThanOrEqual(DEFAULT_ROSTER_BUDGET);
    expect(validateRoster(autoPlace(caster), { requirePlacement: true }).valid).toBe(true);
  });

  it('at most one copy of each card', () => {
    let roster = createRoster('white', DEFAULT_ROSTER_BUDGET);
    roster = toggleSpellCard(roster, 'freeze');
    roster = toggleSpellCard(roster, 'freeze'); // toggles OFF, not duplicates
    expect(roster.spellIds).toEqual([]);
    const duplicated = { ...roster, spellIds: ['freeze', 'freeze'] };
    expect(validateLoadout(duplicated).some((e) => e.code === 'duplicate-card')).toBe(true);
  });

  it('rejects trap cards and unknown ids in the spell deck', () => {
    let roster = createRoster('white', DEFAULT_ROSTER_BUDGET);
    roster = toggleSpellCard(roster, 'tripwire'); // a trap
    roster = toggleSpellCard(roster, 'meteor'); // unknown
    expect(roster.spellIds).toEqual([]);
    const withSpell = toggleTrapCard(roster, 'shield');
    expect(withSpell.trapIds).not.toContain('shield');
  });
});

describe('validation and persistence', () => {
  it('over-budget card spending fails composition, with clear feedback', () => {
    let roster = addUnit(createRoster('white', 10), 'rook'); // 5 of 10 spent
    roster = { ...roster, spellIds: ['shield', 'last-stand'] }; // 8 more, forced
    const errors = validateComposition(roster);
    expect(errors.some((e) => e.code === 'over-budget')).toBe(true);
    expect(errors.find((e) => e.code === 'over-budget')!.message).toContain('cards');
  });

  it('saved armies preserve both decks, and different armies differ', () => {
    const defensive = armedRoster('white', SPELLS_A, TRAPS_A);
    const aggressive = armedRoster('black', SPELLS_B, TRAPS_A);

    const restoredDefensive = JSON.parse(JSON.stringify(defensive)) as Roster;
    expect(restoredDefensive.spellIds).toEqual(SPELLS_A);
    expect(restoredDefensive.trapIds).toEqual(TRAPS_A);
    expect(aggressive.spellIds).toEqual(SPELLS_B);
    expect(defensive.spellIds).not.toEqual(aggressive.spellIds);
  });

  it('mirroring an army copies its card loadout', () => {
    const white = armedRoster('white', SPELLS_B, TRAPS_A);
    const black = mirrorRoster(white, 'black');
    expect(black.spellIds).toEqual(SPELLS_B);
    expect(black.trapIds).toEqual(TRAPS_A);
  });

  it('roster edits preserve selections (moving between builder tabs)', () => {
    let roster = armedRoster('white');
    roster = addUnit(roster, 'bishop'); // piece edits do not touch the decks
    expect(roster.spellIds).toEqual(SPELLS_A);
    expect(roster.trapIds).toEqual(TRAPS_A);
  });

  it('older armies without card fields load safely (cards now optional)', () => {
    const legacy = JSON.parse(
      JSON.stringify({
        color: 'white',
        budget: 33,
        units: [{ id: 'king-1', type: 'king' }, { id: 'rook-1', type: 'rook' }],
        placement: {},
      }),
    );
    const upgraded = normalizeRoster(legacy);
    expect(upgraded.spellIds).toEqual([]);
    expect(upgraded.trapIds).toEqual([]);
    expect(isLoadoutComplete(upgraded)).toBe(true); // no minimum any more
    // Unknown ids in a corrupted save are dropped, not fatal.
    const corrupt = normalizeRoster({ ...upgraded, spellIds: ['shield', 'nonsense'], trapIds: ['shield'] });
    expect(corrupt.spellIds).toEqual(['shield']);
    expect(corrupt.trapIds).toEqual([]); // 'shield' is not a trap
  });
});

describe('match integration', () => {
  it('a match only contains each army’s selected cards', () => {
    const white = armedRoster('white', SPELLS_A, TRAPS_A);
    const black = armedRoster('black', SPELLS_B, TRAPS_A);
    const { game } = createMatch(white, black);

    expect([...game.spells.white.available].sort()).toEqual([...SPELLS_A, ...TRAPS_A].sort());
    expect([...game.spells.black.available].sort()).toEqual([...SPELLS_B, ...TRAPS_A].sort());
    expect(game.spells.white.available).not.toContain('teleport'); // not brought
    expect(game.spells.black.available).not.toContain('shield');
  });

  it('unselected cards cannot be cast in the match', () => {
    const white = armedRoster('white', SPELLS_A, TRAPS_A);
    const black = armedRoster('black', SPELLS_B, TRAPS_A);
    const { game } = createMatch(white, black);

    // White never brought Freeze.
    const target = game.board.findIndex((piece) => piece?.color === 'black');
    expect(castSpell(game, { spell: 'freeze', color: 'white', targets: [target] })).toBeNull();
    // But a brought card works: shield a white piece.
    const own = game.board.findIndex(
      (piece) => piece?.color === 'white' && piece.type !== 'king',
    );
    expect(castSpell(game, { spell: 'shield', color: 'white', targets: [own] })).not.toBeNull();
  });

  it('a card-less army starts a match with an empty book', () => {
    const white = armedRoster('white', [], []);
    const black = armedRoster('black', SPELLS_B, TRAPS_A);
    const { game } = createMatch(white, black);
    expect(game.spells.white.available).toEqual([]);
    expect(game.spells.black.available.length).toBeGreaterThan(0);
  });

  it('an over-budget loadout cannot start a match', () => {
    const white = { ...armedRoster('white'), budget: 10 }; // cards alone exceed 10
    const black = armedRoster('black');
    expect(() => createMatch(white, black)).toThrow(/budget/);
    expect(validateRoster(white).valid).toBe(false);
  });

  it('a new game from the same rosters does not alter the saved loadout', () => {
    const white = armedRoster('white');
    const black = armedRoster('black', SPELLS_B, TRAPS_A);
    const first = createMatch(white, black);
    // Burn a card in game one…
    const own = first.game.board.findIndex(
      (piece) => piece?.color === 'white' && piece.type !== 'king',
    );
    const played = castSpell(first.game, { spell: 'shield', color: 'white', targets: [own] });
    expect(played?.spells.white.used).toContain('shield');

    // …the army itself is untouched, and a rematch starts with a fresh book.
    expect(white.spellIds).toEqual(SPELLS_A);
    const rematch = createMatch(white, black);
    expect(rematch.game.spells.white.available).toContain('shield');
    expect(rematch.game.spells.white.used).toEqual([]);
  });
});

describe('Mine trap', () => {
  const play = (state: GameState, from: string, to: string): GameState => {
    const move = findLegalMove(state, sq(from), sq(to));
    expect(move, `expected ${from}${to} to be legal`).not.toBeNull();
    return applyMove(state, move!);
  };

  const withMine = (fen: string, square: string, owner: 'white' | 'black' = 'white'): GameState => {
    const state = createStateFromFen(fen);
    return {
      ...state,
      traps: [
        { id: `mine:${square}`, trap: 'mine', owner, square: sq(square), revealed: false, armed: true },
      ],
    };
  };

  it('destroys the enemy piece that lands on it — as destruction, not capture', () => {
    let state = withMine('9/k2r5/9/9/9/9/9/9/K6E1 b - - 0 1', 'd5');
    state = play(state, 'd8', 'd5');
    expect(state.board[sq('d5')]).toBeNull(); // rook gone
    expect(state.traps[0]).toMatchObject({ revealed: true, armed: false });
    expect(state.captured.white).toEqual([]); // nobody credited
    expect(state.reserves.black).toEqual(['rook']); // but black lost it
    // The white Avenger inherits nothing from a destruction.
    expect(state.captured.black).toEqual([]);
  });

  it('never destroys a King, and sacred ground defuses it safely', () => {
    let royal = withMine('9/3k5/9/9/3K5/9/9/9/9 b - - 0 1', 'd7');
    royal = play(royal, 'd8', 'd7');
    expect(royal.board[sq('d7')]?.type).toBe('king'); // survived
    expect(royal.traps[0]).toMatchObject({ armed: false }); // mine spent

    let holy = withMine('9/k2r5/9/9/9/9/9/9/K8 b - - 0 1', 'd5');
    holy = {
      ...holy,
      squareStatuses: [
        { id: 's', kind: 'sacred-ground', owner: 'black', square: sq('d5'), pliesRemaining: 3 },
      ],
    };
    holy = play(holy, 'd8', 'd5');
    expect(holy.board[sq('d5')]?.type).toBe('rook'); // immune
  });

  it('fizzles instead of exposing the victim’s own king', () => {
    // The black rook blocks the white rook's check by landing on d5 — the
    // mine would re-open the check by destroying it, so the blast fizzles.
    let state = withMine('9/3k5/9/9/9/r8/9/9/3R2K2 b - - 0 1', 'd4');
    state = play(state, 'a4', 'd4'); // rook interposes on the d-file
    expect(state.board[sq('d4')]?.type).toBe('rook'); // survived the fizzle
    expect(state.traps[0]).toMatchObject({ revealed: true, armed: false }); // still spent
  });
});
