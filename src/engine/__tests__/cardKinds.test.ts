import { describe, expect, it } from 'vitest';
import '../customPieces';
import '../rookPieces';
import '../knightPieces';
import '../bishopPieces';
import { parseSquareName } from '../board';
import { castSpell, allSpellDefinitions, getSpellDefinition, spellPrimaryTargets } from '../spells';
import type { CardKind } from '../spells';
import { createStateFromFen } from '../game';
import { visibleTraps } from '../boardEffects';
import { generateLegalActions, applyGameAction } from '../../ai/actions';
import { normalizeRoster } from '../../roster/loadout';
import type { Color, GameState, Square } from '../types';

const sq = (name: string): Square => {
  const square = parseSquareName(name);
  if (square === null) throw new Error(`bad square ${name}`);
  return square;
};

/**
 * The canonical table. A card's kind says where its effect LIVES once it
 * resolves — on nothing (spell), on a friendly piece (relic), on an enemy
 * piece (curse), on the board (terrain), or hidden on the board awaiting an
 * enemy (trap).
 */
const EXPECTED: Readonly<Record<string, CardKind>> = {
  // Resolve and are gone.
  reveal: 'spell',
  teleport: 'spell',
  sacrifice: 'spell',
  reconnaissance: 'spell',
  'royal-order': 'spell',
  interference: 'spell',
  'rulers-authority': 'spell',

  // Good, and attached to a friendly piece.
  shield: 'relic',
  'last-stand': 'relic',
  'mirror-shield': 'relic',
  'crown-of-command': 'relic',

  // Bad, and attached to an enemy piece.
  freeze: 'curse',
  decay: 'curse',
  transform: 'curse',

  // Living on the board.
  'smoke-screen': 'terrain',
  'null-field': 'terrain',
  'sacred-ground': 'terrain',
  wall: 'terrain',
  portal: 'terrain',

  // Hidden on the board, waiting.
  tripwire: 'trap',
  sonar: 'trap',
  'web-trap': 'trap',
  mine: 'trap',
  'dead-zone': 'trap',
};

describe('card classification', () => {
  it('types every registered card, and types exactly the cards that exist', () => {
    const registered = allSpellDefinitions().map((definition) => definition.id).sort();
    expect(registered).toEqual(Object.keys(EXPECTED).sort());
  });

  it('puts each card in the kind its effect actually lives in', () => {
    for (const [id, kind] of Object.entries(EXPECTED)) {
      expect(getSpellDefinition(id).kind, id).toBe(kind);
    }
  });

  it('re-types the six cards that were miscategorised as spells', () => {
    // The point of the refactor, stated as its own assertion.
    expect(getSpellDefinition('shield').kind).toBe('relic');
    expect(getSpellDefinition('last-stand').kind).toBe('relic');
    expect(getSpellDefinition('freeze').kind).toBe('curse');
    expect(getSpellDefinition('smoke-screen').kind).toBe('terrain');
    expect(getSpellDefinition('null-field').kind).toBe('terrain');
    expect(getSpellDefinition('sacred-ground').kind).toBe('terrain');
    for (const id of ['shield', 'last-stand', 'freeze', 'smoke-screen', 'null-field', 'sacred-ground']) {
      expect(getSpellDefinition(id).kind, id).not.toBe('spell');
    }
  });

  it('holds one canonical definition per card — no migration duplicates', () => {
    const ids = allSpellDefinitions().map((definition) => definition.id);
    expect(new Set(ids).size).toBe(ids.length);
    const names = allSpellDefinitions().map((definition) => definition.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('keeps isTrap as a shorthand for the kind, and nothing more', () => {
    for (const definition of allSpellDefinitions()) {
      expect(definition.isTrap === true, definition.id).toBe(definition.kind === 'trap');
    }
  });
});

describe('classification is not behaviour', () => {
  /** A board with a Null Field over the centre, and pieces to aim at. */
  const nulled = (): GameState => {
    // A rook each, so the position is live rather than a bare-kings draw,
    // and off the e-file so nobody starts in check.
    const start = createStateFromFen('4k3r/9/9/9/9/9/9/9/4K3R w - - 0 1');
    const cast = castSpell(start, { spell: 'null-field', color: 'white', targets: [sq('e5')] });
    expect(cast, 'null field should be castable').not.toBeNull();
    return cast!;
  };

  it('suppresses a card by its own flag, not by what kind it is', () => {
    for (const definition of allSpellDefinitions()) {
      const expected = definition.kind !== 'trap' && definition.id !== 'wall' && definition.id !== 'portal';
      expect(definition.blockedByNullField, definition.id).toBe(expected);
    }
  });

  it('re-typing a card as terrain grants it no immunity it did not have', () => {
    // Smoke Screen, Null Field and Sacred Ground became terrain in this
    // refactor. Terrain-ness must not have quietly let them through a Null
    // Field, so each is still barred from targeting inside one.
    const state = nulled();
    for (const id of ['smoke-screen', 'sacred-ground']) {
      expect(getSpellDefinition(id).blockedByNullField, id).toBe(true);
      expect(spellPrimaryTargets(state, 'black', id), id).not.toContain(sq('e5'));
    }
    // …while the cards that were always masonry still pass through it.
    expect(getSpellDefinition('wall').blockedByNullField).toBe(false);
    expect(spellPrimaryTargets(state, 'black', 'wall')).toContain(sq('e5'));
  });

  it('hides a card by its own flag, not by what kind it is', () => {
    for (const definition of allSpellDefinitions()) {
      expect(definition.hidden, definition.id).toBe(definition.kind === 'trap');
    }
  });
});

describe('gameplay is unchanged by the re-typing', () => {
  const play = (fen: string, color: Color, spell: string, targets: string[]): GameState => {
    const next = castSpell(createStateFromFen(fen), {
      spell,
      color,
      targets: targets.map(sq),
    });
    expect(next, `${spell} should still resolve`).not.toBeNull();
    return next!;
  };

  it('Shield still shields, and still lives on the piece', () => {
    const after = play('4k3r/9/9/9/9/9/9/9/4K3R w - - 0 1', 'white', 'shield', ['i1']);
    const piece = after.board[sq('i1')]!;
    expect(after.effects.some((e) => e.kind === 'shield' && e.targetPieceId === piece.id)).toBe(true);
  });

  it('Freeze still freezes, and still lives on the enemy piece', () => {
    const after = play('4k3r/9/9/9/9/9/9/9/4K4 w - - 0 1', 'white', 'freeze', ['i9']);
    const piece = after.board[sq('i9')]!;
    expect(after.effects.some((e) => e.kind === 'freeze' && e.targetPieceId === piece.id)).toBe(true);
  });

  it('Last Stand still adds the extra life it always did', () => {
    const state = createStateFromFen('4k3r/8r/8r/9/9/9/9/9/4K3R w - - 0 1');
    const after = castSpell(state, { spell: 'last-stand', color: 'white', targets: [sq('i1')] });
    expect(after).not.toBeNull();
    expect(after!.board[sq('i1')]!.hitPoints).toBe(2);
  });

  it('Smoke Screen, Null Field and Sacred Ground still make their board state', () => {
    const board = '4k3r/9/9/9/9/9/9/9/4K3R w - - 0 1';
    const smoke = play(board, 'white', 'smoke-screen', ['e5']);
    expect(smoke.regions.some((region) => region.kind === 'smoke')).toBe(true);

    const nulls = play(board, 'white', 'null-field', ['e5']);
    expect(nulls.regions.some((region) => region.kind === 'null-field')).toBe(true);

    const sacred = play(board, 'white', 'sacred-ground', ['i1']);
    expect(sacred.squareStatuses.some((status) => status.kind === 'sacred-ground')).toBe(true);
  });

  it('keeps a set trap hidden from the opponent', () => {
    const after = play('4k3r/9/9/9/9/9/9/9/4K3R w - - 0 1', 'white', 'tripwire', ['e5']);
    expect(visibleTraps(after, 'white')).toHaveLength(1);
    expect(visibleTraps(after, 'black')).toHaveLength(0);
    // …and the history does not name it either.
    expect(after.history.at(-1)!.san).toBe('Trap…');
  });
});

describe('the rest of the system follows the registry', () => {
  it('lets the action layer play a card of every kind without special cases', () => {
    const played = new Set<CardKind>();
    let state = createStateFromFen('4k3r/9/9/9/9/9/9/1P7/4K3R w - - 0 1');

    for (let ply = 0; ply < 40 && played.size < 5; ply++) {
      const cards = generateLegalActions(state).filter((action) => action.kind === 'spell');
      const next = cards.find(
        (action) => action.kind === 'spell' && !played.has(getSpellDefinition(action.spell).kind),
      );
      if (!next || next.kind !== 'spell') break;
      played.add(getSpellDefinition(next.spell).kind);
      state = applyGameAction(state, next);
      // Hand the turn back with a legal move so the next card can be played.
      const move = generateLegalActions(state).find((action) => action.kind === 'move');
      if (!move) break;
      state = applyGameAction(state, move);
    }

    expect([...played].sort()).toEqual(['curse', 'relic', 'spell', 'terrain', 'trap']);
  });

  it('migrates a saved army whose card changed decks, rather than dropping it', () => {
    // An army stored before the re-typing: every re-typed card sat in
    // `spellIds`, and still does, because none of them crossed the
    // hidden/open line that the two stored decks actually track.
    const saved = {
      color: 'white' as const,
      budget: 55,
      units: [{ id: 'king-1', type: 'king' as const }],
      placement: {},
      spellIds: ['shield', 'freeze', 'smoke-screen', 'null-field', 'sacred-ground', 'last-stand'],
      trapIds: ['tripwire'],
    };
    const migrated = normalizeRoster(saved);
    expect(migrated.spellIds).toEqual(saved.spellIds);
    expect(migrated.trapIds).toEqual(['tripwire']);

    // And a card filed in the wrong deck is moved, not lost.
    const muddled = normalizeRoster({ ...saved, spellIds: ['shield', 'mine'], trapIds: ['freeze'] });
    expect(muddled.spellIds).toEqual(['shield', 'freeze']);
    expect(muddled.trapIds).toEqual(['mine']);
  });
});
