/**
 * The tournament runner: many matches, mirrored pairs, ratings, records.
 *
 * A "pairing" is one (armyA, armyB, agent pair) choice. With mirroring on,
 * each pairing plays two games — A as White then B as White — using the SAME
 * match seed, so the two games differ only in who moves first. That is what
 * separates army strength from first-player advantage in the analysis.
 *
 * Failures never abort a tournament: a crashed simulation is recorded with
 * everything needed to replay it (seed, armies, FEN, action log) and the run
 * continues.
 */

import { type GameState } from '../engine';
import { createMatch, mirrorRoster, type Roster } from '../roster';
import type { Chess2Agent } from '../ai/agent';
import { actionKey } from '../ai/actions';
import { armyComposition, armyFingerprint } from '../balance/fingerprint';
import { createEloTable, recordResult, type EloTable } from '../balance/elo';
import { createRng } from './seededRandom';
import { MatchSimulationError, runMatch, type MatchOutcome } from './runMatch';
import type { MatchTelemetry } from './telemetry';

export interface ArmyInfo {
  readonly id: string;
  readonly composition: Readonly<Record<string, number>>;
  readonly spells: readonly string[];
  readonly traps: readonly string[];
}

/** One finished game, flattened for JSONL and aggregation. */
export interface MatchRecord {
  readonly index: number;
  readonly pairing: number;
  readonly seed: number;
  readonly whiteAgent: string;
  readonly blackAgent: string;
  readonly white: ArmyInfo;
  readonly black: ArmyInfo;
  readonly winner: MatchOutcome;
  readonly reason: string;
  readonly plies: number;
  readonly telemetry: MatchTelemetry | null;
}

export interface FailureRecord {
  readonly pairing: number;
  readonly seed: number;
  readonly ply: number;
  readonly fen: string;
  readonly whiteArmy: string;
  readonly blackArmy: string;
  readonly whiteAgent: string;
  readonly blackAgent: string;
  readonly error: string;
  readonly stack?: string;
  readonly actions: readonly string[];
  /**
   * Full serialized rosters, so a crash replays without regenerating armies.
   * Absent only for synthetic failures (a worker dying outright) where no
   * specific game can be blamed.
   */
  readonly whiteRoster?: Roster;
  readonly blackRoster?: Roster;
}

export interface TournamentConfig {
  /** Total games to play (a mirrored pairing contributes two). */
  readonly games: number;
  readonly agents: readonly Chess2Agent[];
  /** White-framed armies; the runner mirrors them for Black as needed. */
  readonly armies: readonly Roster[];
  readonly seed: number;
  readonly mirrored?: boolean;
  readonly maxPlies?: number;
  readonly collectTelemetry?: boolean;
  /** Streaming hook — write JSONL here rather than holding 100k records. */
  readonly onRecord?: (record: MatchRecord) => void;
  readonly keepRecords?: boolean;
}

export interface TournamentResult {
  readonly records: readonly MatchRecord[];
  readonly failures: readonly FailureRecord[];
  readonly agentElo: EloTable;
  readonly armyElo: EloTable;
  readonly games: number;
  readonly whiteWins: number;
  readonly blackWins: number;
  readonly draws: number;
  readonly totalPlies: number;
}

interface PreparedArmy {
  readonly roster: Roster;
  readonly black: Roster;
  readonly info: ArmyInfo;
}

function prepare(roster: Roster): PreparedArmy {
  return {
    roster,
    black: mirrorRoster(roster, 'black'),
    info: {
      id: armyFingerprint(roster),
      composition: armyComposition(roster),
      spells: [...roster.spellIds].sort(),
      traps: [...roster.trapIds].sort(),
    },
  };
}

/**
 * How many games pairing `pairing` contributes. Pure function of the config,
 * so any process — worker or main thread — computes the identical plan.
 * Mirrored pairings play two games (the odd last game plays only side A).
 */
export function gamesForPairing(totalGames: number, mirrored: boolean, pairing: number): number {
  if (!mirrored) return pairing < totalGames ? 1 : 0;
  const fullPairings = Math.floor(totalGames / 2);
  if (pairing < fullPairings) return 2;
  return pairing === fullPairings ? totalGames % 2 : 0;
}

/** Total pairings the plan contains. */
export function totalPairings(totalGames: number, mirrored: boolean): number {
  return mirrored ? Math.ceil(totalGames / 2) : totalGames;
}

/**
 * Runs one contiguous-or-not set of pairings. Everything about a pairing —
 * armies, agents, match seed, record indices — derives from (config.seed,
 * pairing index) alone, so ANY partition of pairings over ANY number of
 * executors reproduces the same records. That property is what makes worker
 * parallelism reproducible, and it is tested directly.
 */
export function runTournamentBatch(
  config: TournamentConfig,
  pairings: readonly number[],
): { records: MatchRecord[]; failures: FailureRecord[] } {
  if (config.armies.length === 0) throw new Error('runTournamentBatch needs at least one army');
  if (config.agents.length === 0) throw new Error('runTournamentBatch needs at least one agent');

  const rng = createRng(config.seed);
  const armies = config.armies.map(prepare);
  const mirrored = config.mirrored ?? true;
  const keepRecords = config.keepRecords ?? true;

  const records: MatchRecord[] = [];
  const failures: FailureRecord[] = [];

  const playOne = (
    pairing: number,
    ordinal: number,
    seed: number,
    white: PreparedArmy,
    black: PreparedArmy,
    whiteAgent: Chess2Agent,
    blackAgent: Chess2Agent,
  ): void => {
    let initialState: GameState;
    try {
      initialState = createMatch(white.roster, black.black).game;
    } catch (error) {
      failures.push({
        pairing,
        seed,
        ply: 0,
        fen: '<match setup failed>',
        whiteArmy: white.info.id,
        blackArmy: black.info.id,
        whiteAgent: whiteAgent.id,
        blackAgent: blackAgent.id,
        error: error instanceof Error ? error.message : String(error),
        actions: [],
        whiteRoster: white.roster,
        blackRoster: black.black,
      });
      return;
    }

    try {
      const result = runMatch({
        whiteAgent,
        blackAgent,
        initialState,
        seed,
        ...(config.maxPlies !== undefined ? { maxPlies: config.maxPlies } : {}),
        ...(config.collectTelemetry !== undefined
          ? { collectTelemetry: config.collectTelemetry }
          : {}),
      });

      const record: MatchRecord = {
        // Deterministic identity: which executor played the game never
        // matters. Mirrored plans reserve two slots per pairing.
        index: (config.mirrored ?? true) ? pairing * 2 + ordinal : pairing,
        pairing,
        seed,
        whiteAgent: whiteAgent.id,
        blackAgent: blackAgent.id,
        white: white.info,
        black: black.info,
        winner: result.winner,
        reason: result.reason,
        plies: result.plies,
        telemetry: result.telemetry,
      };

      config.onRecord?.(record);
      // keepRecords=false keeps the lightweight row (aggregates and ratings
      // still need it) but drops the per-event telemetry, which is the bulk.
      records.push(keepRecords ? record : { ...record, telemetry: null });
    } catch (error) {
      const details =
        error instanceof MatchSimulationError
          ? {
              ply: error.ply,
              fen: error.fen,
              actions: error.actions.map(actionKey),
            }
          : { ply: -1, fen: '<unknown>', actions: [] as string[] };
      failures.push({
        pairing,
        seed,
        ...details,
        whiteArmy: white.info.id,
        blackArmy: black.info.id,
        whiteAgent: whiteAgent.id,
        blackAgent: blackAgent.id,
        error: error instanceof Error ? error.message : String(error),
        ...(error instanceof Error && error.stack ? { stack: error.stack } : {}),
        whiteRoster: white.roster,
        blackRoster: black.black,
      });
    }
  };

  for (const pairing of pairings) {
    const gameCount = gamesForPairing(config.games, mirrored, pairing);
    if (gameCount === 0) continue;

    const pairRng = rng.child(`pair:${pairing}`);
    const a = armies[pairRng.int(armies.length)]!;
    const b =
      armies.length === 1
        ? a
        : armies.filter((candidate) => candidate !== a)[
            pairRng.int(armies.length - 1)
          ]!;

    const firstAgent = config.agents[pairing % config.agents.length]!;
    const secondAgent =
      config.agents.length === 1
        ? firstAgent
        : config.agents[(pairing + 1 + pairRng.int(config.agents.length - 1)) % config.agents.length]!;

    // Paired seeds: the mirror game replays the same random stream so the
    // two games differ only in which army holds the first move.
    const matchSeed = pairRng.child('seed').int(2 ** 31 - 1);

    playOne(pairing, 0, matchSeed, a, b, firstAgent, secondAgent);
    if (mirrored && gameCount === 2) {
      playOne(pairing, 1, matchSeed, b, a, secondAgent, firstAgent);
    }
  }

  return { records, failures };
}

/**
 * Ratings as a canonical post-pass over index-sorted records. Elo is
 * sequential (update order changes the numbers), so computing it here — never
 * during play — is what makes 1-worker and 8-worker runs numerically
 * identical.
 */
export function computeRatings(records: readonly MatchRecord[]): {
  agentElo: EloTable;
  armyElo: EloTable;
} {
  const agentElo = createEloTable();
  const armyElo = createEloTable();
  for (const record of [...records].sort((a, b) => a.index - b.index)) {
    const score = record.winner === 'white' ? 1 : record.winner === 'black' ? 0 : 0.5;
    if (record.whiteAgent !== record.blackAgent) {
      recordResult(agentElo, record.whiteAgent, record.blackAgent, score);
    }
    if (record.white.id !== record.black.id) {
      recordResult(armyElo, record.white.id, record.black.id, score);
    }
  }
  return { agentElo, armyElo };
}

/** Aggregates + ratings from finished batches — shared by all executors. */
export function finalizeTournament(
  records: MatchRecord[],
  failures: FailureRecord[],
): TournamentResult {
  records.sort((a, b) => a.index - b.index);
  failures.sort((a, b) => a.pairing - b.pairing);

  let whiteWins = 0;
  let blackWins = 0;
  let draws = 0;
  let totalPlies = 0;
  for (const record of records) {
    totalPlies += record.plies;
    if (record.winner === 'white') whiteWins++;
    else if (record.winner === 'black') blackWins++;
    else draws++;
  }

  return {
    records,
    failures,
    ...computeRatings(records),
    games: records.length,
    whiteWins,
    blackWins,
    draws,
    totalPlies,
  };
}

export function runTournament(config: TournamentConfig): TournamentResult {
  const pairings: number[] = [];
  for (let i = 0; i < totalPairings(config.games, config.mirrored ?? true); i++) pairings.push(i);
  const { records, failures } = runTournamentBatch(config, pairings);
  return finalizeTournament(records, failures);
}
