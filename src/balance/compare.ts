/**
 * Run comparison — the paired-experiment reader.
 *
 * Two modes fall out of the same diff:
 *  - COST EXPERIMENT: same bot, different overrides → how did the ecosystem
 *    respond to the price change? (inclusion, adjusted contribution, synergy,
 *    first-move, replacement outliers)
 *  - CROSS-BOT REPLICATION: different bots, same rules → do the two models
 *    agree on the direction of each outlier? Agreement strengthens evidence;
 *    disagreement usually means the weaker bot is being exploited.
 *
 * The comparison never averages the runs together, and it refuses to stay
 * quiet when the two runs were played under different rules (fingerprints).
 */

import type { BalanceReport } from './report';

export interface RunArtifacts {
  readonly name: string;
  readonly config: {
    readonly seed?: number;
    readonly bot?: string;
    readonly games?: number;
    readonly contentFingerprint?: string;
    readonly baselineContentFingerprint?: string;
    readonly overrides?: Readonly<Record<string, number>>;
    readonly costs?: Readonly<Record<string, number>>;
  };
  readonly report: BalanceReport;
}

const percent = (value: number): string => `${(value * 100).toFixed(1)}%`;
const pp = (value: number): string => `${value >= 0 ? '+' : ''}${value.toFixed(1)}pp`;
const signed = (value: number, digits = 2): string =>
  `${value >= 0 ? '+' : ''}${value.toFixed(digits)}`;

export function compareRuns(baseline: RunArtifacts, experiment: RunArtifacts): string {
  const lines: string[] = [];
  const push = (line = ''): void => void lines.push(line);

  const crossBot =
    baseline.config.bot !== undefined &&
    experiment.config.bot !== undefined &&
    baseline.config.bot !== experiment.config.bot;

  push('CHESS 2 RUN COMPARISON');
  push('======================');
  push(`Baseline:   ${baseline.name}  (${baseline.config.bot ?? '?'}, ${baseline.report.games} games, seed ${baseline.config.seed ?? '?'})`);
  push(`Experiment: ${experiment.name}  (${experiment.config.bot ?? '?'}, ${experiment.report.games} games, seed ${experiment.config.seed ?? '?'})`);

  // Rules identity.
  const baseFp = baseline.config.contentFingerprint;
  const expFp = experiment.config.contentFingerprint;
  if (baseFp && expFp && baseFp !== expFp) {
    const explainedByOverrides =
      experiment.config.baselineContentFingerprint === baseFp ||
      baseline.config.baselineContentFingerprint === expFp ||
      (baseline.config.baselineContentFingerprint !== undefined &&
        baseline.config.baselineContentFingerprint === experiment.config.baselineContentFingerprint);
    push();
    if (explainedByOverrides) {
      push('Gameplay registries differ ONLY by the declared cost overrides.');
    } else {
      push('*** WARNING: GAMEPLAY REGISTRY DIFFERS BETWEEN THESE RUNS ***');
      push(`Baseline fingerprint:   ${baseFp}`);
      push(`Experiment fingerprint: ${expFp}`);
      push('Results may reflect both balance changes and content changes.');
    }
  }

  // Overrides banner.
  const overrides = { ...baseline.config.overrides, ...experiment.config.overrides };
  const overridePieces = Object.keys(overrides);
  if (overridePieces.length > 0) {
    push();
    push('COST OVERRIDES');
    for (const piece of overridePieces) {
      const from =
        baseline.config.overrides?.[piece] ??
        baseline.config.costs?.[piece] ??
        baseline.report.pieces.find((entry) => entry.piece === piece)?.cost;
      const to =
        experiment.config.overrides?.[piece] ??
        experiment.config.costs?.[piece] ??
        experiment.report.pieces.find((entry) => entry.piece === piece)?.cost;
      push(`  ${piece}: ${from ?? '?'} → ${to ?? '?'}`);
    }
  }

  // Global health.
  const b = baseline.report;
  const e = experiment.report;
  const rate = (report: BalanceReport, value: number): number =>
    report.games > 0 ? value / report.games : 0;
  push();
  push('GLOBAL');
  push(`White score:        ${percent(b.firstMove.whiteScore.rate)} → ${percent(e.firstMove.whiteScore.rate)}  (${pp((e.firstMove.whiteScore.rate - b.firstMove.whiteScore.rate) * 100)})`);
  if (b.firstMove.mirroredGames > 0 && e.firstMove.mirroredGames > 0) {
    push(`First-move (mirror):${pp((b.firstMove.mirroredWhiteScore.rate - 0.5) * 100)} → ${pp((e.firstMove.mirroredWhiteScore.rate - 0.5) * 100)}`);
  }
  push(`Draw rate:          ${percent(rate(b, b.draws))} → ${percent(rate(e, e.draws))}`);
  push(`Average length:     ${b.averagePlies.toFixed(1)} → ${e.averagePlies.toFixed(1)} plies`);
  push(`Failures:           ${b.failures} → ${e.failures}`);
  push(`Max-turn games:     ${b.maxTurnGames} → ${e.maxTurnGames}`);

  const baselinePieces = new Map(b.pieces.map((entry) => [entry.piece, entry]));
  const experimentPieces = new Map(e.pieces.map((entry) => [entry.piece, entry]));

  if (crossBot) {
    push();
    push('CROSS-BOT REPLICATION');
    push('(direction agreement between the two bots\' adjusted models)');
    const shared = b.pieces
      .filter((entry) => experimentPieces.has(entry.piece))
      .sort((x, y) => Math.abs(y.effectPp) - Math.abs(x.effectPp));
    const outliers = shared.filter((entry) => Math.abs(entry.effectPp) >= 1);
    // Always show something to compare — fall back to the biggest effects.
    const notable = (outliers.length > 0 ? outliers : shared).slice(0, 12);
    for (const entry of notable) {
      const other = experimentPieces.get(entry.piece)!;
      const agrees = Math.sign(entry.effectPp) === Math.sign(other.effectPp);
      push(
        `  ${entry.name.padEnd(16)} ${baseline.config.bot}: ${pp(entry.effectPp)}   ${experiment.config.bot}: ${pp(other.effectPp)}   agree: ${agrees ? 'YES' : 'NO'}${agrees ? '' : '   (likely exploits the weaker bot)'}`,
      );
    }
  }

  // Per-piece movement, focused on the overridden pieces first, then the
  // largest efficiency movers.
  const focus = new Set(overridePieces);
  push();
  push('PIECES');
  const describe = (piece: string): void => {
    const before = baselinePieces.get(piece);
    const after = experimentPieces.get(piece);
    if (!before && !after) return;
    const name = (before ?? after)!.name;
    push(`  ${name}${focus.has(piece) ? '  [overridden]' : ''}`);
    const line = (label: string, from: string, to: string, delta: string): void =>
      push(`    ${label.padEnd(22)} ${from} → ${to}  (${delta})`);
    if (before && after) {
      line('inclusion', percent(before.pickRate), percent(after.pickRate), pp((after.pickRate - before.pickRate) * 100));
      line('adjusted contribution', pp(before.effectPp), pp(after.effectPp), pp(after.effectPp - before.effectPp));
      line('raw win rate', percent(before.rawWinRate), percent(after.rawWinRate), pp((after.rawWinRate - before.rawWinRate) * 100));
      line('value / point', before.relativeEfficiency.toFixed(2), after.relativeEfficiency.toFixed(2), signed(after.relativeEfficiency - before.relativeEfficiency));
    } else {
      push(`    present only in ${before ? 'baseline' : 'experiment'}`);
    }
  };
  for (const piece of overridePieces) describe(piece);
  const movers = [...experimentPieces.values()]
    .filter((entry) => baselinePieces.has(entry.piece) && !focus.has(entry.piece))
    .map((entry) => ({
      piece: entry.piece,
      shift: entry.relativeEfficiency - baselinePieces.get(entry.piece)!.relativeEfficiency,
    }))
    .sort((x, y) => Math.abs(y.shift) - Math.abs(x.shift))
    .slice(0, 5);
  for (const mover of movers) describe(mover.piece);

  // Replacement outlier: did something else become the new best value?
  if (!crossBot && overridePieces.length > 0) {
    const risers = movers.filter((mover) => mover.shift > 0.25);
    push();
    push('REPLACEMENT OUTLIERS');
    if (risers.length === 0) push('  None detected.');
    for (const riser of risers) {
      const entry = experimentPieces.get(riser.piece)!;
      push(
        `  ${entry.name}: value/pt ${baselinePieces.get(riser.piece)!.relativeEfficiency.toFixed(2)} → ${entry.relativeEfficiency.toFixed(2)}`,
      );
    }
  }

  // Class movement.
  push();
  push('CLASSES (avg efficiency)');
  const baseClasses = new Map(b.classes.map((row) => [row.pieceClass, row]));
  for (const row of e.classes) {
    const before = baseClasses.get(row.pieceClass);
    if (!before) continue;
    push(
      `  ${row.pieceClass.padEnd(10)} ${before.averageEfficiency.toFixed(2)} → ${row.averageEfficiency.toFixed(2)}  (${signed(row.averageEfficiency - before.averageEfficiency)})`,
    );
  }

  // Cards: pick-rate and trigger-rate movement.
  push();
  push('CARDS');
  const baseCards = new Map(b.cards.map((entry) => [entry.card, entry]));
  const cardMovers = e.cards
    .filter((entry) => baseCards.has(entry.card))
    .map((entry) => ({
      entry,
      before: baseCards.get(entry.card)!,
      shift: Math.abs(entry.pickRate - baseCards.get(entry.card)!.pickRate),
    }))
    .sort((x, y) => y.shift - x.shift)
    .slice(0, 6);
  for (const { entry, before } of cardMovers) {
    const extra = entry.trap
      ? `  trigger ${percent(before.triggerRate)} → ${percent(entry.triggerRate)}`
      : '';
    push(
      `  ${entry.card.padEnd(16)} pick ${percent(before.pickRate)} → ${percent(entry.pickRate)}${extra}${entry.fidelity !== 'full' ? '  [fidelity: LIMITED]' : ''}`,
    );
  }

  // Synergy movement among pairs reliable in both runs.
  const synergyKey = (entry: { a: string; b: string }): string => `${entry.a}|${entry.b}`;
  const baseSynergy = new Map(
    b.synergies.filter((entry) => entry.reliable).map((entry) => [synergyKey(entry), entry]),
  );
  const synergyMovers = e.synergies
    .filter((entry) => entry.reliable && baseSynergy.has(synergyKey(entry)))
    .map((entry) => ({
      entry,
      before: baseSynergy.get(synergyKey(entry))!,
    }))
    .sort(
      (x, y) =>
        Math.abs(y.entry.delta - y.before.delta) - Math.abs(x.entry.delta - x.before.delta),
    )
    .slice(0, 5);
  if (synergyMovers.length > 0) {
    push();
    push('SYNERGY MOVEMENT');
    for (const { entry, before } of synergyMovers) {
      push(
        `  ${entry.a} + ${entry.b.replace(/^(spell|trap):/, '')}: ${pp(before.delta * 100)} → ${pp(entry.delta * 100)}`,
      );
    }
  }

  return lines.join('\n');
}
