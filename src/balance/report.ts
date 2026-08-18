/**
 * Report assembly: tournament results → one structured, JSON-serializable
 * report object, plus renderers (console text, CSV rows). Pure string/data
 * building — file writing lives in the CLI, so this stays testable.
 *
 * Discipline rules enforced here:
 *  - every piece carries BOTH raw and adjusted statistics; raw win rate alone
 *    can never generate a recommendation (confounding by army-mates);
 *  - findings are tiered (WATCH / INVESTIGATE / BALANCE CANDIDATE) by the
 *    evidence module, and limited-fidelity mechanics are capped at WATCH;
 *  - first-move advantage is reported separately and prominently, never
 *    mixed into piece strength;
 *  - modelling limitations are stamped into every report.
 */

import { getPieceDefinition, hasPieceDefinition } from '../engine';
import { costOf } from '../roster';
import type { TournamentResult } from '../sim/tournament';
import { rankings } from './elo';
import {
  classifyEvidence,
  DEFAULT_THRESHOLDS,
  type EvidenceThresholds,
  type EvidenceTier,
} from './evidence';
import { allFidelityNotes, ANALYSIS_LIMITATIONS, contentFidelity, type Fidelity, type FidelityNote } from './fidelity';
import { coefficientToPp, fitBalanceModel, pieceEfficiency } from './model';
import { pointRecommendations, type PointRecommendation } from './recommendations';
import { pairSynergies, type SynergyEntry } from './synergy';
import {
  cardStats,
  firstMoveAdvantage,
  matchupMatrix,
  pieceStats,
  type FirstMoveReport,
} from './stats';

export interface PieceReportEntry {
  readonly piece: string;
  readonly name: string;
  readonly pieceClass: string;
  readonly cost: number;
  // --- raw ---------------------------------------------------------------
  readonly gamesSelected: number;
  readonly armiesSelectedIn: number;
  readonly pickRate: number;
  readonly wins: number;
  readonly losses: number;
  readonly draws: number;
  readonly rawWinRate: number;
  readonly rawWinRateLow: number;
  readonly rawWinRateHigh: number;
  readonly colorAdjustedWinRate: number;
  readonly averageCopies: number;
  readonly survivalRate: number;
  readonly averageCaptures: number;
  // --- adjusted ----------------------------------------------------------
  readonly coefficient: number;
  readonly effectPp: number;
  readonly effectLowPp: number;
  readonly effectHighPp: number;
  readonly relativeEfficiency: number;
  // --- judgement ---------------------------------------------------------
  readonly fidelity: Fidelity;
  readonly tier: EvidenceTier | null;
  /** Filled by cross-bot comparison; null until a second bot has spoken. */
  readonly crossBotAgreement: boolean | null;
  /** Filled once evolutionary army search exists; null until then. */
  readonly optimizedArmyInclusionRate: number | null;
}

export interface CardReportEntry {
  readonly card: string;
  readonly trap: boolean;
  readonly gamesSelected: number;
  readonly pickRate: number;
  readonly gamesUsed: number;
  readonly useRate: number;
  readonly averagePlyUsed: number | null;
  readonly winWhenSelected: number;
  readonly winWhenUsed: number;
  // trap lifecycle (zero for spells)
  readonly placed: number;
  readonly placementRate: number;
  readonly triggered: number;
  readonly triggerRate: number;
  readonly revealed: number;
  readonly revealRate: number;
  // adjusted
  readonly coefficient: number;
  readonly effectPp: number;
  readonly fidelity: Fidelity;
  readonly tier: EvidenceTier | null;
}

export interface ClassBalanceRow {
  readonly pieceClass: string;
  readonly pieces: number;
  readonly selectionShare: number;
  readonly averageEfficiency: number;
  readonly averageWinRate: number;
}

export interface BalanceReport {
  readonly games: number;
  readonly failures: number;
  readonly whiteWins: number;
  readonly blackWins: number;
  readonly draws: number;
  readonly averagePlies: number;
  /** Games cut off by the emergency ply cap — always worth investigating. */
  readonly maxTurnGames: number;
  readonly firstMove: FirstMoveReport;
  readonly agentRatings: ReturnType<typeof rankings>;
  readonly armyRatings: ReturnType<typeof rankings>;
  readonly pieces: PieceReportEntry[];
  readonly cards: CardReportEntry[];
  readonly classes: ClassBalanceRow[];
  readonly synergies: SynergyEntry[];
  readonly recommendations: PointRecommendation[];
  readonly matchups: { row: string; column: string; games: number; score: number }[];
  readonly modelIntercept: number;
  readonly modelRows: number;
  readonly thresholds: EvidenceThresholds;
  readonly analysisLimitations: typeof ANALYSIS_LIMITATIONS;
  readonly fidelityNotes: readonly FidelityNote[];
}

export interface ReportOptions {
  readonly thresholds?: Partial<EvidenceThresholds>;
  readonly synergyMinGames?: number;
}

const named = (piece: string): string =>
  hasPieceDefinition(piece) ? getPieceDefinition(piece).name : piece;

export function buildReport(result: TournamentResult, options: ReportOptions = {}): BalanceReport {
  const thresholds: EvidenceThresholds = { ...DEFAULT_THRESHOLDS, ...options.thresholds };
  const records = result.records;
  const stats = pieceStats(records);
  const cards = cardStats(records);
  const model = fitBalanceModel(records);
  const efficiency = pieceEfficiency(model, (piece) => Math.max(1, costOf(piece)));
  const synergies = pairSynergies(records, model, {
    thresholds,
    ...(options.synergyMinGames !== undefined ? { minGames: options.synergyMinGames } : {}),
  });

  const totalSides = records.length * 2;

  const pieces: PieceReportEntry[] = efficiency.map((entry) => {
    const stat = stats.get(entry.piece);
    const tier = classifyEvidence(
      {
        games: stat?.gamesSelected ?? 0,
        appearances: stat?.armiesSelectedIn ?? 0,
        effectPp: entry.effectPp,
        effectLowPp: entry.effectLowPp,
        effectHighPp: entry.effectHighPp,
        fidelity: 'full',
        crossBotAgreement: null,
      },
      thresholds,
    );
    return {
      piece: entry.piece,
      name: named(entry.piece),
      pieceClass: hasPieceDefinition(entry.piece)
        ? getPieceDefinition(entry.piece).pieceClass ?? 'unclassed'
        : 'unclassed',
      cost: entry.cost,
      gamesSelected: stat?.gamesSelected ?? 0,
      armiesSelectedIn: stat?.armiesSelectedIn ?? 0,
      pickRate: totalSides > 0 ? (stat?.gamesSelected ?? 0) / totalSides : 0,
      wins: stat?.wins ?? 0,
      losses: stat?.losses ?? 0,
      draws: stat?.draws ?? 0,
      rawWinRate: stat?.winRate.rate ?? 0,
      rawWinRateLow: stat?.winRate.low ?? 0,
      rawWinRateHigh: stat?.winRate.high ?? 1,
      colorAdjustedWinRate: stat?.colorAdjustedWinRate ?? 0.5,
      averageCopies: stat?.averageCopies ?? 0,
      survivalRate: stat?.survivalRate ?? 0,
      averageCaptures: stat?.averageCaptures ?? 0,
      coefficient: entry.coefficient,
      effectPp: entry.effectPp,
      effectLowPp: entry.effectLowPp,
      effectHighPp: entry.effectHighPp,
      relativeEfficiency: entry.relativeEfficiency,
      fidelity: 'full',
      tier,
      crossBotAgreement: null,
      optimizedArmyInclusionRate: null,
    };
  });

  const cardEntries: CardReportEntry[] = [];
  for (const stat of cards.spells.values()) {
    const coefficient = model.spells.get(stat.card) ?? 0;
    const fidelity = contentFidelity(stat.card);
    cardEntries.push({
      card: stat.card,
      trap: false,
      gamesSelected: stat.gamesSelected,
      pickRate: stat.pickRate,
      gamesUsed: stat.gamesUsed,
      useRate: stat.useRate,
      averagePlyUsed: stat.averagePlyUsed,
      winWhenSelected: stat.winRateWhenSelected.rate,
      winWhenUsed: stat.winRateWhenUsed.rate,
      placed: 0,
      placementRate: 0,
      triggered: 0,
      triggerRate: 0,
      revealed: 0,
      revealRate: 0,
      coefficient,
      effectPp: coefficientToPp(model, coefficient),
      fidelity,
      tier: cardTier(model, stat.card, 's:', stat.gamesSelected, fidelity, thresholds),
    });
  }
  for (const stat of cards.traps.values()) {
    const coefficient = model.traps.get(stat.card) ?? 0;
    const fidelity = contentFidelity(stat.card);
    cardEntries.push({
      card: stat.card,
      trap: true,
      gamesSelected: stat.gamesSelected,
      pickRate: stat.gamesSelected > 0 && totalSides > 0 ? stat.gamesSelected / totalSides : 0,
      gamesUsed: stat.gamesPlaced,
      useRate: stat.placementRate,
      averagePlyUsed: stat.averagePlyPlaced,
      winWhenSelected: stat.winRateWhenSelected.rate,
      winWhenUsed: 0,
      placed: stat.gamesPlaced,
      placementRate: stat.placementRate,
      triggered: stat.triggered,
      triggerRate: stat.triggerRate,
      revealed: stat.revealed,
      revealRate: stat.revealRate,
      coefficient,
      effectPp: coefficientToPp(model, coefficient),
      fidelity,
      tier: cardTier(model, stat.card, 't:', stat.gamesSelected, fidelity, thresholds),
    });
  }
  cardEntries.sort((a, b) => b.pickRate - a.pickRate);

  // Class rollup from the live registry — new classes just appear.
  const classAccumulator = new Map<
    string,
    { pieces: number; selections: number; efficiencyTotal: number; winTotal: number; winGames: number }
  >();
  let totalSelections = 0;
  for (const stat of stats.values()) totalSelections += stat.gamesSelected;
  for (const entry of pieces) {
    const acc = classAccumulator.get(entry.pieceClass) ?? {
      pieces: 0,
      selections: 0,
      efficiencyTotal: 0,
      winTotal: 0,
      winGames: 0,
    };
    acc.pieces++;
    acc.efficiencyTotal += entry.relativeEfficiency;
    acc.selections += entry.gamesSelected;
    acc.winTotal += entry.colorAdjustedWinRate * entry.gamesSelected;
    acc.winGames += entry.gamesSelected;
    classAccumulator.set(entry.pieceClass, acc);
  }
  const classes: ClassBalanceRow[] = [...classAccumulator.entries()]
    .map(([pieceClass, acc]) => ({
      pieceClass,
      pieces: acc.pieces,
      selectionShare: totalSelections > 0 ? acc.selections / totalSelections : 0,
      averageEfficiency: acc.pieces > 0 ? acc.efficiencyTotal / acc.pieces : 0,
      averageWinRate: acc.winGames > 0 ? acc.winTotal / acc.winGames : 0,
    }))
    .sort((a, b) => b.averageEfficiency - a.averageEfficiency);

  const matchups: BalanceReport['matchups'] = [];
  for (const [row, columns] of matchupMatrix(records)) {
    for (const [column, cell] of columns) {
      matchups.push({ row, column, games: cell.games, score: cell.score });
    }
  }

  const recommendations = pointRecommendations(
    pieces.map((entry) => ({
      piece: entry.piece,
      cost: entry.cost,
      effectPp: entry.effectPp,
      effectLowPp: entry.effectLowPp,
      effectHighPp: entry.effectHighPp,
      games: entry.gamesSelected,
      tier: entry.tier,
    })),
  );

  return {
    games: result.games,
    failures: result.failures.length,
    whiteWins: result.whiteWins,
    blackWins: result.blackWins,
    draws: result.draws,
    averagePlies: result.games > 0 ? result.totalPlies / result.games : 0,
    maxTurnGames: records.filter((record) => record.reason === 'max-plies').length,
    firstMove: firstMoveAdvantage(records),
    agentRatings: rankings(result.agentElo),
    armyRatings: rankings(result.armyElo),
    pieces,
    cards: cardEntries,
    classes,
    synergies,
    recommendations,
    matchups,
    modelIntercept: model.intercept,
    modelRows: model.rows,
    thresholds,
    analysisLimitations: ANALYSIS_LIMITATIONS,
    fidelityNotes: allFidelityNotes(),
  };
}

function cardTier(
  model: ReturnType<typeof fitBalanceModel>,
  card: string,
  prefix: 's:' | 't:',
  games: number,
  fidelity: Fidelity,
  thresholds: EvidenceThresholds,
): EvidenceTier | null {
  const coefficient = (prefix === 's:' ? model.spells : model.traps).get(card) ?? 0;
  const se = model.standardErrors.get(`${prefix}${card}`) ?? Number.POSITIVE_INFINITY;
  const margin = Number.isFinite(se) ? 1.96 * se : Number.POSITIVE_INFINITY;
  return classifyEvidence(
    {
      games,
      appearances: games,
      effectPp: coefficientToPp(model, coefficient),
      effectLowPp: Number.isFinite(margin) ? coefficientToPp(model, coefficient - margin) : -100,
      effectHighPp: Number.isFinite(margin) ? coefficientToPp(model, coefficient + margin) : 100,
      fidelity,
      crossBotAgreement: null,
    },
    thresholds,
  );
}

/* ------------------------------------------------------------------ */
/* Renderers                                                           */
/* ------------------------------------------------------------------ */

export interface RunMeta {
  readonly runName?: string;
  readonly seed?: number;
  readonly workers?: number;
  readonly bot?: string;
  readonly contentFingerprint?: string;
  /** piece → { from, to } for every active override. */
  readonly overrides?: Readonly<Record<string, { from: number; to: number }>>;
}

const percent = (value: number): string => `${(value * 100).toFixed(1)}%`;
const pp = (value: number): string => `${value >= 0 ? '+' : ''}${value.toFixed(1)}pp`;

export function renderConsoleReport(report: BalanceReport, meta: RunMeta = {}): string {
  const lines: string[] = [];
  const push = (line = ''): void => void lines.push(line);

  push('CHESS 2 BALANCE REPORT');
  push('======================');
  push();
  if (meta.runName) push(`Run:                 ${meta.runName}`);
  if (meta.seed !== undefined) push(`Seed:                ${meta.seed}`);
  if (meta.workers !== undefined) push(`Workers:             ${meta.workers}`);
  if (meta.bot) push(`Bot:                 ${meta.bot}`);
  if (meta.contentFingerprint) push(`Content fingerprint: ${meta.contentFingerprint}`);
  push(`Games:               ${report.games}`);
  push(`Average length:      ${report.averagePlies.toFixed(1)} plies`);

  const overrides = Object.entries(meta.overrides ?? {});
  if (overrides.length > 0) {
    push();
    push('*** BALANCE OVERRIDES ACTIVE — NOT BASELINE DATA ***');
    for (const [piece, change] of overrides) {
      push(`  ${named(piece)}: ${change.from} → ${change.to}`);
    }
  }

  push();
  push('RESULT');
  push(`White wins: ${percent(report.games ? report.whiteWins / report.games : 0)}`);
  push(`Black wins: ${percent(report.games ? report.blackWins / report.games : 0)}`);
  push(`Draws:      ${percent(report.games ? report.draws / report.games : 0)}`);

  push();
  push('FIRST-MOVE ADVANTAGE');
  const mirror = report.firstMove;
  if (mirror.mirroredGames > 0) {
    const estimate = (mirror.mirroredWhiteScore.rate - 0.5) * 100;
    const low = (mirror.mirroredWhiteScore.low - 0.5) * 100;
    const high = (mirror.mirroredWhiteScore.high - 0.5) * 100;
    push(`Estimated (mirrored games): ${pp(estimate)}   95% CI [${pp(low)}, ${pp(high)}]`);
    push(`Mirrored sample:            ${mirror.mirroredGames} games`);
  } else {
    push('No mirrored games — first-move advantage not separable from army strength.');
  }
  push(
    `All games, White score:     ${percent(mirror.whiteScore.rate)} [${percent(mirror.whiteScore.low)}–${percent(mirror.whiteScore.high)}]`,
  );
  push('(This is a property of the game, not of any piece.)');

  if (report.agentRatings.length > 0) {
    push();
    push('AGENT RATINGS');
    for (const agent of report.agentRatings) {
      push(`${agent.id.padEnd(20)} ${agent.rating.toFixed(0).padStart(5)}  (${agent.games} games)`);
    }
  }

  if (report.armyRatings.length > 0) {
    push();
    push('TOP ARMIES');
    for (const army of report.armyRatings.slice(0, 8)) {
      push(
        `${army.id.padEnd(16)} ${army.rating.toFixed(0).padStart(5)}  ${army.wins}W/${army.losses}L/${army.draws}D`,
      );
    }
  }

  // Findings by tier.
  const byTier = (tier: EvidenceTier) => report.pieces.filter((entry) => entry.tier === tier);
  const synergyByTier = (tier: EvidenceTier) =>
    report.synergies.filter((entry) => entry.tier === tier && entry.reliable);
  const cardByTier = (tier: EvidenceTier) => report.cards.filter((entry) => entry.tier === tier);

  const tierSection = (title: string, tier: EvidenceTier): void => {
    const pieceRows = byTier(tier);
    const cardRows = cardByTier(tier);
    const synergyRows = synergyByTier(tier).slice(0, 5);
    push();
    push(title);
    if (pieceRows.length === 0 && cardRows.length === 0 && synergyRows.length === 0) {
      push('  (none)');
      return;
    }
    for (const entry of pieceRows) {
      push(
        `  ${entry.name.padEnd(16)} ${pp(entry.effectPp)} [${pp(entry.effectLowPp)}, ${pp(entry.effectHighPp)}]  value/pt ${entry.relativeEfficiency.toFixed(2)}  (${entry.gamesSelected} games)`,
      );
    }
    for (const entry of cardRows) {
      push(
        `  ${(entry.card + (entry.trap ? ' (trap)' : '')).padEnd(22)} ${pp(entry.effectPp)}  pick ${percent(entry.pickRate)}  (${entry.gamesSelected} games)${entry.fidelity !== 'full' ? '  [fidelity: LIMITED]' : ''}`,
      );
    }
    for (const entry of synergyRows) {
      push(
        `  ${named(entry.a)} + ${entry.b.replace(/^(spell|trap):/, '')}: ${pp(entry.delta * 100)} [${pp(entry.deltaLow * 100)}, ${pp(entry.deltaHigh * 100)}] over ${entry.games} games`,
      );
    }
  };

  tierSection('BALANCE CANDIDATES', 'balance-candidate');
  tierSection('INVESTIGATE', 'investigate');
  tierSection('WATCH', 'watch');

  if (report.recommendations.length > 0) {
    push();
    push('POINT-VALUE INVESTIGATIONS (suggestions only — nothing is changed)');
    for (const rec of report.recommendations) {
      push(
        `${named(rec.piece).padEnd(16)} current ${rec.currentCost} → test ${rec.suggestedInvestigation}  [${rec.tier}]  confidence ${rec.confidence}`,
      );
      push(`  ${rec.reason}`);
    }
  } else {
    push();
    push('POINT-VALUE INVESTIGATIONS');
    push('No piece clears the evidence bar at this sample size.');
  }

  push();
  push('MODELING LIMITATIONS');
  for (const note of report.fidelityNotes) {
    push(`- ${note.id}: fidelity ${note.fidelity.toUpperCase()}`);
    push(`  ${note.reason}`);
  }

  push();
  push('HEALTH');
  push(`Engine failures:       ${report.failures}`);
  push(`Max-turn terminations: ${report.maxTurnGames}`);

  return lines.join('\n');
}

/* CSV helpers — plain string building, quoted only where needed. */
const cell = (value: unknown): string => {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};
export const toCsv = (headers: readonly string[], rows: readonly (readonly unknown[])[]): string =>
  [headers.join(','), ...rows.map((row) => row.map(cell).join(','))].join('\n') + '\n';

export function reportCsvFiles(report: BalanceReport): Record<string, string> {
  return {
    'piece-balance.csv': toCsv(
      [
        'piece', 'class', 'cost', 'games', 'armies', 'pick_rate', 'wins', 'losses', 'draws',
        'raw_win_rate', 'raw_win_low', 'raw_win_high', 'color_adjusted_win_rate',
        'avg_copies', 'survival_rate', 'avg_captures',
        'coefficient', 'effect_pp', 'effect_low_pp', 'effect_high_pp',
        'relative_efficiency', 'tier', 'fidelity',
      ],
      report.pieces.map((entry) => [
        entry.piece, entry.pieceClass, entry.cost, entry.gamesSelected, entry.armiesSelectedIn,
        entry.pickRate.toFixed(4), entry.wins, entry.losses, entry.draws,
        entry.rawWinRate.toFixed(4), entry.rawWinRateLow.toFixed(4), entry.rawWinRateHigh.toFixed(4),
        entry.colorAdjustedWinRate.toFixed(4), entry.averageCopies.toFixed(2),
        entry.survivalRate.toFixed(4), entry.averageCaptures.toFixed(2),
        entry.coefficient.toFixed(5), entry.effectPp.toFixed(2),
        entry.effectLowPp.toFixed(2), entry.effectHighPp.toFixed(2),
        entry.relativeEfficiency.toFixed(3), entry.tier ?? '', entry.fidelity,
      ]),
    ),
    'card-balance.csv': toCsv(
      [
        'card', 'type', 'games_selected', 'pick_rate', 'used_or_placed', 'use_rate',
        'avg_ply', 'win_when_selected', 'triggered', 'trigger_rate', 'revealed', 'reveal_rate',
        'coefficient', 'effect_pp', 'tier', 'fidelity',
      ],
      report.cards.map((entry) => [
        entry.card, entry.trap ? 'trap' : 'spell', entry.gamesSelected,
        entry.pickRate.toFixed(4), entry.gamesUsed, entry.useRate.toFixed(4),
        entry.averagePlyUsed?.toFixed(1) ?? '', entry.winWhenSelected.toFixed(4),
        entry.triggered, entry.triggerRate.toFixed(4), entry.revealed, entry.revealRate.toFixed(4),
        entry.coefficient.toFixed(5), entry.effectPp.toFixed(2), entry.tier ?? '', entry.fidelity,
      ]),
    ),
    'synergy.csv': toCsv(
      ['a', 'b', 'games', 'expected_score', 'actual_score', 'delta', 'delta_low', 'delta_high', 'reliable', 'tier', 'fidelity'],
      report.synergies.map((entry) => [
        entry.a, entry.b, entry.games, entry.expectedScore.toFixed(4),
        entry.actualScore.toFixed(4), entry.delta.toFixed(4),
        entry.deltaLow.toFixed(4), entry.deltaHigh.toFixed(4),
        entry.reliable, entry.tier ?? '', entry.fidelity,
      ]),
    ),
    'class-balance.csv': toCsv(
      ['class', 'pieces', 'selection_share', 'avg_efficiency', 'avg_adjusted_win_rate'],
      report.classes.map((row) => [
        row.pieceClass, row.pieces, row.selectionShare.toFixed(4),
        row.averageEfficiency.toFixed(3), row.averageWinRate.toFixed(4),
      ]),
    ),
    'agent-ratings.csv': toCsv(
      ['agent', 'rating', 'games', 'wins', 'losses', 'draws'],
      report.agentRatings.map((entry) => [
        entry.id, entry.rating.toFixed(1), entry.games, entry.wins, entry.losses, entry.draws,
      ]),
    ),
    'army-ratings.csv': toCsv(
      ['army', 'rating', 'games', 'wins', 'losses', 'draws'],
      report.armyRatings.map((entry) => [
        entry.id, entry.rating.toFixed(1), entry.games, entry.wins, entry.losses, entry.draws,
      ]),
    ),
    'matchup-matrix.csv': toCsv(
      ['army', 'versus', 'games', 'score', 'score_rate'],
      report.matchups.map((cellRow) => [
        cellRow.row, cellRow.column, cellRow.games, cellRow.score,
        cellRow.games > 0 ? (cellRow.score / cellRow.games).toFixed(4) : '',
      ]),
    ),
  };
}
