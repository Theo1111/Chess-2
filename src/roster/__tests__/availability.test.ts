import { afterEach, describe, expect, it } from 'vitest';
import '../../engine/customPieces';
import '../../engine/rookPieces';
import '../../engine/knightPieces';
import '../../engine/bishopPieces';
import { resetContentFlags, setContentFlags, setSecretsUnlocked } from '../availability';
import { allDraftablePieces, draftablePieces } from '../catalog';
import {
  allSpellCards,
  allTrapCards,
  availableCardsOfKind,
  availableSecretCards,
  availableSpellCards,
  availableTrapCards,
  toggleSpellCard,
  toggleTrapCard,
} from '../loadout';
import { addUnit, createRoster } from '../roster';
import { validateAvailability, validateComposition } from '../validation';
import { DEFAULT_ROSTER_BUDGET } from '../catalog';

afterEach(() => {
  resetContentFlags();
  setSecretsUnlocked(false);
});

const army = () => createRoster('white', DEFAULT_ROSTER_BUDGET);

describe('content availability', () => {
  it('offers the whole public catalog by default', () => {
    expect(draftablePieces()).toEqual(allDraftablePieces());
    expect(availableTrapCards()).toEqual(allTrapCards());
    // …everything except the secrets, which stay locked.
    const secrets = allSpellCards().filter((card) => card.secret);
    expect(secrets.length).toBeGreaterThan(0);
    expect(availableSpellCards()).toEqual(allSpellCards().filter((card) => !card.secret));
  });

  it('keeps secret cards out of the draft until they are unlocked', () => {
    expect(availableSecretCards()).toEqual([]);
    expect(availableCardsOfKind('spell').some((card) => card.id === 'rulers-authority')).toBe(false);
    expect(toggleSpellCard(army(), 'rulers-authority').spellIds).toEqual([]);
    expect(validateAvailability({ ...army(), spellIds: ['rulers-authority'] })).toHaveLength(1);

    setSecretsUnlocked(true);
    expect(availableSecretCards().map((card) => card.id)).toEqual(['rulers-authority']);
    // Still shown apart from the ordinary spells, never mixed in.
    expect(availableCardsOfKind('spell').some((card) => card.id === 'rulers-authority')).toBe(false);
    expect(toggleSpellCard(army(), 'rulers-authority').spellIds).toEqual(['rulers-authority']);
    expect(validateAvailability({ ...army(), spellIds: ['rulers-authority'] })).toEqual([]);
  });

  it('takes switched-off content out of the catalog', () => {
    setContentFlags({ pieces: ['rook'], cards: ['shield', 'tripwire'] });

    expect(draftablePieces().some((piece) => piece.type === 'rook')).toBe(false);
    expect(allDraftablePieces().some((piece) => piece.type === 'rook')).toBe(true);
    expect(availableSpellCards().some((card) => card.id === 'shield')).toBe(false);
    expect(availableTrapCards().some((card) => card.id === 'tripwire')).toBe(false);
    // Everything else is untouched.
    expect(draftablePieces().some((piece) => piece.type === 'knight')).toBe(true);
  });

  it('refuses to add a switched-off card to a deck', () => {
    setContentFlags({ cards: ['shield', 'tripwire'] });
    expect(toggleSpellCard(army(), 'shield').spellIds).toEqual([]);
    expect(toggleTrapCard(army(), 'tripwire').trapIds).toEqual([]);
  });

  it('a card already in a deck can still be removed', () => {
    const withCard = toggleSpellCard(army(), 'shield');
    expect(withCard.spellIds).toEqual(['shield']);
    setContentFlags({ cards: ['shield'] });
    expect(toggleSpellCard(withCard, 'shield').spellIds).toEqual([]);
  });

  it('flags an army carrying content that has been withdrawn', () => {
    const roster = toggleSpellCard(addUnit(army(), 'rook'), 'shield');
    expect(validateAvailability(roster)).toEqual([]);

    setContentFlags({ pieces: ['rook'], cards: ['shield'] });
    const errors = validateAvailability(roster);
    expect(errors.map((error) => error.code)).toEqual(['piece-unavailable', 'card-unavailable']);

    // Structural validity is a separate question: the army is still a legal
    // army, which is why saved games and match records are unaffected.
    expect(validateComposition(roster)).toEqual([]);
  });

  it('never withdraws the mandatory King', () => {
    setContentFlags({ pieces: ['king'] });
    expect(validateAvailability(army())).toEqual([]);
  });
});
