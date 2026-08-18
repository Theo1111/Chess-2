import { describe, expect, it } from 'vitest';
import '../../engine/customPieces';
import '../../engine/rookPieces';
import '../../engine/knightPieces';
import '../../engine/bishopPieces';
import { getPieceDefinition } from '../../engine/pieces';
import { CLASS_LABELS, draftablePieces } from '../catalog';
import audit from './queenClassCards.audit.json';

/**
 * The Army Builder's piece-card overlay renders straight from the engine's
 * `PieceDefinition` — it never restates rules. These tests guard the fields
 * that card depends on, so a new piece can't ship with a blank card.
 */
describe('piece card data', () => {
  it('every draftable piece can fill a card', () => {
    for (const definition of draftablePieces()) {
      expect(definition.name, definition.type).toBeTruthy();
      expect(definition.pieceClass, definition.type).toBeTruthy();
      expect(CLASS_LABELS[definition.pieceClass!], definition.type).toBeTruthy();
      expect(typeof definition.cost, definition.type).toBe('number');
      expect(definition.movementText, definition.type).toBeTruthy();
      expect(definition.abilityText, definition.type).toBeTruthy();
      expect(definition.flavor, definition.type).toBeTruthy();
    }
  });

  it('matches the supplied Queen-class card audit', () => {
    for (const card of audit) {
      const definition = getPieceDefinition(card.id);
      expect(definition.name, card.id).toBe(card.name);
      expect(definition.pieceClass, card.id).toBe(card.pieceClass);
      expect(definition.cost, card.id).toBe(card.cost);
      expect(CLASS_LABELS[definition.pieceClass!], card.id).toBe(card.classLabel);
      expect(definition.movementText, card.id).toBe(card.movement);
      expect(definition.abilityText, card.id).toBe(card.ability);
      expect(definition.flavor, card.id).toBe(card.flavor);
    }
  });
});
