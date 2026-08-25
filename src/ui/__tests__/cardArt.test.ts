import { describe, expect, it } from 'vitest';
import '../../engine/customPieces';
import '../../engine/rookPieces';
import '../../engine/knightPieces';
import '../../engine/bishopPieces';
import { allSpellDefinitions, getSpellDefinition } from '../../engine';

/** What is actually on disk under `public/card_art`, as the browser asks for it. */
const SHIPPED = new Set(
  Object.keys(import.meta.glob('/public/card_art/*')).map((path) =>
    path.replace(/^\/public/, ''),
  ),
);

/** The cards the corrected kit delivered, and where each one lives. */
const KIT: Readonly<Record<string, string>> = {
  'mirror-shield': '/card_art/mirror-shield.png',
  'crown-of-command': '/card_art/crown-of-command.png',
  decay: '/card_art/decay.png',
  transform: '/card_art/transform.png',
  wall: '/card_art/wall.png',
  portal: '/card_art/portal.png',
};

/**
 * The painted faces are presentation only, but a broken path shows the player
 * an empty card and a stale mapping shows them another card's rules — so both
 * the files and the ids they claim are checked here.
 */
describe('card art', () => {
  it('gives the relic, curse and terrain cards their painted faces', () => {
    for (const [id, path] of Object.entries(KIT)) {
      expect(getSpellDefinition(id).artwork, id).toBe(path);
    }
  });

  it('ships a file for every path it advertises', () => {
    expect(SHIPPED.size).toBeGreaterThan(0);
    for (const definition of allSpellDefinitions()) {
      if (!definition.artwork) continue;
      expect(definition.artwork.startsWith('/'), definition.id).toBe(true);
      expect(SHIPPED.has(definition.artwork), definition.artwork).toBe(true);
    }
  });

  it('names each asset after the card it depicts', () => {
    for (const definition of allSpellDefinitions()) {
      if (!definition.artwork) continue;
      expect(definition.artwork, definition.id).toContain(`/${definition.id}.`);
    }
  });

  it('leaves the cards still awaiting art on their icon faces', () => {
    const undrawn = allSpellDefinitions()
      .filter((definition) => !definition.artwork)
      .map((definition) => definition.id)
      .sort();
    expect(undrawn).toEqual(['mine', 'royal-order', 'rulers-authority', 'tripwire']);
  });
});
