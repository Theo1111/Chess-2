/**
 * Fuzz-campaign aggregation: RandomBot at scale is an ENGINE STRESS TEST,
 * not balance evidence, and its report says so. The aggregator is streaming —
 * records are folded in and discarded, so a 50,000-game campaign holds no
 * match list in memory.
 */

import { allPieceDefinitions, allSpellDefinitions } from '../engine';
import { draftablePieces } from '../roster';
import type { MatchRecord } from '../sim/tournament';

export interface FuzzReport {
  readonly label: 'engine-stress-test-not-balance-evidence';
  readonly games: number;
  readonly failures: number;
  readonly maxTurnGames: number;
  readonly minPlies: number;
  readonly maxPlies: number;
  readonly averagePlies: number;
  /** Termination reason → count (engine statuses plus 'max-plies'). */
  readonly reasons: Readonly<Record<string, number>>;
  /** Games in which the piece appeared on either side. */
  readonly pieceAppearances: Readonly<Record<string, number>>;
  readonly spellCasts: Readonly<Record<string, number>>;
  readonly trapPlacements: Readonly<Record<string, number>>;
  readonly trapTriggers: Readonly<Record<string, number>>;
  /** Registered content the campaign barely touched — coverage holes. */
  readonly underExercised: {
    readonly pieces: readonly string[];
    readonly spells: readonly string[];
    readonly traps: readonly string[];
  };
}

export class FuzzAggregator {
  private games = 0;
  private maxTurnGames = 0;
  private minPlies = Number.POSITIVE_INFINITY;
  private maxPliesSeen = 0;
  private totalPlies = 0;
  private readonly reasons: Record<string, number> = {};
  private readonly pieceAppearances: Record<string, number> = {};
  private readonly spellCasts: Record<string, number> = {};
  private readonly trapPlacements: Record<string, number> = {};
  private readonly trapTriggers: Record<string, number> = {};

  record(record: MatchRecord): void {
    this.games++;
    this.totalPlies += record.plies;
    this.minPlies = Math.min(this.minPlies, record.plies);
    this.maxPliesSeen = Math.max(this.maxPliesSeen, record.plies);
    this.reasons[record.reason] = (this.reasons[record.reason] ?? 0) + 1;
    if (record.reason === 'max-plies') this.maxTurnGames++;

    const seen = new Set<string>();
    for (const side of [record.white, record.black]) {
      for (const piece of Object.keys(side.composition)) seen.add(piece);
    }
    for (const piece of seen) {
      this.pieceAppearances[piece] = (this.pieceAppearances[piece] ?? 0) + 1;
    }

    if (record.telemetry) {
      for (const event of record.telemetry.cardsPlayed) {
        const bucket = event.trap ? this.trapPlacements : this.spellCasts;
        bucket[event.card] = (bucket[event.card] ?? 0) + 1;
      }
      for (const outcome of record.telemetry.traps) {
        if (outcome.triggered) {
          this.trapTriggers[outcome.card] = (this.trapTriggers[outcome.card] ?? 0) + 1;
        }
      }
    }
  }

  finish(failures: number): FuzzReport {
    // Coverage holes come from the LIVE registries, so future content is
    // automatically checked for exercise without any list here.
    const threshold = Math.max(1, Math.floor(this.games * 0.001));
    const draftable = new Set(draftablePieces().map((piece) => piece.type));
    const underPieces = allPieceDefinitions()
      .filter((piece) => draftable.has(piece.type))
      .map((piece) => piece.type)
      .filter((type) => (this.pieceAppearances[type] ?? 0) < threshold);
    const spells = allSpellDefinitions();
    const underSpells = spells
      .filter((spell) => !spell.isTrap)
      .map((spell) => spell.id)
      .filter((id) => (this.spellCasts[id] ?? 0) < threshold);
    const underTraps = spells
      .filter((spell) => spell.isTrap === true)
      .map((spell) => spell.id)
      .filter((id) => (this.trapPlacements[id] ?? 0) < threshold);

    return {
      label: 'engine-stress-test-not-balance-evidence',
      games: this.games,
      failures,
      maxTurnGames: this.maxTurnGames,
      minPlies: Number.isFinite(this.minPlies) ? this.minPlies : 0,
      maxPlies: this.maxPliesSeen,
      averagePlies: this.games > 0 ? this.totalPlies / this.games : 0,
      reasons: this.reasons,
      pieceAppearances: this.pieceAppearances,
      spellCasts: this.spellCasts,
      trapPlacements: this.trapPlacements,
      trapTriggers: this.trapTriggers,
      underExercised: { pieces: underPieces, spells: underSpells, traps: underTraps },
    };
  }
}

export function renderFuzzReport(report: FuzzReport): string {
  const lines: string[] = [];
  const push = (line = ''): void => void lines.push(line);

  push('CHESS 2 FUZZ CAMPAIGN');
  push('=====================');
  push('RandomBot stress test — NOT balance evidence.');
  push();
  push(`Games completed:       ${report.games}`);
  push(`Failures:              ${report.failures}`);
  push(`Max-turn cap hits:     ${report.maxTurnGames}`);
  push(`Plies: min ${report.minPlies}  avg ${report.averagePlies.toFixed(1)}  max ${report.maxPlies}`);
  push();
  push('TERMINATIONS');
  for (const [reason, count] of Object.entries(report.reasons).sort((a, b) => b[1] - a[1])) {
    push(`  ${reason.padEnd(28)} ${count}`);
  }
  push();
  push('CONTENT COVERAGE');
  const top = (record: Readonly<Record<string, number>>, label: string): void => {
    const entries = Object.entries(record).sort((a, b) => b[1] - a[1]);
    if (entries.length === 0) return;
    push(`  ${label}:`);
    for (const [id, count] of entries) push(`    ${id.padEnd(20)} ${count}`);
  };
  top(report.pieceAppearances, 'piece appearances (games)');
  top(report.spellCasts, 'spell casts');
  top(report.trapPlacements, 'trap placements');
  top(report.trapTriggers, 'trap triggers');

  const holes = report.underExercised;
  if (holes.pieces.length + holes.spells.length + holes.traps.length > 0) {
    push();
    push('⚠ UNDER-EXERCISED CONTENT (registered but barely seen)');
    if (holes.pieces.length) push(`  pieces: ${holes.pieces.join(', ')}`);
    if (holes.spells.length) push(`  spells: ${holes.spells.join(', ')}`);
    if (holes.traps.length) push(`  traps:  ${holes.traps.join(', ')}`);
  } else {
    push();
    push('All registered content exercised.');
  }

  return lines.join('\n');
}
