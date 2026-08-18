import { describe, expect, it } from 'vitest';
import '../../engine/customPieces';
import '../../engine/rookPieces';
import '../../engine/knightPieces';
import '../../engine/bishopPieces';
import { KNIGHT_LEAPS, getPieceDefinition, registerPiece, registerSpell } from '../../engine';
import { contentFingerprint, costTable } from '../contentFingerprint';
import { withCostOverrides } from '../overrides';

describe('content fingerprint', () => {
  it('is stable across repeated computation', () => {
    expect(contentFingerprint()).toBe(contentFingerprint());
    expect(contentFingerprint()).toMatch(/^[0-9a-f]{32}$/);
  });

  it('changes when a cost changes, and restores with the registry', () => {
    const baseline = contentFingerprint();
    withCostOverrides({ champion: 10 }, () => {
      expect(contentFingerprint()).not.toBe(baseline);
    });
    expect(contentFingerprint()).toBe(baseline);
  });

  it('changes when a new piece or spell is registered', () => {
    const baseline = contentFingerprint();
    registerPiece({
      type: 'fingerprint-probe',
      name: 'Probe',
      symbol: '1',
      value: 1,
      patterns: [{ vectors: KNIGHT_LEAPS }],
    });
    const withPiece = contentFingerprint();
    expect(withPiece).not.toBe(baseline);

    registerSpell({
      id: 'fingerprint-probe-spell',
      name: 'Probe Spell',
      icon: 'x',
      description: 'test',
      targeting: 'none',
      resolve: () => ({}),
      describe: () => 'Probe',
    });
    expect(contentFingerprint()).not.toBe(withPiece);
  });

  it('ignores presentation-only changes', () => {
    const baseline = contentFingerprint();
    const pawn = getPieceDefinition('pawn');
    registerPiece({
      ...pawn,
      name: 'Renamed Pawn',
      flavor: 'Entirely new flavour text.',
      movementText: 'Different prose, same rules.',
      metadata: { portrait: '/some/art.png' },
    });
    try {
      expect(contentFingerprint()).toBe(baseline);
    } finally {
      registerPiece(pawn);
    }
    expect(contentFingerprint()).toBe(baseline);
  });

  it('cost table reflects live overrides', () => {
    expect(costTable().champion).toBe(9);
    withCostOverrides({ champion: 10 }, () => {
      expect(costTable().champion).toBe(10);
    });
    expect(costTable().champion).toBe(9);
  });
});
