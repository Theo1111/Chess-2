/**
 * Chess 2 balance laboratory CLI.
 *
 *   npm run balance -- --games 25000 --bot greedy --workers 8 --seed 42
 *   npm run balance -- --games 25000 --workers 8 --seed 42 --override champion=10
 *   npm run balance:fuzz -- --games 50000 --workers 8
 *   npm run balance:compare -- --baseline <run-dir> --experiment <run-dir>
 *   npm run balance:replay -- --run <run-dir> --pairing <n>
 *   npm run balance:benchmark
 *
 * Reproducibility contract: the same seed and options produce the same games,
 * ratings and report regardless of worker count — only the run directory
 * name carries a timestamp (or use --name to pin it). Simulation never reads
 * the clock or global randomness.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { availableParallelism } from 'node:os';
import process from 'node:process';

// Register every piece before anything reads the registry.
import '../engine/customPieces';
import '../engine/rookPieces';
import '../engine/knightPieces';
import '../engine/bishopPieces';

import type { PieceClass } from '../engine';
import { DEFAULT_ROSTER_BUDGET, createMatch, type Roster } from '../roster';
import type { AgentSpec } from '../ai/agentFactory';
import { buildAgent } from '../ai/agentFactory';
import { actionKey } from '../ai/actions';
import { createRng } from '../sim/seededRandom';
import { runMatch } from '../sim/runMatch';
import type { FailureRecord, MatchRecord, TournamentResult } from '../sim/tournament';
import { runParallelTournament } from '../sim/parallel';
import { generateArmy, type ArmyMode } from '../balance/armies';
import { costTable, contentFingerprint } from '../balance/contentFingerprint';
import { compareRuns, type RunArtifacts } from '../balance/compare';
import { FuzzAggregator, renderFuzzReport } from '../balance/fuzz';
import { parseOverrides, withCostOverrides, type CostOverrides } from '../balance/overrides';
import {
  buildReport,
  renderConsoleReport,
  reportCsvFiles,
  type BalanceReport,
  type RunMeta,
} from '../balance/report';

interface CliOptions {
  games: number;
  seed: number;
  bot: 'random' | 'greedy' | 'alphabeta';
  depth: number;
  maxTurns: number;
  mirror: boolean;
  workers: number;
  output: string;
  name: string | null;
  armyMode: string;
  armies: number;
  armiesExplicit: boolean;
  overrides: string[];
  minGames: number;
  failFast: boolean;
  command: 'run' | 'replay' | 'benchmark' | 'fuzz' | 'compare';
  runDir: string | null;
  pairing: number;
  baselineDir: string | null;
  experimentDir: string | null;
}

function defaultWorkers(): number {
  // Conservative: parallel enough to matter, never every core.
  return Math.max(1, Math.min(4, availableParallelism() - 2));
}

function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = {
    games: 200,
    seed: 42,
    bot: 'greedy',
    depth: 2,
    maxTurns: 300,
    mirror: true,
    workers: defaultWorkers(),
    output: 'balance-results',
    name: null,
    armyMode: 'random',
    armies: 8,
    armiesExplicit: false,
    overrides: [],
    minGames: 500,
    failFast: false,
    command: 'run',
    runDir: null,
    pairing: 0,
    baselineDir: null,
    experimentDir: null,
  };

  const args = [...argv];
  while (args.length > 0) {
    const flag = args.shift()!;
    const next = (): string => {
      const value = args.shift();
      if (value === undefined) throw new Error(`${flag} needs a value`);
      return value;
    };
    switch (flag) {
      case 'replay': options.command = 'replay'; break;
      case 'benchmark': options.command = 'benchmark'; break;
      case 'fuzz': options.command = 'fuzz'; break;
      case 'compare': options.command = 'compare'; break;
      case '--games': options.games = Number(next()); break;
      case '--seed': options.seed = Number(next()); break;
      case '--bot': options.bot = next() as CliOptions['bot']; break;
      case '--depth': options.depth = Number(next()); break;
      case '--max-turns': options.maxTurns = Number(next()); break;
      case '--mirror': options.mirror = true; break;
      case '--no-mirror': options.mirror = false; break;
      case '--workers': options.workers = Number(next()); break;
      case '--output': options.output = next(); break;
      case '--name': options.name = next(); break;
      case '--army-mode': options.armyMode = next(); break;
      case '--armies': options.armies = Number(next()); options.armiesExplicit = true; break;
      case '--override': options.overrides.push(...next().split(',')); break;
      case '--min-games': options.minGames = Number(next()); break;
      case '--fail-fast': options.failFast = true; break;
      case '--run': options.runDir = next(); break;
      case '--pairing': options.pairing = Number(next()); break;
      case '--baseline': options.baselineDir = next(); break;
      case '--experiment': case '--current': options.experimentDir = next(); break;
      default: throw new Error(`Unknown option: ${flag}`);
    }
  }
  return options;
}

function agentSpec(options: CliOptions): AgentSpec {
  switch (options.bot) {
    case 'random': return { kind: 'random' };
    case 'greedy': return { kind: 'greedy' };
    case 'alphabeta': return { kind: 'alphabeta', maxDepth: options.depth };
  }
}

/** Army pool from `--army-mode`: random | classes | class:<name> | piece:<type>. */
function buildArmies(options: CliOptions): Roster[] {
  const rng = createRng(options.seed).child('armies');
  const modes: ArmyMode[] = [];
  if (options.armyMode === 'random') {
    for (let i = 0; i < options.armies; i++) modes.push({ kind: 'random' });
  } else if (options.armyMode === 'classes') {
    const classes: PieceClass[] = ['queen', 'rook', 'knight', 'bishop', 'pawn'];
    for (let i = 0; i < options.armies; i++) {
      modes.push(
        i < classes.length
          ? { kind: 'class-heavy', pieceClass: classes[i]! }
          : { kind: 'random' },
      );
    }
  } else if (options.armyMode.startsWith('class:')) {
    const pieceClass = options.armyMode.slice('class:'.length) as PieceClass;
    for (let i = 0; i < options.armies; i++) modes.push({ kind: 'class-heavy', pieceClass });
  } else if (options.armyMode.startsWith('piece:')) {
    const piece = options.armyMode.slice('piece:'.length);
    for (let i = 0; i < options.armies; i++) modes.push({ kind: 'piece-heavy', piece });
  } else {
    throw new Error(`Unknown --army-mode: ${options.armyMode}`);
  }
  return modes.map((mode, index) => generateArmy(rng.child(index), { mode }));
}

const timestamp = (): string =>
  new Date().toISOString().replaceAll(':', '-').replace(/\..+$/, '');

function createRunDir(options: CliOptions): string {
  const name = options.name ?? `run-${timestamp()}-seed${options.seed}`;
  const runDir = join(options.output, name);
  if (options.name && existsSync(runDir)) {
    // A COMPLETED run must never be silently overwritten. An interrupted or
    // crashed run (no final report) just blocks its name — reclaim it.
    const completed =
      existsSync(join(runDir, 'report.json')) || existsSync(join(runDir, 'fuzz-report.json'));
    if (completed) {
      throw new Error(
        `Run directory already exists with a completed report: ${runDir} — choose another --name`,
      );
    }
    console.error(`Reclaiming incomplete run directory ${runDir}`);
  }
  mkdirSync(runDir, { recursive: true });
  return runDir;
}

interface Prepared {
  readonly overrides: CostOverrides;
  readonly hasOverrides: boolean;
  readonly armies: Roster[];
  readonly baselineFingerprint: string;
  readonly activeFingerprint: string;
  readonly baselineCosts: Record<string, number>;
  readonly activeCosts: Record<string, number>;
}

/**
 * Overrides change the rules, so everything cost-dependent — army legality
 * during generation, the fingerprint, the recorded cost table — is computed
 * WITH the overrides in force. Armies are therefore re-generated legally
 * under the experimental costs from the same army seed; a same-seed baseline
 * and experiment share the generation stream but may legitimately differ in
 * composition where the price change bites. That adjustment is by design and
 * is reported via the fingerprint + overrides banner.
 */
function prepare(options: CliOptions): Prepared {
  const overrides = parseOverrides(options.overrides);
  const hasOverrides = Object.keys(overrides).length > 0;
  const baselineFingerprint = contentFingerprint();
  const baselineCosts = costTable();
  const withActive = <T>(run: () => T): T =>
    hasOverrides ? withCostOverrides(overrides, run) : run();
  const { armies, activeFingerprint, activeCosts } = withActive(() => ({
    armies: buildArmies(options),
    activeFingerprint: contentFingerprint(),
    activeCosts: costTable(),
  }));
  return {
    overrides,
    hasOverrides,
    armies,
    baselineFingerprint,
    activeFingerprint,
    baselineCosts,
    activeCosts,
  };
}

function runMeta(options: CliOptions, prepared: Prepared, runName: string): RunMeta {
  const overrides: Record<string, { from: number; to: number }> = {};
  for (const [piece, to] of Object.entries(prepared.overrides)) {
    overrides[piece] = { from: prepared.baselineCosts[piece] ?? 0, to };
  }
  return {
    runName,
    seed: options.seed,
    workers: options.workers,
    bot: options.bot === 'alphabeta' ? `alphabeta-d${options.depth}` : options.bot,
    contentFingerprint: prepared.activeFingerprint,
    overrides,
  };
}

function writeConfig(runDir: string, options: CliOptions, prepared: Prepared, elapsedMs: number): void {
  const version = (() => {
    try {
      return (JSON.parse(readFileSync('package.json', 'utf8')) as { version?: string }).version;
    } catch {
      return undefined;
    }
  })();
  writeFileSync(
    join(runDir, 'config.json'),
    JSON.stringify(
      {
        games: options.games,
        seed: options.seed,
        bot: options.bot,
        depth: options.depth,
        maxTurns: options.maxTurns,
        mirror: options.mirror,
        workers: options.workers,
        armyMode: options.armyMode,
        armies: options.armies,
        overrides: prepared.overrides,
        minGames: options.minGames,
        budget: DEFAULT_ROSTER_BUDGET,
        contentFingerprint: prepared.activeFingerprint,
        baselineContentFingerprint: prepared.baselineFingerprint,
        costs: prepared.activeCosts,
        version,
        elapsedMs,
      },
      null,
      2,
    ),
  );
}

function writeFailures(runDir: string, failures: readonly FailureRecord[]): void {
  if (failures.length === 0) return;
  const failureDir = join(runDir, 'failures');
  mkdirSync(failureDir, { recursive: true });
  failures.forEach((failure, index) => {
    writeFileSync(join(failureDir, `failure-${index}.json`), JSON.stringify(failure, null, 2));
  });
}

async function executeTournament(
  options: CliOptions,
  prepared: Prepared,
  extras: { collectTelemetry?: boolean; keepRecords?: boolean; onRecord?: (r: MatchRecord) => void },
): Promise<TournamentResult> {
  return runParallelTournament({
    games: options.games,
    seed: options.seed,
    agents: [agentSpec(options)],
    armies: prepared.armies,
    workers: options.workers,
    mirrored: options.mirror,
    maxPlies: options.maxTurns,
    ...(prepared.hasOverrides ? { overrides: prepared.overrides } : {}),
    ...(options.failFast ? { failFast: true } : {}),
    ...extras,
  });
}

function progressReporter(total: number): (record: MatchRecord) => void {
  const started = Date.now();
  let count = 0;
  return () => {
    count++;
    if (count % 100 === 0 || count === total) {
      const seconds = (Date.now() - started) / 1000;
      const rate = count / seconds;
      const etaMinutes = rate > 0 ? (total - count) / rate / 60 : 0;
      console.error(
        `  ${count}/${total} games  (${rate.toFixed(1)}/s, ~${etaMinutes.toFixed(0)}m remaining)`,
      );
    }
  };
}

/** Ctrl+C on a long run must explain what it leaves behind. */
function installInterruptNotice(runDir: string): void {
  process.once('SIGINT', () => {
    console.error();
    console.error(
      `Interrupted — incomplete run left at ${runDir}; rerunning with the same --name will reclaim it.`,
    );
    process.exit(130);
  });
}

/** Immediate feedback: a long run must never look hung before its first line. */
function announceRun(kind: string, options: CliOptions, runDir: string): void {
  console.error(
    `${kind}: ${options.games} games, bot=${options.bot}, workers=${options.workers}, seed=${options.seed}, armies=${options.armies} → ${runDir}`,
  );
  console.error('  progress prints every 100 games; the report prints at the end.');
}

async function commandRun(options: CliOptions): Promise<void> {
  const prepared = prepare(options);
  const runDir = createRunDir(options);
  const runName = runDir.split('/').pop()!;
  announceRun('Balance run', options, runDir);
  installInterruptNotice(runDir);

  const started = Date.now();
  const result = await executeTournament(options, prepared, {
    onRecord: progressReporter(options.games),
  });
  const elapsedMs = Date.now() - started;

  // Report building reads costs (value-per-point), so overrides stay in force.
  const build = (): { report: BalanceReport; csvFiles: Record<string, string> } => {
    const report = buildReport(result, { thresholds: { minimumGames: options.minGames } });
    return { report, csvFiles: reportCsvFiles(report) };
  };
  const { report, csvFiles } = prepared.hasOverrides
    ? withCostOverrides(prepared.overrides, build)
    : build();

  writeConfig(runDir, options, prepared, elapsedMs);
  writeFileSync(join(runDir, 'report.json'), JSON.stringify(report, null, 2));
  writeFileSync(
    join(runDir, 'summary.json'),
    JSON.stringify(
      {
        games: report.games,
        failures: report.failures,
        maxTurnGames: report.maxTurnGames,
        whiteWins: report.whiteWins,
        blackWins: report.blackWins,
        draws: report.draws,
        averagePlies: report.averagePlies,
        firstMove: report.firstMove,
        modelIntercept: report.modelIntercept,
        gamesPerSecond: result.games / (elapsedMs / 1000),
      },
      null,
      2,
    ),
  );
  writeFileSync(
    join(runDir, 'matches.jsonl'),
    result.records.map((record) => JSON.stringify(record)).join('\n') + '\n',
  );
  writeFileSync(
    join(runDir, 'point-recommendations.json'),
    JSON.stringify(report.recommendations, null, 2),
  );
  for (const [name, content] of Object.entries(csvFiles)) {
    writeFileSync(join(runDir, name), content);
  }
  writeFailures(runDir, result.failures);

  console.log(renderConsoleReport(report, runMeta(options, prepared, runName)));
  console.log();
  console.log(
    `Run written to ${runDir}  (${(elapsedMs / 1000).toFixed(1)}s, ${(result.games / (elapsedMs / 1000)).toFixed(1)} games/s, ${options.workers} worker${options.workers === 1 ? '' : 's'})`,
  );
  if (result.failures.length > 0) {
    console.log(`⚠ ${result.failures.length} simulation failure(s) recorded in ${runDir}/failures`);
  }
}

async function commandFuzz(options: CliOptions): Promise<void> {
  // Fuzzing is RandomBot by definition, streamed so 50k games hold no list.
  // A wide army pool is the coverage lever: the 10k validation campaign
  // proved 8 armies cannot exercise 34 piece types.
  const fuzzOptions: CliOptions = {
    ...options,
    bot: 'random',
    armies: options.armiesExplicit ? options.armies : 32,
  };
  const prepared = prepare(fuzzOptions);
  const runDir = createRunDir({ ...fuzzOptions, name: fuzzOptions.name ?? `fuzz-${timestamp()}-seed${fuzzOptions.seed}` });

  announceRun('Fuzz campaign', fuzzOptions, runDir);
  installInterruptNotice(runDir);

  const aggregator = new FuzzAggregator();
  const progress = progressReporter(fuzzOptions.games);
  const started = Date.now();
  const result = await executeTournament(fuzzOptions, prepared, {
    collectTelemetry: true,
    keepRecords: false,
    onRecord: (record) => {
      aggregator.record(record);
      progress(record);
    },
  });
  const elapsedMs = Date.now() - started;

  const fuzzReport = aggregator.finish(result.failures.length);
  writeConfig(runDir, fuzzOptions, prepared, elapsedMs);
  writeFileSync(join(runDir, 'fuzz-report.json'), JSON.stringify(fuzzReport, null, 2));
  writeFailures(runDir, result.failures);

  console.log(renderFuzzReport(fuzzReport));
  console.log();
  console.log(
    `Fuzz run written to ${runDir}  (${(elapsedMs / 1000).toFixed(1)}s, ${(result.games / (elapsedMs / 1000)).toFixed(1)} games/s, ${fuzzOptions.workers} workers)`,
  );
}

function loadRun(dir: string): RunArtifacts {
  const config = JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8')) as RunArtifacts['config'];
  const report = JSON.parse(readFileSync(join(dir, 'report.json'), 'utf8')) as BalanceReport;
  return { name: dir.split('/').pop() ?? dir, config, report };
}

function commandCompare(options: CliOptions): void {
  if (!options.baselineDir || !options.experimentDir) {
    throw new Error('compare needs --baseline <run-dir> and --experiment <run-dir>');
  }
  console.log(compareRuns(loadRun(options.baselineDir), loadRun(options.experimentDir)));
}

function commandReplay(options: CliOptions): void {
  if (!options.runDir) throw new Error('replay needs --run <run directory>');

  let failure: FailureRecord | null = null;
  try {
    failure = JSON.parse(
      readFileSync(join(options.runDir, 'failures', `failure-${options.pairing}.json`), 'utf8'),
    ) as FailureRecord;
  } catch {
    failure = null;
  }
  if (!failure) throw new Error(`No failures/failure-${options.pairing}.json in ${options.runDir}`);
  if (!failure.whiteRoster || !failure.blackRoster) {
    throw new Error(
      'This failure has no roster snapshot (a worker-level crash) — replay the run itself with the same seed instead.',
    );
  }

  const config = JSON.parse(readFileSync(join(options.runDir, 'config.json'), 'utf8')) as {
    bot: CliOptions['bot'];
    depth: number;
    maxTurns: number;
    overrides?: Record<string, number>;
  };
  const agent = buildAgent(agentSpec({ ...options, bot: config.bot, depth: config.depth }));

  console.log(`Replaying pairing ${failure.pairing} seed ${failure.seed} (${failure.error})`);
  const replay = (): void => {
    const initialState = createMatch(failure.whiteRoster!, failure.blackRoster!).game;
    try {
      const result = runMatch({
        whiteAgent: agent,
        blackAgent: agent,
        initialState,
        seed: failure.seed,
        maxPlies: config.maxTurns,
      });
      console.log(
        `Completed without error this time: ${result.winner} (${result.reason}) in ${result.plies} plies`,
      );
      console.log('Actions:');
      for (const action of result.actions) console.log(`  ${actionKey(action)}`);
    } catch (error) {
      console.log('Reproduced the failure:');
      console.log(error);
    }
  };
  const overrides = config.overrides ?? {};
  if (Object.keys(overrides).length > 0) withCostOverrides(overrides, replay);
  else replay();
}

async function commandBenchmark(options: CliOptions): Promise<void> {
  const prepared = prepare({ ...options, overrides: [] });
  const bots: CliOptions['bot'][] = ['random', 'greedy'];

  console.log('SINGLE-WORKER THROUGHPUT');
  for (const bot of bots) {
    const started = Date.now();
    const result = await executeTournament(
      { ...options, bot, games: bot === 'random' ? 60 : 16, workers: 1 },
      prepared,
      { collectTelemetry: false, keepRecords: false },
    );
    const seconds = (Date.now() - started) / 1000;
    console.log(
      `  ${bot.padEnd(8)} ${(result.games / seconds).toFixed(2)} games/s  ${(result.totalPlies / seconds).toFixed(0)} plies/s`,
    );
  }

  console.log();
  console.log('WORKER SCALING (random bot)');
  const counts = [1, 2, 4, 8].filter((count) => count <= availableParallelism());
  let single = 0;
  for (const workers of counts) {
    const started = Date.now();
    const result = await executeTournament(
      { ...options, bot: 'random', games: 160, workers },
      prepared,
      { collectTelemetry: false, keepRecords: false },
    );
    const seconds = (Date.now() - started) / 1000;
    const rate = result.games / seconds;
    if (workers === 1) single = rate;
    const efficiency = single > 0 ? (rate / (single * workers)) * 100 : 100;
    console.log(
      `  ${String(workers).padStart(2)} worker${workers === 1 ? ' ' : 's'}: ${rate.toFixed(2)} games/s  (scaling efficiency ${efficiency.toFixed(0)}%)`,
    );
  }
  console.log();
  console.log(`peak heap: ${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1)} MB`);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.command === 'replay') commandReplay(options);
  else if (options.command === 'benchmark') await commandBenchmark(options);
  else if (options.command === 'fuzz') await commandFuzz(options);
  else if (options.command === 'compare') commandCompare(options);
  else await commandRun(options);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
