import { describe, expect, it } from 'vitest';
import '../../engine/customPieces';
import '../../engine/rookPieces';
import '../../engine/knightPieces';
import '../../engine/bishopPieces';
import { getPieceDefinition } from '../../engine/pieces';
import { draftablePieces } from '../../roster';
import { PIECE_CARD_ART, pieceCardArt } from '../pieces/pieceCardArt';

/** What is actually on disk under `public/`, as the browser would request it. */
const SHIPPED = new Set(
  Object.keys(import.meta.glob('/public/*-class/*')).map((path) => path.replace(/^\/public/, '')),
);

/** The batches delivered so far, class by class. */
const PAINTED: Record<string, string[]> = {
  queen: [
    'archbishop',
    'avenger',
    'champion',
    'chariot',
    'diplomat',
    'duelist',
    'general',
    'infiltrator',
    'queen',
    'revolutionary',
  ],
  rook: ['archer', 'battering-ram', 'berserker', 'catapult', 'jouster', 'leper', 'rook'],
  knight: ['ambusher', 'assassin', 'double', 'jester', 'knight', 'spy', 'squire'],
  bishop: [
    'bishop',
    'jailer',
    'kingsguard',
    'monk',
    'shieldmaiden',
    'spearman',
    'warhound',
  ],
};

/**
 * The painted cards are presentation only, but a broken path shows the player
 * an empty frame and a stale mapping shows them the wrong piece's rules — so
 * both the files and the ids they claim are checked here.
 */
describe('piece card art', () => {
  it('maps every entry to a registered draftable piece', () => {
    const draftable = new Set(draftablePieces().map((definition) => definition.type));
    for (const type of Object.keys(PIECE_CARD_ART)) {
      expect(draftable.has(type), type).toBe(true);
    }
  });

  it('ships a file for every path it advertises', () => {
    expect(SHIPPED.size).toBeGreaterThan(0);
    for (const [type, path] of Object.entries(PIECE_CARD_ART)) {
      expect(path.startsWith('/'), type).toBe(true);
      expect(SHIPPED.has(path), path).toBe(true);
    }
  });

  it('names each asset after the piece it depicts', () => {
    for (const [type, path] of Object.entries(PIECE_CARD_ART)) {
      expect(path, type).toContain(`/${type}.`);
    }
  });

  it('covers exactly the batches delivered so far', () => {
    for (const [pieceClass, expected] of Object.entries(PAINTED)) {
      const painted = draftablePieces()
        .filter((definition) => definition.pieceClass === pieceClass)
        .map((definition) => definition.type)
        .filter((type) => pieceCardArt(type));
      expect(painted.sort(), pieceClass).toEqual([...expected].sort());
    }
  });

  it('leaves every other piece on the drawn card', () => {
    const painted = new Set(Object.values(PAINTED).flat());
    for (const definition of draftablePieces()) {
      if (painted.has(definition.type)) continue;
      expect(pieceCardArt(definition.type), definition.type).toBeUndefined();
    }
  });

  it('is still missing only Trapper, Warrior and the Pawn', () => {
    const drawn = draftablePieces()
      .map((definition) => definition.type)
      .filter((type) => !pieceCardArt(type));
    expect(drawn.sort()).toEqual(['pawn', 'trapper', 'warrior']);
  });

  it('files each batch under its own class folder', () => {
    for (const [pieceClass, types] of Object.entries(PAINTED)) {
      for (const type of types) {
        expect(pieceCardArt(type), type).toContain(`/${pieceClass}-class/`);
      }
    }
  });

  it('changes nothing about the pieces themselves', () => {
    // Artwork is a lookup beside the registry, never a field inside it: the
    // engine must not know these files exist.
    for (const [type, path] of Object.entries(PIECE_CARD_ART)) {
      const definition = getPieceDefinition(type);
      const costs: Record<string, number> = { queen: 9, rook: 5, knight: 3, bishop: 3 };
      expect(definition.pieceClass, type).toBeTruthy();
      expect(definition.cost, type).toBe(costs[definition.pieceClass!]);
      expect(JSON.stringify(definition), type).not.toContain(path);
    }
  });
});
