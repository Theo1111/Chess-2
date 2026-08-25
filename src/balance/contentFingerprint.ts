/**
 * Content fingerprint — a deterministic identity for the gameplay rules in
 * force during a run.
 *
 * Two balance runs are only comparable when they were played under the same
 * rules. The fingerprint folds in everything gameplay-relevant about every
 * registered piece and card — costs, classes, movement patterns, abilities,
 * targeting, and the SOURCE TEXT of behaviour hooks (resolve, generateSpecial,
 * castable, …), so an edited rule changes the fingerprint even though a
 * function cannot be serialized. Presentation never contributes: artwork,
 * icons, card prose, flavour and metadata are excluded on purpose.
 *
 * Cost overrides re-register definitions, so a run under `--override
 * champion=10` carries a DIFFERENT fingerprint than baseline — exactly right:
 * those games were played under different rules.
 */

import {
  allPieceDefinitions,
  allSpellDefinitions,
  type PieceDefinition,
  type SpellDefinition,
} from '../engine';

/** Canonical JSON: object keys sorted, functions folded to their source. */
function canonical(value: unknown): string {
  if (typeof value === 'function') return `fn:${normalizeSource(String(value))}`;
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${canonical(entryValue)}`);
  return `{${entries.join(',')}}`;
}

/** Whitespace-insensitive so a reformat is not a rules change. */
const normalizeSource = (source: string): string => source.replace(/\s+/g, ' ').trim();

/** The gameplay-relevant projection of a piece definition. */
function pieceEssence(definition: PieceDefinition): Record<string, unknown> {
  return {
    type: definition.type,
    symbol: definition.symbol,
    notation: definition.notation,
    value: definition.value,
    royal: definition.royal ?? false,
    pieceClass: definition.pieceClass,
    cost: definition.cost,
    patterns: definition.patterns,
    abilities: definition.abilities,
    generateSpecial: definition.generateSpecial,
    transformMoves: definition.transformMoves,
    dynamicPatterns: definition.dynamicPatterns,
    canMove: definition.canMove,
    restrictLegalMoves: definition.restrictLegalMoves,
    attackSquares: definition.attackSquares,
    // Deliberately excluded: name, movementText, abilityText, flavor,
    // metadata (portrait/art keys live there).
  };
}

/** The gameplay-relevant projection of a spell/trap definition. */
function spellEssence(definition: SpellDefinition): Record<string, unknown> {
  return {
    id: definition.id,
    cost: definition.cost,
    targeting: definition.targeting,
    kind: definition.kind,
    // Mechanics, not classification: what can stop the card is what changes
    // how games play out, so that is what the fingerprint tracks.
    blockedByNullField: definition.blockedByNullField,
    hidden: definition.hidden,
    pieceStages: definition.pieceStages,
    primaryTargets: definition.primaryTargets,
    secondaryTargets: definition.secondaryTargets,
    resolve: definition.resolve,
    castable: definition.castable,
    // Deliberately excluded: name, icon, description, artwork, describe
    // (history labels), metadata.
  };
}

/** 128-bit FNV-1a over the canonical text, hex-encoded. */
function fingerprintText(text: string): string {
  let a = 2166136261;
  let b = 0x9e3779b9;
  let c = 0x85ebca6b;
  let d = 0xc2b2ae35;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    a = Math.imul(a ^ code, 16777619);
    b = Math.imul(b ^ ((code << 1) | 1), 16777619);
    c = Math.imul(c ^ (code + 7), 16777619);
    d = Math.imul(d ^ (code * 31 + 3), 16777619);
  }
  return (
    (a >>> 0).toString(16).padStart(8, '0') +
    (b >>> 0).toString(16).padStart(8, '0') +
    (c >>> 0).toString(16).padStart(8, '0') +
    (d >>> 0).toString(16).padStart(8, '0')
  );
}

/** Fingerprint of every currently registered piece and card. */
export function contentFingerprint(): string {
  const pieces = allPieceDefinitions()
    .map(pieceEssence)
    .sort((a, b) => String(a.type).localeCompare(String(b.type)));
  const spells = allSpellDefinitions()
    .map(spellEssence)
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return fingerprintText(canonical({ pieces, spells }));
}

/** The cost table in force right now — recorded with every run. */
export function costTable(): Record<string, number> {
  const table: Record<string, number> = {};
  for (const definition of allPieceDefinitions()) {
    if (definition.cost !== undefined) table[definition.type] = definition.cost;
  }
  return table;
}
